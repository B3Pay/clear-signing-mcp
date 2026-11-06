import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import {
  encodeFunctionData,
  parseAbi,
  parseAbiItem,
  toFunctionSelector,
} from "viem"
import {
  chooseSelectors,
  draftContract,
  MAX_SELECTORS,
  readableFormat,
  sha256File,
  writeSummary,
} from "../../tracker/draft.js"
import {
  dataPaths,
  writeJson,
  type OnchainRecord,
  type SampleTx,
  type SamplesFile,
} from "../../tracker/data.js"
import type { DraftTests } from "../../src/draft/index.js"
import { draftRegistry } from "../../tracker/registry.js"
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
      selectors: [
        toFunctionSelector("function a()"),
        toFunctionSelector("function b()"),
      ].sort(),
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

describe("readableFormat", () => {
  const EXECUTE = "execute(bytes commands,bytes[] inputs,uint256 deadline)"
  const execute = [
    { path: "@.value", label: "Value sent", format: "amount" as const },
    { path: "commands", label: "Commands", format: "raw" as const },
    { path: "inputs.[]", label: "Inputs", format: "raw" as const },
    {
      path: "deadline",
      label: "Deadline",
      format: "date" as const,
      params: { encoding: "timestamp" },
    },
  ]

  it("does not count a format that shows its payload as raw bytes", () => {
    expect(readableFormat(EXECUTE, { fields: execute })).toBe(false)
    expect(
      readableFormat("receiveMessage(bytes message,bytes attestation)", {
        fields: [
          { path: "message", label: "Message", format: "raw" },
          { path: "attestation", label: "Attestation", format: "raw" },
        ],
      })
    ).toBe(false)
  })

  it("counts a format that shows an amount, or no raw bytes", () => {
    // An amount besides the value sent makes the call readable.
    expect(
      readableFormat("swap(address tokenFrom,uint256 amount,bytes data)", {
        fields: [
          {
            path: "amount",
            label: "Amount to send",
            format: "tokenAmount",
            params: { tokenPath: "tokenFrom" },
          },
          { path: "data", label: "Data", format: "raw" },
        ],
      })
    ).toBe(true)
    // WETH's deposit(): the value sent, and nothing raw.
    expect(
      readableFormat("deposit()", {
        fields: [{ path: "@.value", label: "Amount", format: "amount" }],
      })
    ).toBe(true)
    // Raw bytes a draft hides are not shown.
    expect(
      readableFormat(EXECUTE, {
        fields: execute.map((f) =>
          f.format === "raw" ? { ...f, visible: "never" as const } : f
        ),
      })
    ).toBe(true)
  })

  it("lists only a draft's readable formats, and leaves out a draft with none", () => {
    const dir = mkdtempSync(join(tmpdir(), "draft-readable-"))
    try {
      const ADDRESS = "0x6fF5693b99212Da76ad316178A184AB56D299b43"
      const SWAP = "swap(address tokenIn,uint256 amountIn)"
      const write = (name: string, formats: Record<string, unknown>) => {
        const entity = join(dir, name)
        mkdirSync(join(entity, "testsv2"), { recursive: true })
        const descriptor = join(entity, "calldata-Router.json")
        const tests = join(entity, "testsv2", "calldata-Router.tests.json")
        writeFileSync(
          descriptor,
          JSON.stringify({
            context: {
              contract: {
                deployments: [
                  {
                    chainId: name === "both" ? 8453 : 10,
                    address: ADDRESS,
                  },
                ],
              },
            },
            metadata: { owner: "Acme" },
            display: { formats },
          })
        )
        const cases = Object.keys(formats).map((key, i) => ({
          description: `${key.split("(")[0]} ${toFunctionSelector(`function ${key}`)} 0x${String(i).repeat(8)}`,
          rawTx: "0x",
          txHash: `0x${String(i + 1).repeat(64)}`,
          expected: {
            intent: key.split("(")[0],
            fields: [{ label: "Field", value: "1" }],
          },
        }))
        writeFileSync(
          tests,
          JSON.stringify({
            descriptor: "../calldata-Router.json",
            tests: cases,
          })
        )
        writeFileSync(
          join(entity, "calldata-Router.validation.json"),
          JSON.stringify({
            descriptor: "calldata-Router.json",
            tests: "testsv2/calldata-Router.tests.json",
            descriptorSha256: sha256File(descriptor),
            testsSha256: sha256File(tests),
            passed: true,
            checks: {
              lint: { status: "pass" },
              tests: { status: "pass", passed: cases.length },
            },
          })
        )
      }
      const swap = {
        intent: "Swap",
        fields: [
          {
            path: "amountIn",
            label: "Amount to send",
            format: "tokenAmount",
            params: { tokenPath: "tokenIn" },
          },
        ],
      }
      write("both", {
        [EXECUTE]: { intent: "Execute", fields: execute },
        [SWAP]: swap,
      })
      write("opaque", { [EXECUTE]: { intent: "Execute", fields: execute } })
      const summary = writeSummary(dir)
      expect(Object.keys(summary)).toEqual([`8453:${ADDRESS.toLowerCase()}`])
      const only = summary[`8453:${ADDRESS.toLowerCase()}`]
      expect(only?.functions).toBe(1)
      expect(only?.selectors).toEqual([toFunctionSelector(`function ${SWAP}`)])
      expect(only?.testedTxs).toBe(1)
      expect(only?.preview?.intent).toBe("swap")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("draftContract with a registry clone", () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  // A contract that makes the calls it is given, here one to Disperse on
  // Ethereum, which the clone describes (test/fixtures/registry).
  const EXECUTOR = "0x000000000000000000000000000000000000e7ec"
  const DISPERSE = "0xD152f549545093347A162Dce210e7293f1452150"
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  const execute = parseAbiItem(
    "function execute((address target, uint256 value, bytes callData)[] calls) payable"
  )
  const callData = encodeFunctionData({
    abi: [
      parseAbiItem(
        "function disperseToken(address token, address[] recipients, uint256[] values)"
      ),
    ],
    functionName: "disperseToken",
    args: [USDC, ["0x00000000000000000000000000000000000000b1"], [1_500_000n]],
  })
  const sample = {
    hash: `0x${"ab".repeat(32)}`,
    chainId: 1,
    blockNumber: 1,
    timestamp: 1,
    from: "0x00000000000000000000000000000000000000a1",
    to: EXECUTOR,
    value: "0",
    input: encodeFunctionData({
      abi: [execute],
      functionName: "execute",
      args: [[{ target: DISPERSE, value: 0n, callData }]],
    }),
    nonce: 7,
    gas: "500000",
    type: "eip1559",
    maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000",
    status: "success",
  } satisfies SampleTx

  it("renders a call a calldata field carries through the clone's descriptor", async () => {
    dir = mkdtempSync(join(tmpdir(), "draft-contract-"))
    const clone = join(dir, "clone")
    mkdirSync(join(clone, "registry", "disperse"), { recursive: true })
    copyFileSync(
      fileURLToPath(
        new URL(
          "../fixtures/registry/disperse/calldata-Disperse.json",
          import.meta.url
        )
      ),
      join(clone, "registry", "disperse", "calldata-Disperse.json")
    )
    const trackerDir = join(dir, "tracker")
    mkdirSync(join(trackerDir, "contracts"), { recursive: true })
    const paths = dataPaths(join(trackerDir, "data"))
    writeJson(paths.abi(1, EXECUTOR), {
      source: "sourcify",
      address: EXECUTOR,
      name: "Executor",
      abi: [execute],
    })
    writeJson(paths.samples(1, EXECUTOR), {
      chainId: 1,
      address: EXECUTOR,
      txs: [sample],
    })
    writeJson(paths.onchain(1, EXECUTOR), {})
    writeJson(paths.tokens(1), {
      [USDC.toLowerCase()]: { name: "USD Coin", symbol: "USDC", decimals: 6 },
    })
    const chainsFile = join(dir, "chains_mini.json")
    writeFileSync(
      chainsFile,
      JSON.stringify([
        {
          chainId: 1,
          name: "Ethereum Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ])
    )

    const outcome = await draftContract({
      trackerDir,
      chainId: 1,
      address: EXECUTOR,
      protocol: "example",
      owner: "Example",
      selectors: [toFunctionSelector(execute)],
      chainsFile,
      registry: draftRegistry(clone),
    })
    const tests = JSON.parse(
      readFileSync(outcome.testsPath, "utf8")
    ) as DraftTests
    const action = tests.tests[0]?.expected.fields.find(
      (f) => f.label === "Action"
    )
    expect(action?.value).toEqual({
      intent: "Send tokens to many",
      interpolatedIntent: "Send USDC to many",
      owner: "Disperse",
      fields: [
        { label: "Token", value: "USDC" },
        { label: "To", value: "0x00000000000000000000000000000000000000B1" },
        { label: "Amount", value: "1.5 USDC" },
      ],
    })
    expect(readFileSync(outcome.reviewPath, "utf8")).not.toContain(
      "index this draft alone"
    )
  })
})
