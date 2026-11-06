import {
  createPublicClient,
  createTestClient,
  custom,
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  maxUint160,
  maxUint256,
  parseAbi,
  parseEther,
  parseUnits,
  type Address,
  type Log,
  type PublicClient,
} from "viem"
import { mainnet } from "viem/chains"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { ChainAccess } from "../src/chains.js"
import { explainCalls } from "../src/explain.js"
import { renderExplain, renderSimulation } from "../src/render.js"
import {
  decodeEvent,
  simulate,
  SimulationUnavailableError,
} from "../src/simulate.js"
import { DEPLOYER, startAnvil, type Anvil } from "./anvil.js"
import { ANVIL_TOKEN, PERSON, SPENDER, testContext } from "./helpers.js"

const NFT_TRANSFER = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
])
const approveMax = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [SPENDER, maxUint256],
})
const approveSome = encodeFunctionData({
  abi: erc20Abi,
  functionName: "approve",
  args: [SPENDER, 5n],
})
const transfer = encodeFunctionData({
  abi: erc20Abi,
  functionName: "transfer",
  args: [PERSON, parseUnits("12.5", 18)],
})

describe("simulate on a local anvil chain", () => {
  let anvil: Anvil

  beforeAll(async () => {
    anvil = await startAnvil()
  })

  afterAll(async () => {
    await anvil?.stop()
  })

  const context = () => testContext({ rpcUrls: { 31337: `${anvil.url}/` } })

  it("deployed the token where the fixtures expect it", () => {
    expect(anvil.token).toBe(ANVIL_TOKEN)
  })

  it("flags an unlimited approval and moves no balance", async () => {
    const result = await simulate(context(), {
      chainId: 31337,
      from: DEPLOYER,
      calls: [{ to: ANVIL_TOKEN, data: approveMax }],
    })

    expect(result.success).toBe(true)
    expect(result.rpc).toMatchObject({
      rpc: "configured",
      host: new URL(anvil.url).host,
    })
    expect(result.assetChanges).toEqual([])
    expect(result.approvals).toEqual([
      {
        kind: "erc20_approval",
        token: ANVIL_TOKEN,
        owner: DEPLOYER,
        spender: SPENDER,
        amount: maxUint256.toString(),
        unlimited: true,
      },
    ])
    const text = renderSimulation(result)
    expect(text).toContain("Nothing was signed or sent.")
    expect(text).toContain("Result: the call succeeds against current state.")
    expect(text).toContain(`lets ${SPENDER} spend an UNLIMITED amount`)
    expect(text).toContain(
      `Balance changes for ${DEPLOYER}: none in the transfer events (gas fees not included).`
    )
  })

  it("does not call a limited approval unlimited", async () => {
    const result = await simulate(context(), {
      chainId: 31337,
      from: DEPLOYER,
      calls: [{ to: ANVIL_TOKEN, data: approveSome }],
    })
    expect(result.approvals).toMatchObject([
      { kind: "erc20_approval", amount: "5", unlimited: false },
    ])
    expect(renderSimulation(result)).toContain(
      `lets ${SPENDER} spend 5 (smallest unit)`
    )
  })

  it("reports the token leaving the account", async () => {
    const result = await simulate(context(), {
      chainId: 31337,
      from: DEPLOYER,
      calls: [{ to: ANVIL_TOKEN, data: transfer }],
    })

    expect(result.success).toBe(true)
    expect(result.assetChanges).toEqual([
      {
        token: ANVIL_TOKEN,
        symbol: "TST",
        decimals: 18,
        diff: (-parseUnits("12.5", 18)).toString(),
        formatted: "-12.5 TST",
      },
    ])
    expect(result.calls[0]?.events).toEqual([
      {
        kind: "erc20_transfer",
        token: ANVIL_TOKEN,
        from: DEPLOYER,
        to: PERSON,
        amount: parseUnits("12.5", 18).toString(),
      },
    ])
    expect(renderSimulation(result)).toContain(
      `- "-12.5 TST" of token ${ANVIL_TOKEN}`
    )
  })

  it("reports a call that would revert, with its reason", async () => {
    const result = await simulate(context(), {
      chainId: 31337,
      from: PERSON,
      calls: [{ to: ANVIL_TOKEN, data: transfer }],
    })

    expect(result.success).toBe(false)
    expect(result.calls[0]?.status).toBe("failure")
    expect(result.calls[0]?.error).toContain("TestToken: balance too low")
    expect(renderSimulation(result)).toMatch(
      /Result: call 1 FAILS: ".*TestToken: balance too low.*"/
    )
  })

  it("runs a batch in order", async () => {
    const result = await simulate(context(), {
      chainId: 31337,
      from: DEPLOYER,
      calls: [
        { to: ANVIL_TOKEN, data: approveMax },
        { to: ANVIL_TOKEN, data: transfer },
      ],
    })
    expect(result.success).toBe(true)
    expect(result.calls.map((call) => call.status)).toEqual([
      "success",
      "success",
    ])
    expect(result.approvals).toHaveLength(1)
    expect(renderSimulation(result)).toContain("Simulated 2 calls in order")
  })

  it("reports a plain transfer of the native currency", async () => {
    const result = await simulate(context(), {
      chainId: 31337,
      from: DEPLOYER,
      calls: [{ to: PERSON, value: parseEther("1") }],
    })
    expect(result.success).toBe(true)
    expect(result.calls[0]?.events).toEqual([
      {
        kind: "native_transfer",
        from: DEPLOYER,
        to: PERSON,
        amount: parseEther("1").toString(),
      },
    ])
    expect(result.assetChanges).toEqual([
      {
        token: "native",
        symbol: "native token",
        decimals: 18,
        diff: (-parseEther("1")).toString(),
        formatted: "-1 native token",
      },
    ])
    expect(renderSimulation(result)).toContain('- "-1 native token"')
  })

  it("counts nothing from a call that fails", async () => {
    const result = await simulate(context(), {
      chainId: 31337,
      from: DEPLOYER,
      calls: [
        { to: ANVIL_TOKEN, data: approveMax },
        {
          to: ANVIL_TOKEN,
          data: encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [PERSON, maxUint256],
          }),
        },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.calls.map((call) => call.status)).toEqual([
      "success",
      "failure",
    ])
    expect(result.calls[1]?.error).toBe("reverted: TestToken: balance too low")
    expect(result.assetChanges).toEqual([])
    expect(result.approvals).toHaveLength(1)
  })

  it("reports an NFT leaving the account", async () => {
    // A stand-in collection whose every call emits Transfer(caller, PERSON, 42).
    const collection = getAddress("0x00000000000000000000000000000000000c0113")
    const transferTopic = encodeEventTopics({
      abi: NFT_TRANSFER,
      eventName: "Transfer",
    })[0]
    const code =
      `0x602a73${PERSON.slice(2)}337f${transferTopic.slice(2)}60006000a400` as const
    await createTestClient({
      mode: "anvil",
      transport: http(anvil.url),
    }).setCode({ address: collection, bytecode: code })

    const result = await simulate(context(), {
      chainId: 31337,
      from: DEPLOYER,
      calls: [{ to: collection, data: "0x" }],
    })

    expect(result.calls[0]?.events).toEqual([
      {
        kind: "nft_transfer",
        collection,
        from: DEPLOYER,
        to: PERSON,
        tokenId: "42",
      },
    ])
    expect(result.nftChanges).toEqual([
      { collection, tokenId: "42", direction: "out" },
    ])
    expect(renderSimulation(result)).toContain(
      `- gives away item 42 of collection ${collection}`
    )
  })

  it("explains a clear-signed call with the token's own details from the chain", async () => {
    const result = await explainCalls(context(), {
      chainId: 31337,
      calls: [{ to: ANVIL_TOKEN, data: approveMax }],
    })
    expect(result.calls[0]?.status).toBe("clear_signed")
    expect(result.calls[0]?.fields?.[1]).toMatchObject({
      label: "Amount",
      value: "Unlimited TST",
    })
    expect(renderExplain(result)).toContain('- "Amount": "Unlimited TST"')
  })
})

describe("simulate without a usable RPC", () => {
  it("says which RPC to configure when there is none", async () => {
    const error = await simulate(testContext(), {
      chainId: 1,
      from: PERSON,
      calls: [{ to: ANVIL_TOKEN }],
    }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(SimulationUnavailableError)
    expect((error as Error).message).toBe(
      "No RPC is configured for chain 1. Set RPC_URL_1 to an RPC that supports eth_simulateV1."
    )
  })

  it("reports an RPC that cannot be reached without its URL", async () => {
    const secret = "http://127.0.0.1:9/v2/SECRET_API_KEY/"
    const error = await simulate(testContext({ rpcUrls: { 31337: secret } }), {
      chainId: 31337,
      from: PERSON,
      calls: [{ to: ANVIL_TOKEN, data: transfer }],
    }).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(SimulationUnavailableError)
    expect((error as Error).message).toMatch(
      /^Simulation failed on the configured RPC for chain 31337:/
    )
    expect((error as Error).message).not.toContain("SECRET_API_KEY")
  })
})

/** Chain access whose RPC for Ethereum answers from `answer`, to test replies anvil never gives. */
class FakeRpcChains extends ChainAccess {
  constructor(
    private readonly answer: (method: string, params: unknown) => unknown
  ) {
    super({
      urls: { 1: "https://rpc.example.test/v2/SECRET_API_KEY" },
      publicFallback: false,
      timeoutMs: 1_000,
    })
  }

  override client(chainId: number): PublicClient | undefined {
    if (chainId !== 1) return undefined
    return createPublicClient({
      chain: mainnet,
      transport: custom({
        request: ({ method, params }: { method: string; params: unknown }) =>
          Promise.resolve(this.answer(method, params)),
      }),
    })
  }
}

function fakeRpcContext(answer: (method: string, params: unknown) => unknown) {
  return { ...testContext(), chains: new FakeRpcChains(answer) }
}

const ZERO32 = `0x${"00".repeat(32)}` as const

function simulatedBlock(calls: unknown[]) {
  return [
    {
      number: "0x2",
      hash: ZERO32,
      parentHash: ZERO32,
      timestamp: "0x1",
      transactions: [],
      calls,
    },
  ]
}

function transferLog(from: Address, to: Address, amount: bigint) {
  const [topic0, topic1, topic2] = encodeEventTopics({
    abi: erc20Abi,
    eventName: "Transfer",
    args: { from, to },
  })
  return {
    address: ANVIL_TOKEN.toLowerCase(),
    topics: [topic0, topic1, topic2],
    data: encodeAbiParameters([{ type: "uint256" }], [amount]),
    blockNumber: "0x2",
    blockHash: ZERO32,
    transactionHash: ZERO32,
    transactionIndex: "0x0",
    logIndex: "0x0",
    removed: false,
  }
}

describe("simulate with replies a node could give", () => {
  const input = {
    chainId: 1,
    from: PERSON,
    calls: [{ to: ANVIL_TOKEN, data: transfer }],
  }

  it("neither reports nor counts the events of a failed call", async () => {
    const reverted = encodeErrorResult({
      abi: parseAbi(["error Error(string)"]),
      errorName: "Error",
      args: ["nope"],
    })
    const context = fakeRpcContext(() =>
      simulatedBlock([
        {
          status: "0x0",
          returnData: "0x",
          gasUsed: "0x5208",
          logs: [transferLog(PERSON, SPENDER, 5n)],
          error: { code: 3, message: "execution reverted", data: reverted },
        },
      ])
    )
    const result = await simulate(context, input)
    expect(result.success).toBe(false)
    expect(result.calls[0]).toMatchObject({
      status: "failure",
      error: "reverted: nope",
      events: [],
    })
    expect(result.assetChanges).toEqual([])
  })

  it("names a custom error by its selector and an empty revert as having no reason", async () => {
    const context = fakeRpcContext(() =>
      simulatedBlock([
        {
          status: "0x0",
          returnData: "0x",
          gasUsed: "0x1",
          logs: [],
          error: { code: 3, message: "reverted", data: "0x12345678" },
        },
        {
          status: "0x0",
          returnData: "0x",
          gasUsed: "0x1",
          logs: [],
          error: { code: 3, message: "reverted", data: "0x" },
        },
      ])
    )
    const result = await simulate(context, {
      ...input,
      calls: [input.calls[0]!, input.calls[0]!],
    })
    expect(result.calls.map((call) => call.error)).toEqual([
      "reverted with custom error 0x12345678",
      "reverted without a reason",
    ])
  })

  it("counts a successful call's transfers, reading the token's details from the chain", async () => {
    const context = fakeRpcContext((method) => {
      if (method === "eth_simulateV1") {
        return simulatedBlock([
          {
            status: "0x1",
            returnData: "0x",
            gasUsed: "0x5208",
            logs: [
              transferLog(PERSON, SPENDER, 5n),
              transferLog(SPENDER, PERSON, 2n),
            ],
          },
        ])
      }
      // The token reads (decimals, symbol, name) fail: the change is still reported, without a symbol.
      throw new Error("no such method")
    })
    const result = await simulate(context, input)
    expect(result.assetChanges).toEqual([{ token: ANVIL_TOKEN, diff: "-3" }])
    expect(renderSimulation(result)).toContain(
      `- -3 (smallest unit) of token ${ANVIL_TOKEN}`
    )
  })

  it("refuses a reply with fewer results than calls", async () => {
    const context = fakeRpcContext(() => simulatedBlock([]))
    await expect(simulate(context, input)).rejects.toThrow(
      "the RPC answered with 0 results for 1 calls"
    )
  })

  it("says when the RPC does not offer eth_simulateV1, without its URL", async () => {
    const context = fakeRpcContext(() => {
      throw Object.assign(
        new Error("the method eth_simulateV1 does not exist/is not available"),
        { code: -32601 }
      )
    })
    const error = await simulate(context, input).catch(
      (reason: unknown) => reason
    )
    expect(error).toBeInstanceOf(SimulationUnavailableError)
    expect((error as Error).message).toContain(
      "It may not support eth_simulateV1; set RPC_URL_1 to one that does."
    )
    expect((error as Error).message).not.toContain("SECRET_API_KEY")
  })
})

describe("decodeEvent", () => {
  const token: Address = getAddress(
    "0x00000000000000000000000000000000000a11ce"
  )
  const owner: Address = getAddress(
    "0x00000000000000000000000000000000000b0b00"
  )
  const other: Address = getAddress(
    "0x000000000022d473030f116ddee9f6b43ac78ba3"
  )

  function log(
    abi: readonly unknown[],
    eventName: string,
    args: Record<string, unknown>,
    data: `0x${string}` = "0x"
  ): Log {
    const topics = encodeEventTopics({ abi, eventName, args })
    return { address: token, topics: topics as Log["topics"], data } as Log
  }

  it("reads an ERC-20 transfer and approval", () => {
    const abi = parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 value)",
      "event Approval(address indexed owner, address indexed spender, uint256 value)",
    ])
    expect(
      decodeEvent(
        log(
          abi,
          "Transfer",
          { from: owner, to: other },
          encodeAbiParameters([{ type: "uint256" }], [7n])
        )
      )
    ).toEqual({
      kind: "erc20_transfer",
      token,
      from: owner,
      to: other,
      amount: "7",
    })
    expect(
      decodeEvent(
        log(
          abi,
          "Approval",
          { owner, spender: other },
          encodeAbiParameters([{ type: "uint256" }], [maxUint256])
        )
      )
    ).toMatchObject({ kind: "erc20_approval", unlimited: true })
  })

  it("reads an NFT transfer, approval and approval for all", () => {
    const abi = parseAbi([
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
      "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
      "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
    ])
    expect(
      decodeEvent(
        log(abi, "Transfer", { from: owner, to: other, tokenId: 42n })
      )
    ).toEqual({
      kind: "nft_transfer",
      collection: token,
      from: owner,
      to: other,
      tokenId: "42",
    })
    expect(
      decodeEvent(
        log(abi, "Approval", { owner, approved: other, tokenId: 42n })
      )
    ).toMatchObject({
      kind: "nft_approval",
      approved: other,
      tokenId: "42",
    })
    expect(
      decodeEvent(
        log(
          abi,
          "ApprovalForAll",
          { owner, operator: other },
          encodeAbiParameters([{ type: "bool" }], [true])
        )
      )
    ).toEqual({
      kind: "approval_for_all",
      collection: token,
      owner,
      operator: other,
      approved: true,
    })
  })

  it("reads a Permit2 approval and flags an unlimited one", () => {
    const abi = parseAbi([
      "event Approval(address indexed owner, address indexed token, address indexed spender, uint160 amount, uint48 expiration)",
    ])
    const data = encodeAbiParameters(
      [{ type: "uint160" }, { type: "uint48" }],
      [maxUint160, 1_900_000_000]
    )
    expect(
      decodeEvent(log(abi, "Approval", { owner, token, spender: other }, data))
    ).toEqual({
      kind: "permit2_approval",
      permit2: token,
      owner,
      token,
      spender: other,
      amount: maxUint160.toString(),
      expiration: "1900000000",
      unlimited: true,
    })
  })

  it("reports any other event by its address and topic", () => {
    const abi = parseAbi([
      "event Swap(address indexed sender, uint256 amountIn)",
    ])
    const event = log(
      abi,
      "Swap",
      { sender: owner },
      encodeAbiParameters([{ type: "uint256" }], [1n])
    )
    expect(decodeEvent(event)).toEqual({
      kind: "other",
      address: token,
      topic0: event.topics[0],
    })
    expect(
      decodeEvent({ address: token, topics: [], data: "0x" } as unknown as Log)
    ).toEqual({ kind: "other", address: token })
  })
})
