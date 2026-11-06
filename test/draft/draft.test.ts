import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { parseTransaction, type Abi } from "viem"
import {
  format,
  type ExternalDataProvider,
} from "@ethereum-sourcify/clear-signing"
import { createFilesystemResolver } from "@ethereum-sourcify/clear-signing/filesystem"
import {
  draftDescriptor,
  type DraftChain,
  type DraftInput,
  type DraftResult,
  type DraftSample,
  type DraftToken,
} from "../../src/index.js"
import { toRendered } from "../../src/draft/render.js"

/**
 * End to end, from the fixture alone: Uniswap V2 Router02 on Ethereum, its
 * Sourcify ABI, two real transactions and the tokens they name, as the
 * tracker's fetch step wrote them.
 */
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/draft/uniswap-v2-router02.json", import.meta.url),
    "utf8"
  )
) as {
  chainId: number
  address: string
  abi: Abi
  samples: DraftSample[]
  tokens: Record<string, DraftToken>
  chains: Record<string, DraftChain>
}

const SWAP_ETH =
  "swapExactETHForTokens(uint256 amountOutMin,address[] path,address to,uint256 deadline)"
const SWAP_TOKENS =
  "swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,address[] path,address to,uint256 deadline)"

const input: DraftInput = {
  chainId: fixture.chainId,
  address: fixture.address,
  abi: fixture.abi,
  contractName: "UniswapV2Router02",
  owner: "Uniswap Labs",
  url: "https://uniswap.org",
  selectors: fixture.samples.map((s) => s.input.slice(0, 10)),
  samples: fixture.samples,
  tokens: fixture.tokens,
  chains: fixture.chains,
}

let result: DraftResult
beforeAll(async () => {
  result = await draftDescriptor(input)
})

describe("draftDescriptor: Uniswap V2 Router02", () => {
  it("describes the functions the samples call, keyed as the registry keys them", () => {
    expect(result.fileName).toBe("calldata-UniswapV2Router02.json")
    expect(result.descriptor.$schema).toBe("../../specs/erc7730-v2.schema.json")
    expect(result.descriptor.context.contract.deployments).toEqual([
      { chainId: 1, address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D" },
    ])
    expect(result.descriptor.metadata).toEqual({
      owner: "Uniswap Labs",
      contractName: "UniswapV2Router02",
      info: { url: "https://uniswap.org" },
    })
    expect(Object.keys(result.descriptor.display.formats)).toEqual([
      SWAP_ETH,
      SWAP_TOKENS,
    ])
  })

  it("draws the fields the registry's descriptor has", () => {
    const formats = result.descriptor.display.formats
    expect(formats[SWAP_ETH]).toEqual({
      intent: "Swap",
      fields: [
        { path: "@.value", label: "Amount to send", format: "amount" },
        {
          path: "amountOutMin",
          label: "Minimum to receive",
          format: "tokenAmount",
          params: { tokenPath: "path.[-1]" },
        },
        {
          path: "to",
          label: "Recipient",
          format: "addressName",
          params: { types: ["eoa", "contract"], sources: ["local", "ens"] },
        },
        {
          path: "deadline",
          label: "Deadline",
          format: "date",
          params: { encoding: "timestamp" },
        },
        { path: "path.[]", label: "Path", visible: "never" },
      ],
      interpolatedIntent: "Swap {@.value} for at least {amountOutMin}",
    })
    expect(formats[SWAP_TOKENS]?.interpolatedIntent).toBe(
      "Swap {amountIn} for at least {amountOutMin}"
    )
    expect(formats[SWAP_TOKENS]?.fields[0]).toEqual({
      path: "amountIn",
      label: "Amount to send",
      format: "tokenAmount",
      params: { tokenPath: "path.[0]" },
    })
  })

  it("tests each function with a real transaction, rebuilt unsigned", () => {
    const { tests } = result.tests
    expect(tests).toHaveLength(2)
    expect(new Set(tests.map((t) => t.description)).size).toBe(2)
    for (const [index, test] of tests.entries()) {
      const sample = fixture.samples[index]
      if (!sample) throw new Error("no sample")
      expect(test.txHash).toBe(sample.hash)
      const tx = parseTransaction(test.rawTx)
      expect(tx.to).toBe(sample.to.toLowerCase())
      expect(tx.data).toBe(sample.input)
      expect(tx.value ?? 0n).toBe(BigInt(sample.value))
      expect(tx.chainId).toBe(1)
    }
    expect(result.tests.descriptor).toBe("../calldata-UniswapV2Router02.json")
  })

  it("expects the render a wallet shows, with the tokens it names", () => {
    const [first] = result.tests.tests
    expect(first?.expected).toEqual({
      intent: "Swap",
      interpolatedIntent:
        "Swap 0.04405 ETH for at least 107922194.878527802904997815 BELL58",
      owner: "Uniswap Labs",
      fields: [
        { label: "Amount to send", value: "0.04405 ETH" },
        {
          label: "Minimum to receive",
          value: "107922194.878527802904997815 BELL58",
        },
        {
          label: "Recipient",
          value: "0x7CD62CE1a6bE5Ff61F0a95018F227C8bbDB91f6e",
        },
        { label: "Deadline", value: "2026-11-06 19:36:44Z" },
      ],
    })
    // Only the tokens a test renders, looked up on the contract's chain.
    const tokens = result.tests.dataProvider?.tokens ?? {}
    expect(Object.keys(tokens).sort()).toEqual(
      Object.keys(fixture.tokens)
        .filter((address) =>
          result.tests.tests.some((t) =>
            JSON.stringify(t.expected).includes(
              ` ${fixture.tokens[address]?.symbol}`
            )
          )
        )
        .sort()
    )
    expect(Object.keys(tokens).length).toBeGreaterThan(0)
  })

  it("is deterministic", async () => {
    expect(await draftDescriptor(input)).toEqual(result)
  })

  it("describes every function that changes state when no selector is given", async () => {
    const { selectors: _selectors, ...rest } = input
    const all = await draftDescriptor(rest)
    const writable = fixture.abi.filter(
      (item) =>
        item.type === "function" &&
        item.stateMutability !== "view" &&
        item.stateMutability !== "pure"
    )
    expect(Object.keys(all.descriptor.display.formats)).toHaveLength(
      writable.length
    )
    expect(all.tests.tests).toHaveLength(2)
    expect(all.review.join("\n")).toContain(
      "no sample transaction calls it, so it has no test"
    )
  })
})

describe("the draft under @ethereum-sourcify/clear-signing", () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "draft-test-"))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it("renders every test case as its tests file expects, with no warning", async () => {
    // A registry checkout of one descriptor, as the test runner indexes it.
    const relative = `registry/uniswap/${result.fileName}`
    mkdirSync(join(root, "registry", "uniswap"), { recursive: true })
    writeFileSync(join(root, relative), JSON.stringify(result.descriptor))
    const resolver = createFilesystemResolver({
      index: {
        calldataIndex: {
          [`eip155:1:${fixture.address.toLowerCase()}`]: relative,
        },
        typedDataIndex: {},
      },
      descriptorDirectory: root,
    })
    // The runner's data provider: the tests file's tokens by address.
    const tokens = result.tests.dataProvider?.tokens ?? {}
    const provider: ExternalDataProvider = {
      resolveToken: (_chainId, address) =>
        Promise.resolve(tokens[address.toLowerCase()] ?? null),
      resolveChainInfo: (chainId) =>
        Promise.resolve(fixture.chains[String(chainId)] ?? null),
    }
    for (const test of result.tests.tests) {
      const tx = parseTransaction(test.rawTx)
      const model = await format(
        {
          chainId: Number(tx.chainId),
          to: tx.to ?? "0x",
          data: tx.data ?? "0x",
          value: tx.value ?? 0n,
        },
        {
          descriptorResolverOptions: { type: "custom", resolver },
          externalDataProvider: provider,
        }
      )
      expect(model.warnings ?? []).toEqual([])
      expect(toRendered(model)).toEqual(test.expected)
    }
  })
})
