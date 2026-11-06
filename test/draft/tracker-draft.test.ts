import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { parseAbi, toFunctionSelector } from "viem"
import {
  chooseSelectors,
  MAX_SELECTORS,
  sha256File,
  writeSummary,
} from "../../tracker/draft.js"
import type { OnchainRecord, SamplesFile } from "../../tracker/data.js"
import { readDraftSummaries } from "../../tracker/report.js"

const ABI = parseAbi([
  "function swap(uint256 amountIn, address tokenIn)",
  "function deposit(uint256 amount)",
  "function withdraw(uint256 amount)",
  "function claim()",
  "function balanceOf(address owner) view returns (uint256)",
])
const SWAP = toFunctionSelector("swap(uint256,address)")
const DEPOSIT = toFunctionSelector("deposit(uint256)")
const WITHDRAW = toFunctionSelector("withdraw(uint256)")
const CLAIM = toFunctionSelector("claim()")

function record(sample: {
  selectors: Record<string, number>
  sendersBySelector?: Record<string, number>
}): OnchainRecord {
  return { sample } as unknown as OnchainRecord
}

function samplesOf(...selectors: string[]): SamplesFile {
  return {
    txs: selectors.map((selector) => ({ input: `${selector}00` })),
  } as unknown as SamplesFile
}

describe("chooseSelectors", () => {
  it("ranks by distinct senders, as the report measures coverage", () => {
    // A bot sends most swaps; deposits come from many people.
    const choice = chooseSelectors(
      record({
        selectors: { [SWAP]: 900, [DEPOSIT]: 80, [WITHDRAW]: 17, [CLAIM]: 3 },
        sendersBySelector: {
          [SWAP]: 2,
          [DEPOSIT]: 80,
          [WITHDRAW]: 17,
          [CLAIM]: 1,
        },
      }),
      samplesOf(SWAP, DEPOSIT, WITHDRAW, CLAIM),
      ABI
    )
    // 80 + 17 + 2 senders of 100 reach 99%: claim is left out.
    expect(choice.selectors).toEqual([DEPOSIT, WITHDRAW, SWAP])
    expect(choice.lines.at(-1)).toContain("99.0% of the sample's 100 senders")
  })

  it("ranks by calls when the sample has no sender counts", () => {
    const choice = chooseSelectors(
      record({ selectors: { [SWAP]: 900, [DEPOSIT]: 95, [CLAIM]: 5 } }),
      samplesOf(SWAP, DEPOSIT, CLAIM),
      ABI
    )
    expect(choice.selectors).toEqual([SWAP, DEPOSIT])
  })

  it("leaves out plain transfers, selectors outside the ABI and untested ones", () => {
    const choice = chooseSelectors(
      record({
        selectors: {
          "0x": 500,
          "0xdeadbeef": 300,
          [SWAP]: 100,
          [DEPOSIT]: 100,
        },
      }),
      samplesOf(DEPOSIT),
      ABI
    )
    expect(choice.selectors).toEqual([DEPOSIT])
    const lines = choice.lines.join("\n")
    expect(lines).toContain("0xdeadbeef (300 calls")
    expect(lines).toContain("not a function of the ABI")
    expect(lines).toContain("no transaction in the sample to test it with")
    expect(lines).toContain("500 plain transfers")
  })

  it(`stops at ${MAX_SELECTORS} functions`, () => {
    const many = Array.from(
      { length: 20 },
      (_, i) => `function f${i}(uint256 a)`
    )
    const abi = parseAbi(many)
    const selectors = many.map((_, i) => toFunctionSelector(`f${i}(uint256)`))
    const choice = chooseSelectors(
      record({ selectors: Object.fromEntries(selectors.map((s) => [s, 10])) }),
      samplesOf(...selectors),
      abi
    )
    expect(choice.selectors).toHaveLength(MAX_SELECTORS)
  })

  it("chooses nothing when the sample failed", () => {
    const choice = chooseSelectors(
      { sample: { error: "HTTP 503" } } as unknown as OnchainRecord,
      samplesOf(),
      ABI
    )
    expect(choice.selectors).toEqual([])
  })
})

describe("writeSummary", () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  const ADDRESS = "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5"
  const HASH = `0x${"ab".repeat(32)}`

  function writeDraft(validation: { passed: boolean; lint: string }) {
    dir = mkdtempSync(join(tmpdir(), "draft-summary-"))
    const entity = join(dir, "acme")
    mkdirSync(join(entity, "testsv2"), { recursive: true })
    const descriptor = join(entity, "calldata-Thing.json")
    const tests = join(entity, "testsv2", "calldata-Thing.tests.json")
    writeFileSync(
      descriptor,
      JSON.stringify({
        context: {
          contract: { deployments: [{ chainId: 8453, address: ADDRESS }] },
        },
        metadata: { owner: "Acme" },
        display: { formats: { "a()": {}, "b()": {} } },
      })
    )
    writeFileSync(
      tests,
      JSON.stringify({
        descriptor: "../calldata-Thing.json",
        tests: [
          {
            description: "a",
            rawTx: "0x",
            txHash: `0x${"cd".repeat(32)}`,
            expected: { intent: "Do a", fields: [] },
          },
          {
            description: "b",
            rawTx: "0x",
            txHash: HASH,
            expected: {
              intent: "Swap",
              interpolatedIntent: "Swap 1 ETH for at least 2 USDC",
              fields: [
                { label: "Amount to send", value: "1 ETH" },
                {
                  label: "Action",
                  value: {
                    intent: "Approve",
                    interpolatedIntent: "Approve 5 USDC",
                    fields: [],
                  },
                },
              ],
            },
          },
        ],
      })
    )
    writeFileSync(
      join(entity, "calldata-Thing.validation.json"),
      JSON.stringify({
        descriptor: "calldata-Thing.json",
        tests: "testsv2/calldata-Thing.tests.json",
        descriptorSha256: sha256File(descriptor),
        testsSha256: sha256File(tests),
        passed: validation.passed,
        checks: {
          lint: { status: validation.lint },
          tests: { status: "pass", passed: 2 },
        },
      })
    )
    return { dir, descriptor }
  }

  it("lists a validated draft by chainId:address, as the report reads it", () => {
    const { dir } = writeDraft({ passed: true, lint: "warnings" })
    const expected = {
      functions: 2,
      testedTxs: 2,
      lint: "warnings",
      // The preview is the first test that has a sentence to show.
      preview: {
        txHash: HASH,
        intent: "Swap 1 ETH for at least 2 USDC",
        fields: [
          { label: "Amount to send", value: "1 ETH" },
          { label: "Action", value: "Approve 5 USDC" },
        ],
      },
    }
    const key = `8453:${ADDRESS.toLowerCase()}`
    expect(writeSummary(dir)).toEqual({ [key]: expected })
    const read = readDraftSummaries(join(dir, "summary.json"))
    expect([...read.keys()]).toEqual([key])
    expect(read.get(key)).toEqual(expected)
  })

  it("leaves out a draft that failed, or changed since it was checked", () => {
    const failed = writeDraft({ passed: false, lint: "pass" })
    expect(writeSummary(failed.dir)).toEqual({})
    rmSync(failed.dir, { recursive: true, force: true })

    const changed = writeDraft({ passed: true, lint: "pass" })
    writeFileSync(changed.descriptor, "{}")
    expect(writeSummary(changed.dir)).toEqual({})
  })
})
