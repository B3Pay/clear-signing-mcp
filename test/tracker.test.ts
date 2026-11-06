import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { encodeFunctionData, getAddress, parseAbi, type Hex } from "viem"
import { addressesInCall, summarize, type ListedTx } from "../tracker/fetch.js"
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
    const summary = summarize("blockscout-txlist", 1000, txs, false, NOW)
    expect(summary.perDay).toBeCloseTo(3 / 2)
    expect(summary.last30Days).toBe(3)
  })

  it("rates a sample that reaches back 30 days by its last 30 days", () => {
    const txs = [tx(NOW - DAY), tx(NOW - 10 * DAY), tx(NOW - 40 * DAY)]
    const summary = summarize("blockscout-txlist", 1000, txs, false, NOW)
    expect(summary.perDay).toBeCloseTo(2 / 30)
  })

  it("rates a complete 30-day scan by its count, even when empty", () => {
    expect(summarize("sqd-portal", 1000, [], true, NOW).perDay).toBe(0)
    const one = summarize("sqd-portal", 1000, [tx(NOW - DAY)], true, NOW)
    expect(one.perDay).toBeCloseTo(1 / 30)
  })

  it("has no rate for an empty sample that is not known to be complete", () => {
    expect(summarize("blockscout-txlist", 1000, [], false, NOW).perDay).toBe(
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
    const summary = summarize("blockscout-txlist", 1000, txs, false, NOW)
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
