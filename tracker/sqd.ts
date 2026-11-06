import type { Hex } from "viem"
import { isRecord, Limiter, sleep } from "./net.js"
import type { TrackedChainId } from "./universe.js"

/**
 * Recent transactions to a contract from the SQD Network portal
 * (https://docs.sqd.dev/en/api/evm/stream), which answers without an API
 * key. Used on Base and Arbitrum One, whose Blockscout instances answer the
 * fetch step's runner with a Cloudflare challenge. The sample is the one
 * Blockscout's txlist gives on the other chains: the latest top-level
 * transactions whose `to` is the contract, newest first, here from
 * finalized blocks only.
 */

export const SQD_PORTAL = "https://portal.sqd.dev/datasets"

export const SQD_DATASETS: Readonly<Partial<Record<TrackedChainId, string>>> = {
  8453: "base-mainnet",
  42161: "arbitrum-one",
}

/** Nominal seconds per block, for a first guess; the real rate is measured. */
const NOMINAL_BLOCK_SECONDS: Readonly<Partial<Record<TrackedChainId, number>>> =
  {
    8453: 2,
    42161: 0.25,
  }

const MONTH = 30 * 86_400
/** The first window scanned back from the head. */
const FIRST_WINDOW_SECONDS = 600
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

export interface PortalTx {
  readonly hash: Hex
  readonly blockNumber: number
  readonly index: number
  /** Unix seconds. */
  readonly timestamp: number
  /** Lowercase sender. */
  readonly from: string
  /** Lowercase recipient: the contract. */
  readonly to: string
  /** Lowercase 4-byte selector, or "0x" for a call without one. */
  readonly selector: string
  readonly failed: boolean
}

export interface PortalSample {
  /** Newest first, at most the size asked for. */
  readonly txs: readonly PortalTx[]
  /** Unless the sample was cut at the size asked for: `txs` is every
   *  transaction to the contract between these block times (Unix seconds),
   *  so a quiet contract's rate is its count over this span. */
  readonly covered: { readonly since: number; readonly until: number } | null
  /** `covered` reaches back more than 30 days: `txs` is every transaction
   *  of those 30 days. */
  readonly complete30Days: boolean
}

interface Block {
  readonly header: { readonly number: number; readonly timestamp: number }
  readonly transactions?: readonly unknown[]
}

interface Clock {
  readonly head: number
  /** Unix seconds. */
  readonly headTime: number
  /** The newest block more than 30 days (and an hour) older than `head`. */
  readonly boundary: number
  readonly secondsPerBlock: number
}

const limiters = new Map<string, Limiter>()
const clocks = new Map<string, Promise<Clock>>()

function limiterFor(dataset: string): Limiter {
  let found = limiters.get(dataset)
  if (!found) {
    found = new Limiter(2)
    limiters.set(dataset, found)
  }
  return found
}

/** Tries per portal request. The public portal answers 529 "overloaded"
 *  for minutes at a time, so the waits grow to a minute. */
const ATTEMPTS = 8

/**
 * One portal request, retried on a rate limit (honouring Retry-After), an
 * overload, a 5xx or a network failure: waits of 5 seconds doubling to a
 * minute, each shifted by up to a quarter so that parallel scans spread out.
 */
async function request(
  dataset: string,
  path: "finalized-head" | "finalized-stream",
  body?: unknown
): Promise<string | null> {
  const url = `${SQD_PORTAL}/${dataset}/${path}`
  let last: unknown
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let wait =
      Math.min(60_000, 5_000 * 2 ** attempt) * (0.75 + Math.random() / 2)
    try {
      const response = await limiterFor(dataset).run(() =>
        fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "b3pay-clear-signing-tracker",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(180_000),
        })
      )
      if (response.status === 204) return null
      const text = await response.text()
      if (text.length > MAX_RESPONSE_BYTES)
        throw new Error(`${url} answered more than ${MAX_RESPONSE_BYTES} bytes`)
      if (response.ok) return text
      const retryAfter = Number(response.headers.get("retry-after"))
      if (Number.isFinite(retryAfter) && retryAfter > 0)
        wait = Math.min(retryAfter, 60) * 1_000
      last = new Error(
        `HTTP ${response.status} from ${url}: ${text.replace(/\s+/g, " ").slice(0, 200)}`
      )
      const retry =
        response.status === 429 ||
        response.status === 529 ||
        (response.status >= 500 && response.status !== 500)
      if (!retry) break
    } catch (error) {
      last = error
    }
    if (attempt < ATTEMPTS - 1) await sleep(wait)
  }
  throw last instanceof Error ? last : new Error(String(last))
}

function parseBlocks(text: string | null): Block[] {
  if (text === null) return []
  const blocks: Block[] = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    const value: unknown = JSON.parse(line)
    if (
      !isRecord(value) ||
      !isRecord(value.header) ||
      typeof value.header.number !== "number" ||
      typeof value.header.timestamp !== "number"
    )
      throw new Error("the portal answered a block without a header")
    blocks.push({
      header: {
        number: value.header.number,
        timestamp: value.header.timestamp,
      },
      ...(Array.isArray(value.transactions)
        ? { transactions: value.transactions as unknown[] }
        : {}),
    })
  }
  return blocks
}

async function blockTime(dataset: string, number: number): Promise<number> {
  const blocks = parseBlocks(
    await request(dataset, "finalized-stream", {
      type: "evm",
      fromBlock: number,
      toBlock: number,
      includeAllBlocks: true,
      fields: { block: { number: true, timestamp: true } },
    })
  )
  const block = blocks.find((b) => b.header.number === number)
  if (!block) throw new Error(`the portal has no ${dataset} block ${number}`)
  return block.header.timestamp
}

async function measureClock(
  chainId: TrackedChainId,
  dataset: string
): Promise<Clock> {
  const headBody: unknown = JSON.parse(
    (await request(dataset, "finalized-head")) ?? "null"
  )
  if (!isRecord(headBody) || typeof headBody.number !== "number")
    throw new Error(`the portal has no finalized head for ${dataset}`)
  const head = headBody.number
  const headTime = await blockTime(dataset, head)
  const target = MONTH + 3_600
  let back = Math.ceil(target / (NOMINAL_BLOCK_SECONDS[chainId] ?? 1))
  for (let step = 0; step < 6; step += 1) {
    const candidate = Math.max(0, head - back)
    const elapsed = headTime - (await blockTime(dataset, candidate))
    const secondsPerBlock = elapsed / Math.max(1, head - candidate)
    if (elapsed >= target || candidate === 0)
      return { head, headTime, boundary: candidate, secondsPerBlock }
    // Too recent: step back by the measured rate, with 2% to spare.
    back = Math.ceil((target / Math.max(secondsPerBlock, 1e-3)) * 1.02)
  }
  throw new Error(`could not find the ${dataset} block from 30 days ago`)
}

function clockFor(chainId: TrackedChainId, dataset: string): Promise<Clock> {
  let found = clocks.get(dataset)
  if (!found) {
    found = measureClock(chainId, dataset)
    clocks.set(dataset, found)
  }
  return found
}

/** Thrown by {@link scan} when the deadline passes between two parts. */
class TimeLimitReached extends Error {
  constructor() {
    super("the portal scan reached its time limit")
  }
}

/** Parts one scan may take. The portal ends a response after a few hundred
 *  blocks of Base (each part also names the last block it read), so 30
 *  days there is about 1,500 parts; this only stops a runaway loop. */
const MAX_PARTS = 20_000

/** Every transaction to one of `addresses` in blocks `from..to`, following
 *  the portal's continuation: a response that stops short of `to` is
 *  continued from the block after its last one, and an empty one ends the
 *  range. Past `deadline`, it asks for no further part. */
async function scan(
  dataset: string,
  from: number,
  to: number,
  addresses: readonly string[],
  deadline?: number
): Promise<PortalTx[]> {
  const targets = new Set(addresses.map((a) => a.toLowerCase()))
  const out: PortalTx[] = []
  let next = from
  for (let part = 0; next <= to; part += 1) {
    if (part >= MAX_PARTS)
      throw new Error(
        `the portal returned ${dataset} blocks ${from}..${to} in more than ${MAX_PARTS} parts`
      )
    if (part > 0 && deadline !== undefined && Date.now() > deadline)
      throw new TimeLimitReached()
    const blocks = parseBlocks(
      await request(dataset, "finalized-stream", {
        type: "evm",
        fromBlock: next,
        toBlock: to,
        fields: {
          block: { number: true, timestamp: true },
          transaction: {
            hash: true,
            from: true,
            to: true,
            sighash: true,
            status: true,
            transactionIndex: true,
          },
        },
        transactions: [{ to: [...targets] }],
      })
    )
    if (blocks.length === 0) break
    for (const block of blocks)
      for (const tx of block.transactions ?? []) {
        if (
          !isRecord(tx) ||
          typeof tx.hash !== "string" ||
          typeof tx.from !== "string" ||
          typeof tx.to !== "string"
        )
          continue
        const recipient = tx.to.toLowerCase()
        if (!targets.has(recipient)) continue
        out.push({
          hash: tx.hash as Hex,
          blockNumber: block.header.number,
          index:
            typeof tx.transactionIndex === "number" ? tx.transactionIndex : 0,
          timestamp: block.header.timestamp,
          from: tx.from.toLowerCase(),
          to: recipient,
          selector:
            typeof tx.sighash === "string" &&
            /^0x[0-9a-fA-F]{8}$/.test(tx.sighash)
              ? tx.sighash.toLowerCase()
              : "0x",
          failed: tx.status === 0,
        })
      }
    const last = blocks[blocks.length - 1]!.header.number
    if (last < next)
      throw new Error(
        `the portal answered ${dataset} block ${last} when asked from ${next}`
      )
    if (last >= to) break
    next = last + 1
  }
  return out
}

/** Contracts asked about in one portal request. */
const ADDRESSES_PER_REQUEST = 50
/** Each window is this many times longer than the one before it. */
const GROWTH = 3

export interface PortalScanOptions {
  readonly log?: (line: string) => void
  /** Read no more after this time (epoch ms): no new window, and a window
   *  in progress is dropped at its next part. Contracts still short of the
   *  size asked for keep what the windows before read, with the span those
   *  covered; a contract no whole window read gets an Error. */
  readonly deadline?: number
}

/**
 * The latest `size` transactions to each of `addresses`, all scanned
 * together: windows back from the finalized head, each three times longer
 * than the last, at most 30 days back. A contract leaves the scan once it
 * has `size` transactions, so a busy one costs one short window and a quiet
 * one shares the long windows with the others.
 */
export async function latestPortalSamples(
  chainId: TrackedChainId,
  addresses: readonly string[],
  size: number,
  options: PortalScanOptions = {}
): Promise<Map<string, PortalSample | Error>> {
  const { log, deadline } = options
  const dataset = SQD_DATASETS[chainId]
  if (!dataset) throw new Error(`no SQD portal dataset for chain ${chainId}`)
  const clock = await clockFor(chainId, dataset)
  const found = new Map<string, PortalTx[]>(
    addresses.map((a) => [a.toLowerCase(), []])
  )
  const pending = new Set(found.keys())
  /** Per contract, the oldest block of the whole windows read for it. */
  const scannedFrom = new Map<string, number>()
  /** Contracts whose scan failed before any whole window. */
  const failed = new Map<string, Error>()
  let to = clock.head
  let span = Math.max(
    1,
    Math.ceil(FIRST_WINDOW_SECONDS / Math.max(clock.secondsPerBlock, 1e-3))
  )
  for (let window = 0; window < 24 && pending.size > 0; window += 1) {
    if (deadline !== undefined && Date.now() > deadline) {
      log?.(
        `${dataset}: time limit reached, ${pending.size} contracts keep what the windows before read`
      )
      break
    }
    const started = Date.now()
    const from = Math.max(clock.boundary, to - span + 1)
    const list = [...pending]
    const batches: string[][] = []
    for (let i = 0; i < list.length; i += ADDRESSES_PER_REQUEST)
      batches.push(list.slice(i, i + ADDRESSES_PER_REQUEST))
    // The dataset's limiter decides how many of these run at once. A batch
    // that fails, or that the deadline cuts short, keeps nothing of this
    // window, so its contracts stop with what the windows before read: what
    // it read of some blocks would not say what it missed of the others.
    const answers = await Promise.allSettled(
      batches.map((batch) => scan(dataset, from, to, batch, deadline))
    )
    let count = 0
    let timeLimit = false
    answers.forEach((answer, i) => {
      const batch = batches[i]!
      if (answer.status === "fulfilled") {
        count += answer.value.length
        for (const tx of answer.value) found.get(tx.to)?.push(tx)
        for (const address of batch) scannedFrom.set(address, from)
        return
      }
      const error =
        answer.reason instanceof Error
          ? answer.reason
          : new Error(String(answer.reason))
      if (error instanceof TimeLimitReached) timeLimit = true
      else
        log?.(
          `${dataset} blocks ${from}..${to}: ${batch.length} contracts stop here: ${error.message}`
        )
      for (const address of batch) {
        pending.delete(address)
        if (!scannedFrom.has(address)) failed.set(address, error)
      }
    })
    for (const address of list)
      if ((found.get(address)?.length ?? 0) >= size) pending.delete(address)
    log?.(
      `${dataset} blocks ${from}..${to}: ${count} transactions to ${list.length} contracts in ${Math.round((Date.now() - started) / 1000)} s, ${pending.size} still short of ${size}`
    )
    if (timeLimit) {
      log?.(
        `${dataset}: time limit reached in blocks ${from}..${to}; contracts keep what the windows before read`
      )
      break
    }
    if (from <= clock.boundary) break
    to = from - 1
    span *= GROWTH
  }
  // Each contract still short of `size` holds every transaction of the
  // blocks its whole windows read; their first blocks' times bound that span.
  const times = new Map<number, number>()
  for (const [address, txs] of found) {
    const first = scannedFrom.get(address)
    if (first === undefined || txs.length >= size || times.has(first)) continue
    times.set(first, await blockTime(dataset, first))
  }
  const out = new Map<string, PortalSample | Error>()
  for (const [address, txs] of found) {
    txs.sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index)
    const first = scannedFrom.get(address)
    if (txs.length >= size) {
      out.set(address, {
        txs: txs.slice(0, size),
        covered: null,
        complete30Days: false,
      })
    } else if (first !== undefined) {
      const since = times.get(first)!
      out.set(address, {
        txs,
        covered: { since, until: clock.headTime },
        complete30Days: clock.headTime - since >= MONTH,
      })
    } else {
      out.set(
        address,
        failed.get(address) ??
          new Error("the portal scan stopped before it read any block")
      )
    }
  }
  return out
}

/** One contract's sample; see {@link latestPortalSamples}. */
export async function latestPortalTransactions(
  chainId: TrackedChainId,
  address: string,
  size: number
): Promise<PortalSample> {
  const samples = await latestPortalSamples(chainId, [address], size)
  const sample = samples.get(address.toLowerCase())
  if (sample === undefined || sample instanceof Error)
    throw sample ?? new Error(`the portal scan read no blocks for ${address}`)
  return sample
}
