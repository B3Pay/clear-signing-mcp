import {
  decodeFunctionData,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
  type Hex,
} from "viem"
import { formatAbiItem } from "viem/utils"
import type { SourcifyClient, SourcifyReport } from "./sourcify.js"

/**
 * The plain decode for a call no descriptor covers: the function and its
 * arguments, read with the contract's verified ABI from Sourcify. It says
 * what the calldata contains, not what it means, so it is never presented as
 * clear-signed.
 */

export interface DecodedArgument {
  readonly name: string
  readonly type: string
  /** The value as text: integers in decimal, addresses checksummed, bytes in hex. */
  readonly value: string
}

export type PlainDecode =
  | {
      readonly status: "decoded"
      readonly source: "sourcify"
      readonly signature: string
      readonly selector: Hex
      readonly args: readonly DecodedArgument[]
      /** The implementation whose ABI decoded the call, when the contract is a proxy. */
      readonly implementation?: Address
    }
  | {
      readonly status: "not_decoded"
      readonly reason: string
      readonly sourcify?: SourcifyReport
    }

const MAX_VALUE_LENGTH = 2_000

export async function plainDecode(
  sourcify: SourcifyClient,
  chainId: number,
  to: Address,
  data: Hex
): Promise<PlainDecode> {
  const contract = await sourcify.contract(chainId, to)
  if (contract.report.status !== "verified") {
    return {
      status: "not_decoded",
      reason:
        contract.report.status === "not_verified"
          ? "The contract is not verified on Sourcify, so there is no ABI to decode the call with."
          : `Sourcify could not be reached: ${contract.report.reason}`,
      sourcify: contract.report,
    }
  }

  if (contract.abi) {
    const decoded = decodeWith(contract.abi, data)
    if (decoded) return decoded
  }

  // A proxy's own ABI rarely has the function; its implementation's does.
  const implementation = contract.report.proxy?.implementations[0]?.address
  if (implementation) {
    const impl = await sourcify.contract(chainId, implementation)
    if (impl.abi) {
      const decoded = decodeWith(impl.abi, data)
      if (decoded) return { ...decoded, implementation }
    }
  }

  return {
    status: "not_decoded",
    reason: "No function in the verified ABI matches the call's selector.",
    sourcify: contract.report,
  }
}

function decodeWith(
  abi: Abi,
  data: Hex
): Extract<PlainDecode, { status: "decoded" }> | undefined {
  let result: { functionName: string; args?: readonly unknown[] | undefined }
  try {
    result = decodeFunctionData({ abi, data })
  } catch {
    return undefined
  }
  const selector = data.slice(0, 10).toLowerCase() as Hex
  const item = abi.find(
    (entry): entry is AbiFunction =>
      entry.type === "function" &&
      entry.name === result.functionName &&
      toFunctionSelector(entry) === selector
  )
  if (!item) return undefined
  const values = result.args ?? []
  return {
    status: "decoded",
    source: "sourcify",
    signature: formatAbiItem(item, { includeName: true }),
    selector,
    args: item.inputs.map((input: AbiParameter, i: number) => ({
      name: input.name || `arg${i}`,
      type: input.type,
      value: truncate(stringify(values[i])),
    })),
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  if (
    typeof value === "bigint" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value)
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "bigint" ? inner.toString() : inner
  )
}

function truncate(text: string): string {
  return text.length > MAX_VALUE_LENGTH
    ? `${text.slice(0, MAX_VALUE_LENGTH)}…`
    : text
}
