import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeFunctionData, getAddress, parseAbi, type Hex } from "viem"
import { addressesInCall, summarize, type ListedTx } from "../tracker/fetch.js"
import { choosePreview, draftCandidates } from "../tracker/draft.js"
import type { DescriptorFacts } from "../tracker/registry.js"
import {
  readDraftSummaries,
  statusOf,
  withoutChain,
} from "../tracker/report.js"

const NOW = 1_800_000_000
const DAY = 86_400

function tx(
  timestamp: number,
  selector = "0x12345678",
  from = "0xaa",
  failed = false
): ListedTx {
  return {
    hash: `0x${timestamp.toString(16).padStart(64, "0")}`,
    timestamp,
    from,
    selector,
    failed,
  }
}

describe("summarize", () => {
  it("rates a sample younger than 30 days by its own time span", () => {
    const txs = [tx(NOW - DAY), tx(NOW - 2 * DAY), tx(NOW - 3 * DAY)]
    const summary = summarize("blockscout-txlist", 1000, txs, null, NOW)
    expect(summary.perDay).toBeCloseTo(3 / 2)
    expect(summary.last30Days).toBe(3)
  })

  it("rates a sample that reaches back 30 days by its last 30 days", () => {
    const txs = [tx(NOW - DAY), tx(NOW - 10 * DAY), tx(NOW - 40 * DAY)]
    const summary = summarize("blockscout-txlist", 1000, txs, null, NOW)
    expect(summary.perDay).toBeCloseTo(2 / 30)
  })

  it("rates a complete 30-day scan by its count, even when empty", () => {
    const month = { since: NOW - 31 * DAY, until: NOW - 600 }
    expect(summarize("sqd-portal", 1000, [], month, NOW).perDay).toBe(0)
    const one = summarize("sqd-portal", 1000, [tx(NOW - DAY)], month, NOW)
    expect(one.perDay).toBeCloseTo(1 / 30)
  })

  it("rates a scan that stopped short by the span it read", () => {
    // Two calls an hour apart in a scan of three days: 2/3 a day, not 48.
    const covered = { since: NOW - 3 * DAY, until: NOW }
    const txs = [tx(NOW - 3_600), tx(NOW - 7_200)]
    const summary = summarize("sqd-portal", 1000, txs, covered, NOW)
    expect(summary.perDay).toBeCloseTo(2 / 3)
    expect(summary.covered).toEqual(covered)
  })

  it("has no rate for an empty sample that is not known to be complete", () => {
    expect(summarize("blockscout-txlist", 1000, [], null, NOW).perDay).toBe(
      null
    )
  })

  it("counts transactions and distinct senders per selector", () => {
    const txs = [
      tx(NOW - 10, "0xaaaaaaaa", "0x01"),
      tx(NOW - 20, "0xaaaaaaaa", "0x01"),
      tx(NOW - 30, "0xaaaaaaaa", "0x02"),
      tx(NOW - 40, "0xbbbbbbbb", "0x01", true),
      tx(NOW - 50, "0x", "0x03"),
    ]
    const summary = summarize("blockscout-txlist", 1000, txs, null, NOW)
    expect(summary.selectors).toEqual({
      "0xaaaaaaaa": 3,
      "0xbbbbbbbb": 1,
      "0x": 1,
    })
    expect(summary.sendersBySelector).toEqual({
      "0xaaaaaaaa": 2,
      "0xbbbbbbbb": 1,
      "0x": 1,
    })
    expect(summary.senders).toBe(3)
    expect(summary.failed).toBe(1)
  })
})

describe("statusOf", () => {
  const descriptor: DescriptorFacts = {
    path: "registry/x/calldata-x.json",
    url: "https://example.test",
    owner: null,
    selectors: new Set(),
    formats: new Map(),
    attestation: "no_file",
  }
  const none = { signerShare: null, txShare: null, abiShare: null }

  it("is uncovered without a descriptor", () => {
    expect(statusOf(null, { ...none, signerShare: 1 })).toBe("uncovered")
  })

  it("prefers distinct senders over transactions", () => {
    expect(
      statusOf(descriptor, { ...none, signerShare: 0.96, txShare: 0.3 })
    ).toBe("covered")
    expect(
      statusOf(descriptor, { ...none, signerShare: 0.9, txShare: 1 })
    ).toBe("partial")
  })

  it("falls back to transactions, then to the ABI", () => {
    expect(statusOf(descriptor, { ...none, txShare: 0.95 })).toBe("covered")
    expect(statusOf(descriptor, { ...none, abiShare: 0.5 })).toBe("partial")
  })

  it("does not call an unmeasured descriptor covered", () => {
    expect(statusOf(descriptor, none)).toBe("partial")
  })
})

describe("the SQD portal source", () => {
  // A chain of 2-second blocks with one transaction to the contract every
  // 1,000 blocks, whose portal answers at most 25 blocks at a time.
  const HEAD = 2_000_000
  const CONTRACT = "0x00000000000000000000000000000000000000c0"
  const timeOf = (block: number) => 1_700_000_000 + 2 * block
  const requests: { fromBlock: number; toBlock: number }[] = []

  function portal(every: number) {
    return (input: string, init?: { body?: string }) => {
      const url = input
      if (url.endsWith("/finalized-head"))
        return Promise.resolve(Response.json({ number: HEAD, hash: "0xhead" }))
      const body = JSON.parse(init?.body ?? "{}") as {
        fromBlock: number
        toBlock: number
        includeAllBlocks?: boolean
        transactions?: { to: string[] }[]
      }
      if (body.includeAllBlocks)
        return Promise.resolve(
          new Response(
            `${JSON.stringify({ header: { number: body.fromBlock, timestamp: timeOf(body.fromBlock) } })}\n`
          )
        )
      requests.push({ fromBlock: body.fromBlock, toBlock: body.toBlock })
      expect(body.transactions).toEqual([{ to: [CONTRACT] }])
      const lines: string[] = []
      const first = Math.ceil(body.fromBlock / every) * every
      for (
        let block = first;
        block <= body.toBlock && lines.length < 25;
        block += every
      )
        lines.push(
          JSON.stringify({
            header: { number: block, timestamp: timeOf(block) },
            transactions: [
              {
                hash: `0x${block.toString(16).padStart(64, "0")}`,
                from: "0xAB",
                to: CONTRACT,
                sighash: "0xA9059CBB",
                status: block % 2 === 0 ? 1 : 0,
                transactionIndex: 0,
              },
            ],
          })
        )
      return Promise.resolve(
        lines.length ? new Response(`${lines.join("\n")}\n`) : new Response("")
      )
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
    requests.length = 0
  })

  it("scans back in growing windows until it has the latest transactions", async () => {
    vi.stubGlobal("fetch", portal(1_000))
    const { latestPortalTransactions } = await import("../tracker/sqd.js")
    const sample = await latestPortalTransactions(8453, CONTRACT, 100)
    expect(sample.complete30Days).toBe(false)
    expect(sample.txs).toHaveLength(100)
    expect(sample.txs[0]!.blockNumber).toBe(HEAD)
    expect(sample.txs[99]!.blockNumber).toBe(HEAD - 99_000)
    expect(sample.txs[0]!.selector).toBe("0xa9059cbb")
    expect(sample.txs[0]!.from).toBe("0xab")
    // Windows are contiguous, newest first.
    const windows = requests.filter(
      (r, i) => i === 0 || r.toBlock !== requests[i - 1]!.toBlock
    )
    expect(windows[0]!.toBlock).toBe(HEAD)
  })

  it("stops 30 days back and reports the scan complete", async () => {
    vi.stubGlobal("fetch", portal(1_000))
    const { latestPortalTransactions } = await import("../tracker/sqd.js")
    const sample = await latestPortalTransactions(8453, CONTRACT, 5_000)
    expect(sample.complete30Days).toBe(true)
    const oldest = sample.txs[sample.txs.length - 1]!
    const month = 30 * 86_400
    expect(timeOf(HEAD) - oldest.timestamp).toBeGreaterThanOrEqual(month)
    expect(timeOf(HEAD) - oldest.timestamp).toBeLessThan(month + 2 * 3_600)
    // Every transaction in the range, despite 25 blocks per answer.
    const hashes = new Set(sample.txs.map((t) => t.hash))
    expect(hashes.size).toBe(sample.txs.length)
    expect(sample.txs.length).toBe(
      Math.floor((HEAD - oldest.blockNumber) / 1_000) + 1
    )
  })

  it("scans a chain's contracts together and lets busy ones leave early", async () => {
    const BUSY = "0x00000000000000000000000000000000000000b0"
    const scans: string[][] = []
    // BUSY gets a transaction in every block, CONTRACT one every 1,000.
    vi.stubGlobal("fetch", (input: string, init?: { body?: string }) => {
      if (input.endsWith("/finalized-head"))
        return Promise.resolve(Response.json({ number: HEAD, hash: "0xhead" }))
      const body = JSON.parse(init?.body ?? "{}") as {
        fromBlock: number
        toBlock: number
        includeAllBlocks?: boolean
        transactions?: { to: string[] }[]
      }
      if (body.includeAllBlocks)
        return Promise.resolve(
          new Response(
            `${JSON.stringify({ header: { number: body.fromBlock, timestamp: timeOf(body.fromBlock) } })}\n`
          )
        )
      const wanted = body.transactions?.[0]?.to ?? []
      scans.push(wanted)
      const lines: string[] = []
      for (
        let block = body.fromBlock;
        block <= body.toBlock && lines.length < 400;
        block += 1
      ) {
        const txs = [
          ...(wanted.includes(BUSY) ? [BUSY] : []),
          ...(wanted.includes(CONTRACT) && block % 1_000 === 0
            ? [CONTRACT]
            : []),
        ].map((to, i) => ({
          hash: `0x${(block * 2 + i).toString(16).padStart(64, "0")}`,
          from: "0x01",
          to,
          sighash: "0x12345678",
          status: 1,
          transactionIndex: i,
        }))
        if (txs.length > 0)
          lines.push(
            JSON.stringify({
              header: { number: block, timestamp: timeOf(block) },
              transactions: txs,
            })
          )
      }
      return Promise.resolve(
        lines.length ? new Response(`${lines.join("\n")}\n`) : new Response("")
      )
    })
    const { latestPortalSamples } = await import("../tracker/sqd.js")
    const samples = await latestPortalSamples(8453, [BUSY, CONTRACT], 200)
    const busy = samples.get(BUSY)!
    expect(busy.txs).toHaveLength(200)
    expect(busy.txs[0]!.blockNumber).toBe(HEAD)
    expect(busy.txs[199]!.blockNumber).toBe(HEAD - 199)
    expect(busy.complete30Days).toBe(false)
    const quiet = samples.get(CONTRACT)!
    expect(quiet.txs).toHaveLength(200)
    expect(quiet.txs[0]!.blockNumber).toBe(HEAD)
    // Once BUSY had its sample, the scans asked for CONTRACT alone.
    expect(scans[0]).toEqual([BUSY, CONTRACT])
    expect(scans[scans.length - 1]).toEqual([CONTRACT])
  })

  it("keeps what whole windows read when the time limit cuts a scan short", async () => {
    // Every request takes a minute; the scan may read for 30.
    let now = 1_000_000_000
    vi.spyOn(Date, "now").mockImplementation(() => now)
    const answer = portal(1_000)
    vi.stubGlobal("fetch", (input: string, init?: { body?: string }) => {
      now += 60_000
      return answer(input, init)
    })
    const { latestPortalSamples } = await import("../tracker/sqd.js")
    const deadline = now + 30 * 60_000
    const samples = await latestPortalSamples(8453, [CONTRACT], 5_000, {
      deadline,
    })
    // It stopped within a request or two of the limit, not 30 days back.
    expect(now - deadline).toBeLessThanOrEqual(2 * 60_000)
    const sample = samples.get(CONTRACT)!
    expect(sample.complete30Days).toBe(false)
    expect(sample.covered).not.toBeNull()
    const { since, until } = sample.covered!
    expect(until).toBe(timeOf(HEAD))
    // `since` is where a whole window began: the window the limit cut short
    // left nothing behind, so the sample is every transaction since then.
    const from = (since - timeOf(0)) / 2
    expect(requests.some((r) => r.fromBlock === from)).toBe(true)
    expect(sample.txs.every((t) => t.blockNumber >= from)).toBe(true)
    expect(sample.txs).toHaveLength(
      Math.floor(HEAD / 1_000) - Math.ceil(from / 1_000) + 1
    )
    expect(until - since).toBeLessThan(30 * 86_400)
    // Past the limit, nothing more is read, and no contract gets a sample.
    const late = await latestPortalSamples(8453, [CONTRACT], 5_000, {
      deadline: now - 1,
    })
    expect(late.size).toBe(0)
  })

  it("takes an empty answer as no transactions in the range", async () => {
    vi.stubGlobal("fetch", portal(10_000_000))
    const { latestPortalTransactions } = await import("../tracker/sqd.js")
    const sample = await latestPortalTransactions(8453, CONTRACT, 100)
    expect(sample.txs).toHaveLength(0)
    expect(sample.complete30Days).toBe(true)
  })
})

describe("readDraftSummaries", () => {
  const dir = mkdtempSync(join(tmpdir(), "tracker-drafts-"))
  const write = (name: string, value: unknown) => {
    const path = join(dir, name)
    writeFileSync(path, JSON.stringify(value))
    return path
  }
  const key = "8453:0x00000000000000000000000000000000000000c0"
  const draft = {
    functions: 4,
    testedTxs: 8,
    lint: "pass",
    preview: {
      txHash: `0x${"ab".repeat(32)}`,
      intent: "Swap",
      fields: [{ label: "Send", value: "1 ETH" }],
    },
  }

  it("reads tested drafts by chainId:address", () => {
    const drafts = readDraftSummaries(write("ok.json", { [key]: draft }))
    expect(drafts.get(key)).toEqual(draft)
  })

  it("has no drafts when there is no file", () => {
    expect(readDraftSummaries(join(dir, "missing.json")).size).toBe(0)
  })

  it("refuses a malformed entry instead of dropping it", () => {
    const upper = `8453:0x${"C0".padStart(40, "0")}`
    expect(() =>
      readDraftSummaries(write("key.json", { [upper]: draft }))
    ).toThrow(/lowercase/)
    expect(() =>
      readDraftSummaries(
        write("lint.json", { [key]: { ...draft, lint: "fail" } })
      )
    ).toThrow(/lint/)
    expect(() =>
      readDraftSummaries(
        write("preview.json", {
          [key]: { ...draft, preview: { ...draft.preview, txHash: "0x1" } },
        })
      )
    ).toThrow(/preview/)
  })
})

describe("withoutChain", () => {
  it("drops a trailing chain name the page already shows", () => {
    expect(withoutChain("Across SpokePool (Arbitrum One)", 42161)).toBe(
      "Across SpokePool"
    )
    expect(withoutChain("Universal Router (v4)", 8453)).toBe(
      "Universal Router (v4)"
    )
  })
})

describe("addressesInCall", () => {
  it("finds addresses, nested ones and ones passed as bytes32", () => {
    const abi = parseAbi([
      "function deposit(bytes32 depositor, bytes32 inputToken, address recipient, (address token, uint256 amount)[] legs, bytes32 salt)",
    ])
    const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
    const recipient = getAddress("0x00000000000000000000000000000000000000aa")
    const weth = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
    const padded = (address: string): Hex =>
      `0x${address.slice(2).toLowerCase().padStart(64, "0")}`
    const input = encodeFunctionData({
      abi,
      functionName: "deposit",
      args: [
        `0x${"0".repeat(64)}`,
        padded(usdc),
        recipient,
        [{ token: weth, amount: 1n }],
        `0x${"ab".repeat(32)}`,
      ],
    })
    expect(addressesInCall(abi, input).sort()).toEqual(
      [usdc, recipient, weth].sort()
    )
  })
})

describe("choosePreview", () => {
  const test = (
    intent: string,
    fields: [string, string][],
    sentence = true
  ) => ({
    expected: {
      intent,
      ...(sentence ? { interpolatedIntent: intent } : {}),
      fields: fields.map(([label, value]) => ({ label, value })),
    },
  })

  it("prefers a clean render with a sentence, then the most-called function", () => {
    const raw = test("Swap", [["Send", "123456789012345678901"]])
    const clean = test("Swap 1.5 ETH for USDC", [["Send", "1.5 ETH"]])
    const plain = test("Swap", [["Send", "2 ETH"]], false)
    expect(choosePreview([raw, plain, clean])).toBe(clean)
    const first = test("Bridge 1 ETH", [["Amount", "1 ETH"]])
    expect(choosePreview([first, clean])).toBe(first)
  })

  it("never shows text a token wrote that reads like a link or a message", () => {
    const scam = test("Swap 1 ETH", [["Receive", "1000 Claim at x.com"]])
    const link = test("Swap", [["Receive", "5 visit-https://x.io"]])
    expect(choosePreview([scam, link])).toBeUndefined()
    const ok = test("Swap 2 ETH", [["Send", "2 ETH"]], false)
    expect(choosePreview([scam, ok])).toBe(ok)
  })
})

describe("draftCandidates", () => {
  const dir = mkdtempSync(join(tmpdir(), "tracker-candidates-"))
  const A = "0x00000000000000000000000000000000000000a1"
  const B = "0x00000000000000000000000000000000000000b2"
  const C = "0x00000000000000000000000000000000000000c3"
  const D = "0x00000000000000000000000000000000000000d4"
  const record = (
    chainId: number,
    address: string,
    count: number,
    senders: number,
    perDay: number
  ) => {
    const path = join(dir, "data", "onchain", String(chainId))
    mkdirSync(path, { recursive: true })
    writeFileSync(
      join(path, `${address}.json`),
      JSON.stringify({
        chainId,
        address,
        abi: { source: "sourcify", address, functions: 3 },
        sample: { count, senders, perDay },
      })
    )
  }
  const contract = (
    chainId: number,
    address: string,
    name: string,
    status: string
  ) => ({ chainId, address, name, status, sample: { count: 1 } })
  mkdirSync(join(dir, "data"), { recursive: true })
  writeFileSync(
    join(dir, "data", "coverage.json"),
    JSON.stringify({
      protocols: [
        {
          id: "swap",
          name: "Swap",
          contracts: [
            contract(1, A, "Router", "uncovered"),
            contract(8453, B, "Router", "uncovered"),
            contract(1, C, "Pool", "covered"),
          ],
        },
        {
          id: "lend",
          name: "Lend",
          contracts: [contract(10, D, "Market", "uncovered")],
        },
      ],
    })
  )
  // Router: 100 senders per 1,000 calls at 1,000 a day on Ethereum (100 a
  // day), 500 per 1,000 at 1,000 a day on Base (500 a day).
  record(1, A, 1000, 100, 1000)
  record(8453, B, 1000, 500, 1000)
  record(1, C, 1000, 900, 5000)
  record(10, D, 100, 50, 400)

  it("groups a contract's deployments and ranks by senders a day", () => {
    const candidates = draftCandidates(dir)
    expect(candidates.map((c) => `${c.protocol}/${c.name}`)).toEqual([
      "swap/Router",
      "lend/Market",
    ])
    const router = candidates[0]!
    expect(router.primary).toEqual({ chainId: 8453, address: B })
    expect(router.others).toEqual([{ chainId: 1, address: A }])
    expect(router.sendersPerDay).toBeCloseTo(600)
    expect(router.owner).toBe("Swap")
    expect(candidates[1]!.sendersPerDay).toBeCloseTo(200)
  })
})
