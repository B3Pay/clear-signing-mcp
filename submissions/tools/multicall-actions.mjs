// What the batch calls to a submitted contract carry. For each deployment of
// each descriptor under submissions/registry/ whose contract has a batch
// function (in the tracker's ABI for it, a function named multicall with a
// bytes[] parameter: multicall(bytes[]), multicall(uint256,bytes[]),
// multicall(bytes32,bytes[])), it reads the latest successful transactions
// that call one from the SQD Network portal, decodes their actions, and
// counts which sequences of actions occur and which actions the descriptor
// has no format for. Read-only, network; runs in CI. It never fails a run:
// it measures what a batch screen would show, for the pull request text.
//
//   node submissions/tools/multicall-actions.mjs [--root <dir like submissions/registry>] \
//     [--count 200] [--minutes 4]
//
// --count is the batches read per deployment and function, newest first;
// --minutes bounds the time spent on each, after which it reports what it
// read and the span that covers. It looks back at most 30 days.

import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import {
  decodeFunctionData,
  parseAbiItem,
  toFunctionSelector,
  toFunctionSignature,
} from "viem"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    count: { type: "string", default: "200" },
    minutes: { type: "string", default: "4" },
  },
})
const root = resolve(values.root ?? join(repo, "submissions", "registry"))
const COUNT = Number(values.count)
const BUDGET_MS = Number(values.minutes) * 60_000

// The portal's datasets for the chains the tracker reads (tracker/sqd.ts).
const PORTAL = "https://portal.sqd.dev/datasets"
const DATASETS = {
  1: "ethereum-mainnet",
  10: "optimism-mainnet",
  8453: "base-mainnet",
  42161: "arbitrum-one",
}
const SECONDS_PER_BLOCK = { 1: 12, 10: 2, 8453: 2, 42161: 0.25 }
const MONTH = 30 * 86_400

// One portal request, retried on a rate limit, an overload or a network
// failure, with waits growing to a minute.
async function portal(dataset, path, body) {
  let last
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(`${PORTAL}/${dataset}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "b3pay-clear-signing-submissions",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(120_000),
      })
      if (response.status === 204) return ""
      const text = await response.text()
      if (response.ok) return text
      last = new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`)
      if (response.status !== 429 && response.status < 502) break
    } catch (error) {
      last = error
    }
    await sleep(Math.min(60_000, 5_000 * 2 ** attempt))
  }
  throw last
}

function blocksOf(text) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
}

async function blockTime(dataset, number) {
  const [block] = blocksOf(
    await portal(dataset, "finalized-stream", {
      type: "evm",
      fromBlock: number,
      toBlock: number,
      includeAllBlocks: true,
      fields: { block: { number: true, timestamp: true } },
    })
  )
  if (!block) throw new Error(`no ${dataset} block ${number}`)
  return block.header.timestamp
}

// Every transaction to `address` calling `selector` in blocks from..to,
// following the portal's continuation: a part names the last block it read,
// and an empty part ends the range.
async function scan(dataset, from, to, address, selector, deadline) {
  const out = []
  let next = from
  while (next <= to) {
    if (Date.now() > deadline) return { txs: out, stoppedAt: next }
    const blocks = blocksOf(
      await portal(dataset, "finalized-stream", {
        type: "evm",
        fromBlock: next,
        toBlock: to,
        fields: {
          block: { number: true, timestamp: true },
          transaction: {
            hash: true,
            from: true,
            input: true,
            status: true,
            transactionIndex: true,
          },
        },
        transactions: [{ to: [address], sighash: [selector] }],
      })
    )
    if (blocks.length === 0) break
    for (const block of blocks)
      for (const tx of block.transactions ?? [])
        out.push({
          ...tx,
          block: block.header.number,
          time: block.header.timestamp,
        })
    const last = blocks[blocks.length - 1].header.number
    if (last < next) throw new Error(`${dataset} answered block ${last}`)
    next = last + 1
  }
  return { txs: out, stoppedAt: null }
}

// The latest `COUNT` successful calls, in windows back from the finalized
// head, each three times longer than the last, at most 30 days back.
async function latestCalls(chainId, address, selector) {
  const dataset = DATASETS[chainId]
  const head = JSON.parse(await portal(dataset, "finalized-head")).number
  const deadline = Date.now() + BUDGET_MS
  const oldest = Math.max(
    0,
    head - Math.ceil((MONTH / SECONDS_PER_BLOCK[chainId]) * 1.05)
  )
  const calls = []
  let failed = 0
  let to = head
  let span = Math.ceil(3_600 / SECONDS_PER_BLOCK[chainId])
  // The oldest block of the whole windows read.
  let reached = null
  while (calls.length < COUNT && to >= oldest && Date.now() < deadline) {
    const from = Math.max(oldest, to - span + 1)
    const { txs, stoppedAt } = await scan(
      dataset,
      from,
      to,
      address,
      selector,
      deadline
    )
    // A window the time limit cuts short keeps nothing: what it read of
    // some blocks would not say what it missed of the others.
    if (stoppedAt !== null) break
    for (const tx of txs) {
      if (tx.status === 1) calls.push(tx)
      else failed += 1
    }
    reached = from
    to = from - 1
    span *= 3
  }
  if (reached === null) throw new Error("no whole window read in time")
  calls.sort(
    (a, b) => b.block - a.block || b.transactionIndex - a.transactionIndex
  )
  const kept = calls.slice(0, COUNT)
  const since =
    kept.length === COUNT
      ? kept[kept.length - 1].time
      : await blockTime(dataset, reached)
  return { calls: kept, failed, since, until: await blockTime(dataset, head) }
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const day = (seconds) =>
  new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")
const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

const lines = []
const say = (line = "") => {
  lines.push(line)
  console.log(line)
}

say("## What batch calls carry")
say()
const descriptors = walk(root).filter(
  (p) => /\/calldata-[^/]+\.json$/.test(p) && !p.includes("/testsv2/")
)
for (const path of descriptors) {
  const descriptor = JSON.parse(readFileSync(path, "utf8"))
  const formatted = new Map(
    Object.keys(descriptor.display?.formats ?? {}).map((key) => [
      toFunctionSelector(parseAbiItem(`function ${key}`)),
      key.slice(0, key.indexOf("(")),
    ])
  )
  for (const { chainId, address } of descriptor.context?.contract
    ?.deployments ?? []) {
    const abiFile = join(
      repo,
      "tracker",
      "data",
      "abis",
      String(chainId),
      `${address.toLowerCase()}.json`
    )
    let abi
    try {
      abi = JSON.parse(readFileSync(abiFile, "utf8"))
      abi = Array.isArray(abi) ? abi : abi.abi
    } catch {
      continue
    }
    const functions = abi.filter((item) => item.type === "function")
    const batch = functions.filter(
      (f) =>
        f.name === "multicall" && f.inputs.some((i) => i.type === "bytes[]")
    )
    if (batch.length === 0 || !DATASETS[chainId]) continue
    const names = new Map(functions.map((f) => [toFunctionSelector(f), f.name]))
    for (const fn of batch) {
      const selector = toFunctionSelector(fn)
      const where = `${relative(root, path)}, chain ${chainId}, ${short(address)}`
      say(
        `### ${where}: \`${toFunctionSignature(fn)}\`${formatted.has(selector) ? "" : " (no format)"}`
      )
      say()
      let result
      try {
        result = await latestCalls(chainId, address.toLowerCase(), selector)
      } catch (error) {
        say(`Not read: ${error.message}`)
        say()
        continue
      }
      const { calls, failed, since, until } = result
      const index = fn.inputs.findIndex((i) => i.type === "bytes[]")
      const sequences = new Map()
      const missing = new Map()
      let complete = 0
      const senders = new Set()
      for (const tx of calls) {
        senders.add(tx.from.toLowerCase())
        let actions
        try {
          actions = decodeFunctionData({ abi: [fn], data: tx.input }).args[
            index
          ]
        } catch {
          actions = null
        }
        const selectors =
          actions === null
            ? ["undecodable"]
            : actions.map((a) => a.slice(0, 10).toLowerCase())
        const key =
          selectors.map((s) => names.get(s) ?? s).join(", ") || "(empty)"
        const entry = sequences.get(key) ?? { batches: 0, senders: new Set() }
        entry.batches += 1
        entry.senders.add(tx.from.toLowerCase())
        sequences.set(key, entry)
        const unformatted = [
          ...new Set(selectors.filter((s) => !formatted.has(s))),
        ]
        if (unformatted.length === 0) complete += 1
        for (const s of unformatted) {
          const name = names.get(s) ?? s
          missing.set(name, (missing.get(name) ?? 0) + 1)
        }
      }
      say(
        `${plural(calls.length, "successful batch", "successful batches")} from ${plural(senders.size, "sender", "senders")}, ${day(since)} to ${day(until)} UTC` +
          (calls.length === COUNT
            ? ` (the latest ${COUNT})`
            : " (all of them in that span)") +
          `; ${failed} failed in the blocks read, not counted.`
      )
      if (calls.length === 0) {
        say()
        continue
      }
      say(
        `Every action has a format in ${complete} of ${calls.length} batches (${Math.round((100 * complete) / calls.length)}%).`
      )
      say()
      say("| Actions | Batches | Senders |")
      say("| --- | --- | --- |")
      for (const [key, entry] of [...sequences].sort(
        (a, b) => b[1].batches - a[1].batches
      ))
        say(`| ${key} | ${entry.batches} | ${entry.senders.size} |`)
      say()
      if (missing.size > 0) {
        say(
          "Actions with no format, in batches: " +
            [...missing]
              .sort((a, b) => b[1] - a[1])
              .map(([n, c]) => `${n} (${c})`)
              .join(", ") +
            "."
        )
        say()
      }
    }
  }
}
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n")
