import {
  BaseError,
  ContractFunctionRevertedError,
  decodeEventLog,
  formatUnits,
  getAddress,
  maxUint160,
  maxUint256,
  parseAbi,
  type Address,
  type Hex,
  type Log,
} from "viem"
import { simulateBlocks } from "viem/actions"
import type { RpcDescription } from "./chains.js"
import type { ToolContext } from "./context.js"
import { cleanText } from "./text.js"

/**
 * Runs calls against current chain state with `eth_simulateV1`, through
 * viem's `simulateBlocks`. Nothing is signed or sent: a simulation is a read,
 * and its account needs no key.
 *
 * Balance changes are the net of the transfer events the simulation emits.
 * `traceTransfers` makes the node report each movement of the native
 * currency as a transfer event too, so one request covers both, on any node
 * that implements `eth_simulateV1`, anvil included. Gas fees are not part of
 * a simulation's state changes and are left out.
 */

export interface SimulationCallInput {
  readonly to: string
  readonly data?: string
  readonly value?: bigint
}

export type SimulatedEvent =
  | {
      readonly kind: "native_transfer"
      readonly from: Address
      readonly to: Address
      readonly amount: string
    }
  | {
      readonly kind: "erc20_transfer"
      readonly token: Address
      readonly from: Address
      readonly to: Address
      readonly amount: string
    }
  | {
      readonly kind: "erc20_approval"
      readonly token: Address
      readonly owner: Address
      readonly spender: Address
      readonly amount: string
      /** The allowance is the largest value the type holds: no limit. */
      readonly unlimited: boolean
    }
  | {
      readonly kind: "nft_transfer"
      readonly collection: Address
      readonly from: Address
      readonly to: Address
      readonly tokenId: string
    }
  | {
      readonly kind: "nft_approval"
      readonly collection: Address
      readonly owner: Address
      readonly approved: Address
      readonly tokenId: string
    }
  | {
      readonly kind: "approval_for_all"
      readonly collection: Address
      readonly owner: Address
      readonly operator: Address
      readonly approved: boolean
    }
  | {
      readonly kind: "permit2_approval"
      readonly permit2: Address
      readonly owner: Address
      readonly token: Address
      readonly spender: Address
      readonly amount: string
      readonly expiration: string
      readonly unlimited: boolean
    }
  | { readonly kind: "other"; readonly address: Address; readonly topic0?: Hex }

export interface SimulatedCall {
  readonly index: number
  readonly status: "success" | "failure"
  readonly gasUsed: string
  readonly error?: string
  readonly returnData?: Hex
  readonly events: readonly SimulatedEvent[]
  /** Events left out after the first 50. */
  readonly moreEvents?: number
}

export interface AssetChange {
  readonly token: Address | "native"
  readonly symbol?: string
  readonly decimals?: number
  /** Signed change in the account's balance, in the token's smallest unit. */
  readonly diff: string
  /** The change with decimals applied and the symbol appended, when both are known. */
  readonly formatted?: string
}

export interface NftChange {
  readonly collection: Address
  readonly tokenId: string
  /** `in`: the account receives the item; `out`: it gives the item away. */
  readonly direction: "in" | "out"
}

export interface SimulationResult {
  readonly chainId: number
  readonly from: Address
  readonly rpc: RpcDescription
  readonly blockNumber?: string
  /** Every call succeeded. */
  readonly success: boolean
  readonly calls: readonly SimulatedCall[]
  /** The account's net balance changes, from the transfer events. Gas fees are not included. */
  readonly assetChanges: readonly AssetChange[]
  /** NFTs the account receives or gives away. */
  readonly nftChanges: readonly NftChange[]
  /** Approvals any call granted, so they are not lost among other events. */
  readonly approvals: readonly SimulatedEvent[]
}

export class SimulationUnavailableError extends Error {
  override name = "SimulationUnavailableError"
}

const EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
  "event ApprovalForAll(address indexed owner, address indexed operator, bool approved)",
])
const NFT_EVENTS = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  "event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)",
])
const PERMIT2_EVENTS = parseAbi([
  "event Approval(address indexed owner, address indexed token, address indexed spender, uint160 amount, uint48 expiration)",
])
/** Where `traceTransfers` reports movements of the native currency from. */
const NATIVE_TRANSFER_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
const MAX_EVENTS_PER_CALL = 50
const APPROVAL_KINDS: readonly SimulatedEvent["kind"][] = [
  "erc20_approval",
  "nft_approval",
  "approval_for_all",
  "permit2_approval",
]

export async function simulate(
  context: ToolContext,
  input: {
    chainId: number
    from: string
    calls: readonly SimulationCallInput[]
    blockNumber?: bigint
  }
): Promise<SimulationResult> {
  const from = getAddress(input.from)
  const rpc = context.chains.describe(input.chainId)
  const client = context.chains.client(input.chainId)
  if (!client) {
    throw new SimulationUnavailableError(
      `No RPC is configured for chain ${input.chainId}. Set RPC_URL_${input.chainId} to an RPC that supports eth_simulateV1.`
    )
  }

  let blocks: Awaited<ReturnType<typeof simulateBlocks>>
  try {
    blocks = await simulateBlocks(client, {
      blocks: [
        {
          calls: input.calls.map((call) => ({
            account: from,
            to: getAddress(call.to),
            ...(call.data && call.data !== "0x"
              ? { data: call.data as Hex }
              : {}),
            ...(call.value !== undefined ? { value: call.value } : {}),
          })),
        },
      ],
      traceTransfers: true,
      ...(input.blockNumber !== undefined
        ? { blockNumber: input.blockNumber }
        : {}),
    })
  } catch (error) {
    throw new SimulationUnavailableError(
      context.chains.redact(describeRpcError(error, input.chainId, rpc))
    )
  }
  const block = blocks[0]
  if (!block || block.calls.length !== input.calls.length) {
    throw new SimulationUnavailableError(
      `Simulation failed on ${where(rpc, input.chainId)}: the RPC answered with ${block?.calls.length ?? 0} results for ${input.calls.length} calls.`
    )
  }

  // A failed call's events never happen, so none is reported or counted.
  const decodedPerCall = block.calls.map((call) =>
    call.status === "success" ? (call.logs ?? []).map(decodeEvent) : []
  )
  const calls: SimulatedCall[] = block.calls.map((call, index) => {
    const decoded = decodedPerCall[index] ?? []
    const events = decoded.slice(0, MAX_EVENTS_PER_CALL)
    const moreEvents = decoded.length - events.length
    const data = call.data as Hex | undefined
    const returnData =
      call.status === "success" && data && data !== "0x"
        ? (data.slice(0, 2 + 2 * 1024) as Hex)
        : undefined
    return {
      index,
      status: call.status === "success" ? "success" : "failure",
      gasUsed: call.gasUsed.toString(),
      ...(call.status === "failure"
        ? {
            error: context.chains.redact(
              cleanText(failureText(call.error, data), 300).text
            ),
          }
        : {}),
      ...(returnData ? { returnData } : {}),
      events,
      ...(moreEvents > 0 ? { moreEvents } : {}),
    }
  })

  const counted = decodedPerCall.flat()
  const assetChanges = await netChanges(context, input.chainId, from, counted)
  const nftChanges = counted.flatMap((event): NftChange[] => {
    if (event.kind !== "nft_transfer" || event.from === event.to) return []
    if (event.from === from)
      return [
        {
          collection: event.collection,
          tokenId: event.tokenId,
          direction: "out",
        },
      ]
    if (event.to === from)
      return [
        {
          collection: event.collection,
          tokenId: event.tokenId,
          direction: "in",
        },
      ]
    return []
  })

  const blockNumber = block.number
  return {
    chainId: input.chainId,
    from,
    rpc,
    ...(typeof blockNumber === "bigint"
      ? { blockNumber: blockNumber.toString() }
      : {}),
    success: calls.every((call) => call.status === "success"),
    calls,
    assetChanges,
    nftChanges,
    approvals: counted.filter((event) => APPROVAL_KINDS.includes(event.kind)),
  }
}

/** The account's net change per currency and token, in the order each first moved. */
async function netChanges(
  context: ToolContext,
  chainId: number,
  account: Address,
  events: readonly SimulatedEvent[]
): Promise<AssetChange[]> {
  const totals = new Map<Address | "native", bigint>()
  const add = (token: Address | "native", amount: bigint) =>
    totals.set(token, (totals.get(token) ?? 0n) + amount)
  for (const event of events) {
    if (event.kind !== "erc20_transfer" && event.kind !== "native_transfer")
      continue
    const token = event.kind === "native_transfer" ? "native" : event.token
    const amount = BigInt(event.amount)
    if (event.from === account) add(token, -amount)
    if (event.to === account) add(token, amount)
  }

  const changes: AssetChange[] = []
  for (const [token, diff] of totals) {
    if (diff === 0n) continue
    let symbol: string | undefined
    let decimals: number | undefined
    if (token === "native") {
      symbol = context.chains.nativeSymbol(chainId)
      decimals = context.chains.nativeDecimals(chainId)
    } else {
      const details = await context.chains.token(chainId, token)
      symbol = details?.symbol || undefined
      decimals = details?.decimals
    }
    changes.push({
      token,
      ...(symbol ? { symbol } : {}),
      ...(decimals !== undefined ? { decimals } : {}),
      diff: diff.toString(),
      ...(decimals !== undefined && symbol
        ? {
            formatted: `${diff > 0n ? "+" : ""}${formatUnits(diff, decimals)} ${symbol}`,
          }
        : {}),
    })
  }
  return changes
}

/** Reads the token events that matter to a person: transfers and approvals. */
export function decodeEvent(log: Log): SimulatedEvent {
  const address = getAddress(log.address)
  const topics = log.topics
  const topic0 = topics[0]
  if (!topic0) return { kind: "other", address }
  try {
    if (topics.length === 4) {
      const permit2 = tryDecode(PERMIT2_EVENTS, log)
      if (permit2 && permit2.eventName === "Approval") {
        const args = permit2.args as {
          owner: Address
          token: Address
          spender: Address
          amount: bigint
          expiration: number
        }
        return {
          kind: "permit2_approval",
          permit2: address,
          owner: getAddress(args.owner),
          token: getAddress(args.token),
          spender: getAddress(args.spender),
          amount: args.amount.toString(),
          expiration: String(args.expiration),
          unlimited: args.amount === maxUint160,
        }
      }
      const nft = tryDecode(NFT_EVENTS, log)
      if (nft?.eventName === "Transfer") {
        const args = nft.args as { from: Address; to: Address; tokenId: bigint }
        return {
          kind: "nft_transfer",
          collection: address,
          from: getAddress(args.from),
          to: getAddress(args.to),
          tokenId: args.tokenId.toString(),
        }
      }
      if (nft?.eventName === "Approval") {
        const args = nft.args as {
          owner: Address
          approved: Address
          tokenId: bigint
        }
        return {
          kind: "nft_approval",
          collection: address,
          owner: getAddress(args.owner),
          approved: getAddress(args.approved),
          tokenId: args.tokenId.toString(),
        }
      }
    }
    const decoded = tryDecode(EVENTS, log)
    if (decoded?.eventName === "Transfer" && topics.length === 3) {
      const args = decoded.args as { from: Address; to: Address; value: bigint }
      if (address.toLowerCase() === NATIVE_TRANSFER_ADDRESS) {
        return {
          kind: "native_transfer",
          from: getAddress(args.from),
          to: getAddress(args.to),
          amount: args.value.toString(),
        }
      }
      return {
        kind: "erc20_transfer",
        token: address,
        from: getAddress(args.from),
        to: getAddress(args.to),
        amount: args.value.toString(),
      }
    }
    if (decoded?.eventName === "Approval" && topics.length === 3) {
      const args = decoded.args as {
        owner: Address
        spender: Address
        value: bigint
      }
      return {
        kind: "erc20_approval",
        token: address,
        owner: getAddress(args.owner),
        spender: getAddress(args.spender),
        amount: args.value.toString(),
        unlimited: args.value === maxUint256,
      }
    }
    if (decoded?.eventName === "ApprovalForAll") {
      const args = decoded.args as {
        owner: Address
        operator: Address
        approved: boolean
      }
      return {
        kind: "approval_for_all",
        collection: address,
        owner: getAddress(args.owner),
        operator: getAddress(args.operator),
        approved: args.approved,
      }
    }
  } catch {
    // Fall through: an event that does not decode is reported as "other".
  }
  return { kind: "other", address, topic0 }
}

function tryDecode<const abi extends readonly unknown[]>(abi: abi, log: Log) {
  try {
    return decodeEventLog({
      abi: abi as never,
      data: log.data,
      topics: log.topics,
      strict: true,
    }) as {
      eventName: string
      args: unknown
    }
  } catch {
    return undefined
  }
}

/** Why a call failed: its revert reason when there is one, never a guess. */
function failureText(error: Error | undefined, data: Hex | undefined): string {
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (inner) => inner instanceof ContractFunctionRevertedError
    )
    if (reverted instanceof ContractFunctionRevertedError) {
      if (reverted.reason) return `reverted: ${reverted.reason}`
      if (reverted.signature)
        return `reverted with custom error ${reverted.signature}`
    }
  }
  if (!data || data === "0x") return "reverted without a reason"
  const shown = data.slice(0, 2 + 2 * 68)
  return `reverted with error data ${shown}${shown.length < data.length ? "…" : ""}`
}

function where(rpc: RpcDescription, chainId: number): string {
  return rpc.rpc === "configured"
    ? `the configured RPC for chain ${chainId}`
    : `the public RPC ${rpc.host ?? ""} for chain ${chainId}`
}

function describeRpcError(
  error: unknown,
  chainId: number,
  rpc: RpcDescription
): string {
  const text =
    error instanceof BaseError
      ? `${error.name}: ${error.shortMessage}`
      : error instanceof Error
        ? error.message
        : String(error)
  const unsupported =
    /eth_simulateV1|method not found|does not exist|not supported|not available/i.test(
      error instanceof BaseError
        ? `${error.shortMessage} ${error.details}`
        : text
    )
  const hint = unsupported
    ? ` It may not support eth_simulateV1; set RPC_URL_${chainId} to one that does.`
    : ""
  return `Simulation failed on ${where(rpc, chainId)}: ${cleanText(text, 300).text}.${hint}`
}
