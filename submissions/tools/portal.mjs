// Reading the latest calls to a contract from the SQD Network portal, for the
// tools that measure what real transactions send to a submitted contract
// (multicall-actions.mjs, must-match.mjs). Read-only, network; runs in CI.

import { setTimeout as sleep } from "node:timers/promises"

// The portal's datasets for the chains the tracker reads (tracker/sqd.ts).
// SQD_PORTAL_URL points the tools at another server, to test them.
const PORTAL = process.env.SQD_PORTAL_URL ?? "https://portal.sqd.dev/datasets"
export const DATASETS = {
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
            value: true,
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

// The latest `count` successful calls to `address` with `selector` on
// `chainId`, newest first, in windows back from the finalized head, each
// three times longer than the last, at most 30 days back, within `budgetMs`.
// `since` and `until` are the span the calls cover, in seconds: from the
// oldest call kept, or from the oldest block read when fewer were found.
export async function latestCalls(chainId, address, selector, count, budgetMs) {
  const dataset = DATASETS[chainId]
  const head = JSON.parse(await portal(dataset, "finalized-head")).number
  const deadline = Date.now() + budgetMs
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
  while (calls.length < count && to >= oldest && Date.now() < deadline) {
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
  const kept = calls.slice(0, count)
  const since =
    kept.length === count
      ? kept[kept.length - 1].time
      : await blockTime(dataset, reached)
  return { calls: kept, failed, since, until: await blockTime(dataset, head) }
}
