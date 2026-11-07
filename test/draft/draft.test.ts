import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  encodeFunctionData,
  parseAbiItem,
  parseTransaction,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
} from "viem"
import {
  format,
  type DisplayModel,
  type ExternalDataProvider,
} from "@ethereum-sourcify/clear-signing"
import { createFilesystemResolver } from "@ethereum-sourcify/clear-signing/filesystem"
import {
  draftDescriptor,
  type DraftChain,
  type DraftDescriptor,
  type DraftInput,
  type DraftRegistry,
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

const BASE: Record<string, DraftChain> = {
  "8453": {
    name: "Base",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
}

/** A sample transaction to `to` on `chainId` with `input`, rebuildable unsigned. */
function sampleOf(chainId: number, to: string, input: `0x${string}`) {
  return {
    hash: `0x${"ab".repeat(32)}`,
    chainId,
    to: to as `0x${string}`,
    value: "0",
    input,
    nonce: 7,
    gas: "500000",
    type: "eip1559",
    maxFeePerGas: "2000000000",
    maxPriorityFeePerGas: "1000000",
    status: "success",
  } satisfies DraftSample
}

/**
 * Each test of a draft's tests file, rendered as the registry's test runner
 * renders it: the draft in a registry checkout with `registry` (descriptors
 * by path), every deployment indexed, tokens from the tests file alone.
 */
async function asRunner(
  result: DraftResult,
  chains: Readonly<Record<string, DraftChain>>,
  registry: Readonly<Record<string, DraftDescriptor>> = {}
): Promise<DisplayModel[]> {
  const root = mkdtempSync(join(tmpdir(), "draft-runner-"))
  try {
    const calldataIndex: Record<string, string> = {}
    for (const [path, descriptor] of Object.entries({
      [`registry/draft/${result.fileName}`]: result.descriptor,
      ...registry,
    })) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), JSON.stringify(descriptor))
      for (const d of descriptor.context.contract.deployments)
        calldataIndex[`eip155:${d.chainId}:${d.address.toLowerCase()}`] ??= path
    }
    const resolver = createFilesystemResolver({
      index: { calldataIndex, typedDataIndex: {} },
      descriptorDirectory: root,
    })
    const tokens = result.tests.dataProvider?.tokens ?? {}
    const provider: ExternalDataProvider = {
      resolveToken: (_chainId, address) =>
        Promise.resolve(tokens[address.toLowerCase()] ?? null),
      resolveChainInfo: (chainId) =>
        Promise.resolve(chains[String(chainId)] ?? null),
    }
    const models: DisplayModel[] = []
    for (const test of result.tests.tests) {
      const tx = parseTransaction(test.rawTx)
      models.push(
        await format(
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
      )
    }
    return models
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("draftDescriptor: an array inside an array of structs", () => {
  // OKX DexRouter's dagSwapTo on Base, as the trial run drafted it.
  const OKX = "0x67d03631FE51B741C0C00c4E16eb662AC84381df"
  const WETH = "0x4200000000000000000000000000000000000006"
  const USDC = "0x833589fCD6eDb6E08f4C7C32D4f71b54bdA02913"
  const dagSwapTo = parseAbiItem(
    "function dagSwapTo(uint256 orderId, address receiver, (uint256 fromToken, address toToken, uint256 fromTokenAmount, uint256 minReturnAmount, uint256 deadLine) baseRequest, (address[] mixAdapters, address[] assetTo, uint256[] rawData, bytes[] extraData, uint256 fromToken)[] paths) payable returns (uint256 returnAmount)"
  ) as AbiFunction
  const input = encodeFunctionData({
    abi: [dagSwapTo],
    functionName: "dagSwapTo",
    args: [
      1n,
      "0x00000000000000000000000000000000000000a1",
      {
        fromToken: BigInt(USDC),
        toToken: WETH,
        fromTokenAmount: 1_000_000n,
        minReturnAmount: 300_000_000_000_000n,
        deadLine: 1_800_000_000n,
      },
      [
        {
          mixAdapters: ["0x00000000000000000000000000000000000000a2"],
          assetTo: ["0x00000000000000000000000000000000000000a3"],
          rawData: [123n],
          extraData: ["0x1234"],
          fromToken: BigInt(USDC),
        },
      ],
    ],
  })

  it("renders every test case as the runner does, with no warning", async () => {
    const result = await draftDescriptor({
      chainId: 8453,
      address: OKX,
      abi: [dagSwapTo],
      contractName: "DexRouter",
      owner: "OKX",
      selectors: [toFunctionSelector(dagSwapTo)],
      samples: [sampleOf(8453, OKX, input)],
      tokens: {
        [WETH.toLowerCase()]: {
          name: "Wrapped Ether",
          symbol: "WETH",
          decimals: 18,
        },
      },
      chains: BASE,
    })
    expect(result.tests.tests).toHaveLength(1)
    expect(result.review.join("\n")).not.toContain("test runner fails")
    const [model] = await asRunner(result, BASE)
    expect(model?.warnings ?? []).toEqual([])
    expect(model && toRendered(model)).toEqual(result.tests.tests[0]?.expected)
    // The token sold is a uint256, so the value sent (0 ETH) is not its amount.
    expect(result.tests.tests[0]?.expected.interpolatedIntent).toBe(
      "Swap for at least 0.0003 WETH"
    )
  })
})

describe("draftDescriptor: a token that stands for the native currency", () => {
  // MetaMask Swaps' MetaSwap: tokenFrom is the zero address for ETH.
  const META = "0x881D40237659C251811CEC9c364ef91dC08D300C"
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  const swap = parseAbiItem(
    "function swap(string aggregatorId, address tokenFrom, uint256 amount, bytes data) payable"
  ) as AbiFunction
  const ETHEREUM: Record<string, DraftChain> = {
    "1": {
      name: "Ethereum",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
  }
  const callWith = (tokenFrom: string, amount: bigint) =>
    encodeFunctionData({
      abi: [swap],
      functionName: "swap",
      args: ["uniswapV3", tokenFrom as `0x${string}`, amount, "0x"],
    })
  const draftWith = (tokenFrom: string, value: string) =>
    draftDescriptor({
      chainId: 1,
      address: META,
      abi: [swap],
      contractName: "MetaSwap",
      owner: "MetaMask",
      samples: [
        {
          ...sampleOf(1, META, callWith(tokenFrom, 500_000_000_000_000_000n)),
          value,
        },
      ],
      tokens: { [USDC.toLowerCase()]: { symbol: "USDC", decimals: 6 } },
      chains: ETHEREUM,
    })

  it("shows the amount in ETH when the sample passes the zero address as its token", async () => {
    const result = await draftWith(
      "0x0000000000000000000000000000000000000000",
      "500000000000000000"
    )
    const fields = Object.values(result.descriptor.display.formats)[0]?.fields
    expect(fields?.find((f) => f.path === "amount")?.params).toEqual({
      tokenPath: "tokenFrom",
      nativeCurrencyAddress: "0x0000000000000000000000000000000000000000",
    })
    expect(result.review.join("\n")).toContain(
      "amount is counted in the native currency when tokenFrom is 0x0000000000000000000000000000000000000000"
    )
    expect(result.tests.tests[0]?.expected.interpolatedIntent).toBe(
      "Swap 0.5 ETH"
    )
    const [model] = await asRunner(result, ETHEREUM)
    expect(model?.warnings ?? []).toEqual([])
    expect(model && toRendered(model)).toEqual(result.tests.tests[0]?.expected)
  })

  it("names no native currency when the samples send a token", async () => {
    const result = await draftWith(USDC, "0")
    const fields = Object.values(result.descriptor.display.formats)[0]?.fields
    expect(fields?.find((f) => f.path === "amount")?.params).toEqual({
      tokenPath: "tokenFrom",
    })
    expect(result.review.join("\n")).not.toContain("native currency when")
  })
})

describe("draftDescriptor: a call that a calldata field carries", () => {
  // A contract that makes the calls it is given, here one to Disperse on
  // Ethereum, which the registry describes (test/fixtures/registry).
  const EXECUTOR = "0x000000000000000000000000000000000000e7ec"
  const DISPERSE = "0xD152f549545093347A162Dce210e7293f1452150"
  const DISPERSE_PATH = "registry/disperse/calldata-Disperse.json"
  const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  const MAINNET: Record<string, DraftChain> = {
    "1": {
      name: "Ethereum Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    },
  }
  const disperse = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/registry/disperse/calldata-Disperse.json",
        import.meta.url
      ),
      "utf8"
    )
  ) as DraftDescriptor
  const execute = parseAbiItem(
    "function execute((address target, uint256 value, bytes callData)[] calls) payable"
  ) as AbiFunction
  const callData = encodeFunctionData({
    abi: [
      parseAbiItem(
        "function disperseToken(address token, address[] recipients, uint256[] values)"
      ),
    ],
    functionName: "disperseToken",
    args: [
      USDC,
      [
        "0x00000000000000000000000000000000000000b1",
        "0x00000000000000000000000000000000000000b2",
      ],
      [1_500_000n, 2_000_000n],
    ],
  })
  const input = encodeFunctionData({
    abi: [execute],
    functionName: "execute",
    args: [[{ target: DISPERSE, value: 0n, callData }]],
  })

  let root: string
  let registry: DraftRegistry
  beforeAll(() => {
    // A registry clone of one descriptor; the draft engine only reads it.
    root = mkdtempSync(join(tmpdir(), "draft-registry-"))
    mkdirSync(join(root, "registry", "disperse"), { recursive: true })
    writeFileSync(join(root, DISPERSE_PATH), JSON.stringify(disperse))
    registry = {
      index: {
        calldataIndex: {
          [`eip155:1:${DISPERSE.toLowerCase()}`]: DISPERSE_PATH,
        },
        typedDataIndex: {},
      },
      descriptorDirectory: root,
    }
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const draft = (more: Partial<DraftInput> = {}) =>
    draftDescriptor({
      chainId: 1,
      address: EXECUTOR,
      abi: [execute],
      contractName: "Executor",
      owner: "Example",
      selectors: [toFunctionSelector(execute)],
      samples: [sampleOf(1, EXECUTOR, input)],
      tokens: {
        [USDC.toLowerCase()]: { name: "USD Coin", symbol: "USDC", decimals: 6 },
      },
      chains: MAINNET,
      ...more,
    })
  const action = (result: DraftResult) =>
    result.tests.tests[0]?.expected.fields.find((f) => f.label === "Action")
      ?.value

  it("expects the call as the registry's descriptor for it renders it, as the runner does", async () => {
    const result = await draft({ registry })
    expect(action(result)).toEqual({
      intent: "Send tokens to many",
      interpolatedIntent: "Send USDC to many",
      owner: "Disperse",
      fields: [
        { label: "Token", value: "USDC" },
        { label: "To", value: "0x00000000000000000000000000000000000000B1" },
        { label: "Amount", value: "1.5 USDC" },
        { label: "To", value: "0x00000000000000000000000000000000000000b2" },
        { label: "Amount", value: "2 USDC" },
      ],
    })
    expect(Object.keys(result.tests.dataProvider?.tokens ?? {})).toEqual([
      USDC.toLowerCase(),
    ])
    expect(result.review.join("\n")).not.toContain("index this draft alone")
    const [model] = await asRunner(result, MAINNET, {
      [DISPERSE_PATH]: disperse,
    })
    expect(model?.warnings ?? []).toEqual([])
    expect(model && toRendered(model)).toEqual(result.tests.tests[0]?.expected)
  })

  it("expects raw bytes without a registry, and says so", async () => {
    const result = await draft()
    expect(action(result)).toBe(callData)
    expect(result.review.join("\n")).toContain(
      "The tests index this draft alone, since no registry was given"
    )
  })
})
