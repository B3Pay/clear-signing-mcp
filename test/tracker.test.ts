import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  toFunctionSelector,
  type Hex,
} from "viem"
import {
  addressesInCall,
  latestTransactions,
  summarize,
  type ListedTx,
} from "../tracker/fetch.js"
import { choosePreview, draftCandidates } from "../tracker/draft.js"
import type {
  DescribedFunctions,
  DescriptorFacts,
  RegistrySnapshot,
} from "../tracker/registry.js"
import {
  bestElsewhere,
  buildReport,
  readDraftSummaries,
  statusOf,
  withoutChain,
} from "../tracker/report.js"
import type { UniverseProtocol } from "../tracker/universe.js"

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

function sampleIn<T>(samples: Map<string, T | Error>, address: string): T {
  const found = samples.get(address)
  if (found instanceof Error) throw found
  if (found === undefined) throw new Error(`no sample for ${address}`)
  return found
}

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
    const busy = sampleIn(samples, BUSY)
    expect(busy.txs).toHaveLength(200)
    expect(busy.txs[0]!.blockNumber).toBe(HEAD)
    expect(busy.txs[199]!.blockNumber).toBe(HEAD - 199)
    expect(busy.complete30Days).toBe(false)
    const quiet = sampleIn(samples, CONTRACT)
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
    const sample = sampleIn(samples, CONTRACT)
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
    expect(late.get(CONTRACT)).toBeInstanceOf(Error)
  })

  it("stops only the contracts of a batch the portal fails", async () => {
    // 60 quiet contracts: one request of 50 and one of 10 per window. The
    // portal answers each with the last block it read, and fails the batch
    // of 50 from the second window on, and a lone contract always.
    const quiet = Array.from(
      { length: 60 },
      (_, i) => `0x${(0xd000 + i).toString(16).padStart(40, "0")}`
    )
    const LONE = "0x00000000000000000000000000000000000000e0"
    const logged: string[] = []
    vi.stubGlobal("fetch", (input: string, init?: { body?: string }) => {
      if (input.endsWith("/finalized-head"))
        return Promise.resolve(Response.json({ number: HEAD, hash: "0xhead" }))
      const body = JSON.parse(init?.body ?? "{}") as {
        fromBlock: number
        toBlock: number
        includeAllBlocks?: boolean
        transactions?: { to: string[] }[]
      }
      const marker = (block: number) =>
        new Response(
          `${JSON.stringify({ header: { number: block, timestamp: timeOf(block) } })}\n`
        )
      if (body.includeAllBlocks) return Promise.resolve(marker(body.fromBlock))
      const wanted = body.transactions?.[0]?.to ?? []
      if (
        wanted.includes(LONE) ||
        (wanted.length === 50 && body.fromBlock < HEAD - 1_000)
      )
        return Promise.resolve(new Response("broken", { status: 500 }))
      return Promise.resolve(marker(body.toBlock))
    })
    const { latestPortalSamples } = await import("../tracker/sqd.js")
    const samples = await latestPortalSamples(8453, quiet, 100, {
      log: (line) => logged.push(line),
    })
    const firstWindow = HEAD - 299
    const cut = quiet.filter((a) => {
      const sample = sampleIn(samples, a)
      return !sample.complete30Days
    })
    expect(cut).toHaveLength(50)
    for (const address of cut)
      expect(sampleIn(samples, address).covered).toEqual({
        since: timeOf(firstWindow),
        until: timeOf(HEAD),
      })
    expect(logged.some((line) => line.includes("50 contracts stop here"))).toBe(
      true
    )
    // A contract no whole window read gets the portal's error.
    const lone = await latestPortalSamples(8453, [LONE], 100)
    expect(lone.get(LONE)).toBeInstanceOf(Error)
    expect((lone.get(LONE) as Error).message).toContain("HTTP 500")
  })

  it("takes an empty answer as no transactions in the range", async () => {
    vi.stubGlobal("fetch", portal(10_000_000))
    const { latestPortalTransactions } = await import("../tracker/sqd.js")
    const sample = await latestPortalTransactions(8453, CONTRACT, 100)
    expect(sample.txs).toHaveLength(0)
    expect(sample.complete30Days).toBe(true)
  })
})

describe("latestTransactions", () => {
  const ADDRESS = getAddress("0x00000000000000000000000000000000000000c1")
  const txlist = {
    status: "1",
    message: "OK",
    result: [
      {
        hash: `0x${"ab".repeat(32)}`,
        timeStamp: String(NOW - DAY),
        from: "0x00000000000000000000000000000000000000AA",
        to: ADDRESS.toLowerCase(),
        input: "0xa9059cbb0000",
        isError: "0",
        txreceipt_status: "1",
      },
    ],
  }
  const urls: string[] = []

  afterEach(() => {
    vi.unstubAllGlobals()
    urls.length = 0
  })

  it("falls back to Blockscout on Ethereum when the portal failed", async () => {
    vi.stubGlobal("fetch", (input: string) => {
      urls.push(input)
      return Promise.resolve(Response.json(txlist))
    })
    const listed = await latestTransactions(
      1,
      ADDRESS,
      10,
      new Error("HTTP 529 from the portal")
    )
    expect(listed.summary.source).toBe("blockscout-txlist")
    expect(listed.txs).toHaveLength(1)
    expect(listed.txs[0]!.selector).toBe("0xa9059cbb")
    expect(urls[0]).toContain("https://eth.blockscout.com/api?module=account")
  })

  it("does not ask Blockscout where it cannot answer, and names both failures", async () => {
    vi.stubGlobal("fetch", (input: string) => {
      urls.push(input)
      return Promise.resolve(new Response("{}", { status: 400 }))
    })
    await expect(
      latestTransactions(8453, ADDRESS, 10, new Error("portal down"))
    ).rejects.toThrow("portal down")
    expect(urls).toHaveLength(0)
    await expect(
      latestTransactions(10, ADDRESS, 10, new Error("portal down"))
    ).rejects.toThrow(/SQD portal: portal down; Blockscout: .*400/)
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
    selectors: ["0x0dbe671f", "0x12345678", "0x4df7e3d0", "0xabcdef01"],
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
    expect(() =>
      readDraftSummaries(
        write("selectors.json", {
          [key]: { ...draft, selectors: draft.selectors.slice(1) },
        })
      )
    ).toThrow(/selectors/)
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
  const E = "0x00000000000000000000000000000000000000e5"
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
    status: string,
    elsewhere: {
      signerShareCovered: number | null
      txShareCovered: number | null
    } | null = null
  ) => ({ chainId, address, name, status, sample: { count: 1 }, elsewhere })
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
          contracts: [
            // A descriptor elsewhere formats 30% of D's calls: still drafted.
            contract(10, D, "Market", "uncovered", {
              signerShareCovered: null,
              txShareCovered: 0.3,
            }),
            // ...and 60% of E's senders' calls: extending it is the change.
            contract(42161, E, "Market", "uncovered", {
              signerShareCovered: 0.6,
              txShareCovered: 0.1,
            }),
          ],
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
  record(42161, E, 100, 100, 1000)

  it("groups a contract's deployments and ranks by senders a day, leaving out one described elsewhere", () => {
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

describe("bestElsewhere", () => {
  const X = "0x00000000000000000000000000000000000000e5"
  const Y = "0x00000000000000000000000000000000000000f6"
  const described = (
    chainId: number,
    address: string,
    selectors: string[]
  ): DescribedFunctions => ({
    chainId,
    address,
    path: `registry/p/calldata-${chainId}.json`,
    url: `https://github.com/ethereum/clear-signing-erc7730-registry/blob/c/registry/p/calldata-${chainId}.json`,
    selectors: new Set(selectors),
  })
  // 90 calls of a by 2 senders, 10 of b by 8; plain transfers left out.
  const sample = {
    selectors: { "0xaaaaaaaa": 90, "0xbbbbbbbb": 10, "0x": 5 },
    sendersBySelector: { "0xaaaaaaaa": 2, "0xbbbbbbbb": 8, "0x": 50 },
  }
  const abi = new Set(["0xaaaaaaaa", "0xbbbbbbbb", "0xcccccccc"])

  it("picks the descriptor that formats the most senders' calls", () => {
    const best = bestElsewhere(X, abi, sample, [
      { described: described(1, Y, ["0xaaaaaaaa"]), label: "Router" },
      {
        described: described(137, X, ["0xbbbbbbbb", "0xcccccccc"]),
        label: "Router",
      },
    ])
    expect(best).toMatchObject({
      chainId: 137,
      chainName: "Polygon",
      address: getAddress(X),
      sameAddress: true,
      signerShareCovered: 0.8,
      txShareCovered: 0.1,
    })
  })

  it("passes over a descriptor that formats a function the ABI lacks", () => {
    const candidates = [
      {
        described: described(1, Y, ["0xbbbbbbbb", "0xdddddddd"]),
        label: "Router",
      },
    ]
    expect(bestElsewhere(X, abi, sample, candidates)).toBeNull()
  })

  it("reads an ABI with no functions as no ABI", () => {
    const best = bestElsewhere(X, new Set(), sample, [
      { described: described(1, Y, ["0xbbbbbbbb"]), label: "Router" },
      { described: described(1, X, ["0xaaaaaaaa"]), label: "Router" },
    ])
    expect(best).toMatchObject({ address: getAddress(X), sameAddress: true })
  })

  it("takes only the same address on another chain when there is no ABI", () => {
    const best = bestElsewhere(X, null, sample, [
      { described: described(1, Y, ["0xbbbbbbbb"]), label: "Router" },
      { described: described(1, X, ["0xaaaaaaaa"]), label: "Router" },
    ])
    expect(best).toMatchObject({
      address: getAddress(X),
      sameAddress: true,
      signerShareCovered: 0.2,
    })
  })

  it("offers no chain it cannot name, and no descriptor that formats no recent call", () => {
    const sepolia = [
      { described: described(11155111, X, ["0xbbbbbbbb"]), label: "Router" },
    ]
    expect(bestElsewhere(X, abi, sample, sepolia)).toBeNull()
    const idle = [
      { described: described(1, X, ["0xcccccccc"]), label: "Router" },
    ]
    expect(bestElsewhere(X, abi, sample, idle)).toBeNull()
  })

  it("measures by transactions when the sample has no senders", () => {
    const best = bestElsewhere(X, abi, { selectors: sample.selectors }, [
      { described: described(1, X, ["0xaaaaaaaa"]), label: "Router" },
    ])
    expect(best).toMatchObject({
      txShareCovered: 0.9,
      signerShareCovered: null,
    })
  })
})

describe("the report's descriptor elsewhere", () => {
  // The registry's Disperse descriptor lists Ethereum only; the tracker
  // follows the same address on Arbitrum One, and a lookalike on Base whose
  // ABI lacks one of the functions the descriptor formats.
  const DISPERSE = getAddress("0xD152f549545093347A162Dce210e7293f1452150")
  const LOOKALIKE = getAddress("0x00000000000000000000000000000000000000b7")
  const root = mkdtempSync(join(tmpdir(), "tracker-elsewhere-"))
  const registryDir = join(root, "registry-clone")
  const dataDir = join(root, "data")
  const path = "registry/disperse/calldata-Disperse.json"
  mkdirSync(join(registryDir, "registry", "disperse"), { recursive: true })
  copyFileSync(
    join(
      import.meta.dirname,
      "fixtures",
      "registry",
      "disperse",
      "calldata-Disperse.json"
    ),
    join(registryDir, path)
  )
  const registry: RegistrySnapshot = {
    dir: registryDir,
    commit: "ef582c2f03bfbd062b7e3889b55dd3b45c3d5494",
    committedAt: "2026-11-04T12:20:57+00:00",
    index: {
      calldataIndex: { [`eip155:1:${DISPERSE.toLowerCase()}`]: path },
      typedDataIndex: {},
    },
  }
  const full = parseAbi([
    "function disperseEther(address[] recipients, uint256[] values) payable",
    "function disperseToken(address token, address[] recipients, uint256[] values)",
    "function disperseTokenSimple(address token, address[] recipients, uint256[] values)",
  ])
  const ether = toFunctionSelector(full[0])
  const token = toFunctionSelector(full[1])
  const busy = {
    source: "sqd-portal",
    requested: 1000,
    count: 40,
    failed: 0,
    oldest: NOW - 10 * DAY,
    newest: NOW,
    last30Days: 40,
    perDay: 4,
    selectors: { [ether]: 30, [token]: 10 },
    senders: 12,
    sendersBySelector: { [ether]: 8, [token]: 4 },
  }
  const write = (
    chainId: number,
    address: string,
    abi: typeof full,
    sample: object = busy
  ) => {
    const at = (kind: string) =>
      join(dataDir, kind, String(chainId), `${address.toLowerCase()}.json`)
    mkdirSync(join(dataDir, "onchain", String(chainId)), { recursive: true })
    mkdirSync(join(dataDir, "abis", String(chainId)), { recursive: true })
    writeFileSync(
      at("abis"),
      JSON.stringify({ source: "sourcify", address, abi })
    )
    writeFileSync(
      at("onchain"),
      JSON.stringify({
        format: 2,
        chainId,
        address,
        fetchedAt: "2026-11-06T12:00:00.000Z",
        codeBytes: 1000,
        sourcify: { status: "verified", match: "exact_match" },
        blockscout: { status: "skipped", reason: "test" },
        abi: { source: "sourcify", address, functions: abi.length },
        sample,
      })
    )
  }
  write(1, DISPERSE, full)
  write(42161, DISPERSE, full)
  write(8453, LOOKALIKE, full.slice(0, 2) as unknown as typeof full)
  // OP Mainnet: a complete 30-day scan that found nothing; Base: a failed read.
  const month = { since: NOW - 30 * DAY, until: NOW - 600 }
  write(10, DISPERSE, full, {
    ...busy,
    count: 0,
    oldest: null,
    newest: null,
    last30Days: 0,
    perDay: 0,
    covered: month,
    selectors: {},
    senders: 0,
    sendersBySelector: {},
  })
  write(8453, DISPERSE, full, { error: "SQD portal: HTTP 529" })
  const contract = (
    chainId: 1 | 10 | 8453 | 42161,
    address: `0x${string}`
  ) => ({
    chainId,
    address,
    name: "Disperse",
    label: "Disperse",
    role: "Sends ETH or a token to many addresses in one call",
    source: "https://disperse.app/",
    sourceKind: "raw" as const,
  })
  const universe: UniverseProtocol[] = [
    {
      protocol: "disperse",
      name: "Disperse",
      category: "payments",
      website: "https://disperse.app/",
      group: "payments.json",
      contracts: [
        contract(1, DISPERSE),
        contract(42161, DISPERSE),
        contract(8453, LOOKALIKE),
        contract(10, DISPERSE),
        contract(8453, DISPERSE),
      ],
    },
  ]

  it("offers the same address's descriptor on another chain, and counts it", async () => {
    const report = await buildReport({
      universe,
      dataDir,
      registry,
      previews: false,
      now: new Date(NOW * 1000),
    })
    const byChain = new Map(
      report.protocols[0]!.contracts.filter(
        (c) => c.chainId !== 8453 || c.address === LOOKALIKE
      ).map((c) => [c.chainId, c])
    )
    expect(byChain.get(1)).toMatchObject({ status: "covered", elsewhere: null })
    expect(byChain.get(42161)).toMatchObject({
      status: "uncovered",
      elsewhere: {
        chainId: 1,
        chainName: "Ethereum",
        address: DISPERSE,
        label: "Disperse",
        sameAddress: true,
        path,
        signerShareCovered: 1,
        txShareCovered: 1,
      },
    })
    // The lookalike's ABI lacks disperseTokenSimple, which the descriptor formats.
    expect(byChain.get(8453)).toMatchObject({
      status: "uncovered",
      elsewhere: null,
    })
    expect(report.totals.describedElsewhere).toBe(1)
    expect(report.chains["42161"].describedElsewhere).toBe(1)
    expect(report.chains["8453"].describedElsewhere).toBe(0)
  })

  it("measures what a draft would format of the contract's recent calls", async () => {
    const report = await buildReport({
      universe,
      dataDir,
      registry,
      previews: false,
      now: new Date(NOW * 1000),
      drafts: new Map([
        [
          `8453:${LOOKALIKE.toLowerCase()}`,
          { functions: 1, selectors: [ether], testedTxs: 3, lint: "pass" },
        ],
      ]),
    })
    const lookalike = report.protocols[0]!.contracts.find(
      (c) => c.address === LOOKALIKE
    )
    // disperseEther: 30 of the 40 calls, 8 of the 12 senders per function.
    expect(lookalike?.draft).toEqual({
      functions: 1,
      testedTxs: 3,
      lint: "pass",
      txShareCovered: 0.75,
      signerShareCovered: 0.6667,
    })
  })

  it("gives an empty sample the span it read, and a failed read no sample", async () => {
    const report = await buildReport({
      universe,
      dataDir,
      registry,
      previews: false,
      now: new Date(NOW * 1000),
    })
    const at = (chainId: number, address: string) =>
      report.protocols[0]!.contracts.find(
        (c) => c.chainId === chainId && c.address === address
      )
    // A complete scan with no calls: 0 a day over the month it read, and
    // nothing for a descriptor elsewhere to format.
    expect(at(10, DISPERSE)).toMatchObject({
      status: "uncovered",
      sample: {
        count: 0,
        perDay: 0,
        oldest: new Date(month.since * 1000).toISOString(),
        newest: new Date(month.until * 1000).toISOString(),
        txShareCovered: null,
        signerShareCovered: null,
      },
      topFunctions: [],
      elsewhere: null,
    })
    expect(at(8453, DISPERSE)).toMatchObject({ sample: null, elsewhere: null })
  })
})
