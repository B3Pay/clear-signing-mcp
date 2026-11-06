import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { encodeFunctionData, erc20Abi, maxUint256 } from "viem"
import { afterEach, describe, expect, it } from "vitest"
import type { ToolContext } from "../src/context.js"
import {
  createClearSigningServer,
  INSTRUCTIONS,
  SERVER_NAME,
} from "../src/server.js"
import { VERSION } from "../src/version.js"
import {
  FakeWeb,
  PERMIT_TYPES,
  PERSON,
  ROUTER,
  sourcifyWeb,
  SPENDER,
  testContext,
  TOKEN,
} from "./helpers.js"

const TOOLS = [
  "clear_signing_status",
  "explain_transaction",
  "explain_signature",
  "simulate_transaction",
]

let open: Client[] = []

async function connect(context: ToolContext = testContext()): Promise<Client> {
  const server = createClearSigningServer(context)
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "test", version: "0.0.0" })
  await client.connect(clientTransport)
  open.push(client)
  return client
}

afterEach(async () => {
  await Promise.all(open.map((client) => client.close()))
  open = []
})

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [first] = result.content as { type: string; text?: string }[]
  expect(first?.type).toBe("text")
  return first?.text ?? ""
}

describe("the MCP server", () => {
  it("names itself and tells the agent how to use it", async () => {
    const client = await connect()
    expect(client.getServerVersion()).toMatchObject({
      name: SERVER_NAME,
      version: VERSION,
    })
    expect(client.getInstructions()).toBe(INSTRUCTIONS)
    expect(INSTRUCTIONS).toContain(
      "It holds no keys and cannot sign or send anything."
    )
  })

  it("offers four read-only tools", async () => {
    const client = await connect()
    const { tools } = await client.listTools()
    expect(tools.map((tool) => tool.name).sort()).toEqual([...TOOLS].sort())
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      })
      expect(tool.description?.length).toBeGreaterThan(50)
      expect(tool.inputSchema.type).toBe("object")
    }
    const simulateTool = tools.find(
      (tool) => tool.name === "simulate_transaction"
    )
    expect(simulateTool?.inputSchema.required).toEqual(
      expect.arrayContaining(["chainId", "from", "calls"])
    )
  })

  it("answers clear_signing_status with text and structured content", async () => {
    const client = await connect()
    const result = await client.callTool({
      name: "clear_signing_status",
      arguments: { chainId: 1, address: TOKEN },
    })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain("Clear-signed: yes")
    expect(result.structuredContent).toMatchObject({
      chainId: 1,
      address: TOKEN,
      clearSigned: true,
    })
  })

  it("answers explain_transaction, with wei given as a decimal or hex string", async () => {
    const client = await connect()
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [SPENDER, maxUint256],
    })
    const result = await client.callTool({
      name: "explain_transaction",
      arguments: {
        chainId: 1,
        from: PERSON,
        calls: [
          { to: TOKEN, data },
          { to: PERSON, value: "0xde0b6b3a7640000" },
          { to: PERSON, value: "1000000000000000000" },
        ],
      },
    })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain("CLEAR-SIGNED")
    expect(result.structuredContent).toMatchObject({
      clearSigned: true,
      calls: [
        { status: "clear_signed", intent: "Approve" },
        {
          status: "native_transfer",
          value: { wei: "1000000000000000000", formatted: "1 ETH" },
        },
        { status: "native_transfer", value: { wei: "1000000000000000000" } },
      ],
    })
  })

  it("answers explain_signature", async () => {
    const client = await connect()
    const result = await client.callTool({
      name: "explain_signature",
      arguments: {
        account: PERSON,
        typedData: {
          domain: {
            name: "Test Token",
            version: "1",
            chainId: 1,
            verifyingContract: TOKEN,
          },
          types: PERMIT_TYPES,
          primaryType: "Permit",
          message: {
            owner: PERSON,
            spender: SPENDER,
            value: "1000",
            nonce: "0",
            deadline: "1800000000",
          },
        },
      },
    })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toContain("CLEAR-SIGNED")
    expect(result.structuredContent).toMatchObject({
      status: "clear_signed",
      intent: "Authorize spending of tokens",
    })
  })

  it("says which RPC simulate_transaction needs when none is configured", async () => {
    const client = await connect()
    const result = await client.callTool({
      name: "simulate_transaction",
      arguments: {
        chainId: 1,
        from: PERSON,
        calls: [{ to: ROUTER, data: "0x" }],
      },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toBe(
      "No RPC is configured for chain 1. Set RPC_URL_1 to an RPC that supports eth_simulateV1."
    )
  })

  it("refuses a value that does not fit in 256 bits", async () => {
    const client = await connect()
    const result = await client.callTool({
      name: "explain_transaction",
      arguments: { chainId: 1, calls: [{ to: PERSON, value: "9".repeat(78) }] },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain("does not fit in 256 bits")
  })

  it.each([
    ["an address that is too short", { chainId: 1, address: "0x1234" }],
    ["a chain ID of zero", { chainId: 0, address: TOKEN }],
    ["a missing address", { chainId: 1 }],
  ])("refuses %s before doing any work", async (_name, args) => {
    const web = sourcifyWeb(new FakeWeb())
    const client = await connect(testContext({ web }))
    const outcome = await client
      .callTool({ name: "clear_signing_status", arguments: args })
      .then(
        (result) => ({ result, error: undefined }),
        (error: unknown) => ({ result: undefined, error })
      )
    // The SDK may answer bad arguments with a protocol error or a tool error; either way nothing ran.
    expect(
      outcome.error !== undefined || outcome.result?.isError === true
    ).toBe(true)
    expect(web.requests).toEqual([])
  })

  it("refuses calldata that is not whole bytes of hex", async () => {
    const client = await connect()
    const outcome = await client
      .callTool({
        name: "explain_transaction",
        arguments: { chainId: 1, calls: [{ to: TOKEN, data: "0xabc" }] },
      })
      .then(
        (result) => result.isError === true,
        () => true
      )
    expect(outcome).toBe(true)
  })

  it("reports a registry it cannot read as a tool error", async () => {
    const client = await connect(
      testContext({ web: sourcifyWeb(new FakeWeb()) })
    )
    const result = await client.callTool({
      name: "clear_signing_status",
      arguments: { chainId: 1, address: TOKEN },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(
      /^The tool failed: HTTP 404 from https:\/\/raw\.githubusercontent\.com\//
    )
  })

  it("keeps a configured RPC URL out of its errors", async () => {
    const secret = "https://rpc.example.test/v2/SECRET_API_KEY"
    const context = testContext({ rpcUrls: { 1: secret } })
    const failing: ToolContext = {
      ...context,
      registry: {
        ...context.registry,
        label: context.registry.label,
        index: () => Promise.reject(new Error(`upstream ${secret} refused`)),
      } as unknown as ToolContext["registry"],
    }
    const client = await connect(failing)
    const result = await client.callTool({
      name: "clear_signing_status",
      arguments: { chainId: 1, address: TOKEN },
    })
    expect(result.isError).toBe(true)
    expect(text(result)).toBe("The tool failed: upstream <RPC_URL_1> refused")
  })
})
