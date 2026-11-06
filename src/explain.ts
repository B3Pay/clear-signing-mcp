import {
  eip712,
  format,
  resolveCalldataDescriptor,
  resolveTypedDataDescriptor,
  formatTypedData,
  type DisplayModel,
  type TypedData,
  type TypeMember,
} from "@ethereum-sourcify/clear-signing"
import {
  formatUnits,
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem"
import { checkAttestations, type AttestationReport } from "./attestation.js"
import { revocationClient, type ToolContext } from "./context.js"
import { plainDecode, type PlainDecode } from "./decode.js"
import { caip10 } from "./registry.js"
import { cleanDeep, MAX_TEXT_LENGTH } from "./text.js"

/**
 * Explains calls and signature requests the way an ERC-7730 wallet would show
 * them: the intent, the sentence with values filled in, and each labeled
 * value. A call no descriptor covers is decoded with its verified ABI where
 * possible and marked as not clear-signed.
 */

export interface CallInput {
  readonly to: string
  /** Calldata; empty or `0x` for a plain native-currency transfer. */
  readonly data?: string
  /** Value in wei. */
  readonly value?: bigint
}

export interface DescriptorRef {
  readonly path: string
  readonly url: string
  readonly source: string
}

export interface Warning {
  readonly code: string
  readonly message: string
}

export type CallStatus =
  /** A registry descriptor formatted the call. */
  | "clear_signed"
  /** No descriptor matched; the verified ABI decoded it. */
  | "decoded"
  /** No descriptor matched and no ABI decoded it: only the selector and raw words are known. */
  | "raw"
  /** No calldata: a plain transfer of the chain's native currency. */
  | "native_transfer"

export interface ExplainedCall {
  readonly index: number
  readonly to: Address
  readonly status: CallStatus
  readonly value?: { readonly wei: string; readonly formatted: string }
  readonly descriptor?: DescriptorRef
  readonly attestation?: AttestationReport
  readonly intent?: string | Record<string, string>
  readonly interpolatedIntent?: string
  readonly fields?: DisplayModel["fields"]
  readonly metadata?: DisplayModel["metadata"]
  readonly decoded?: PlainDecode
  readonly raw?: { readonly selector: string; readonly args: readonly string[] }
  readonly warnings: readonly Warning[]
}

export interface ExplainResult {
  readonly chainId: number
  readonly chain?: string
  readonly from?: Address
  readonly registry: string
  readonly calls: readonly ExplainedCall[]
  /**
   * Every call is clear-signed, or is a plain native-currency transfer, which
   * has no calldata for a descriptor to explain.
   */
  readonly clearSigned: boolean
  /** The calls' sentences joined with " and ", as ERC-7730 does for a batch, when every call has one. */
  readonly batchIntent?: string
  /** Strings from outside sources that had characters spelled out or were cut. */
  readonly textChanged: boolean
}

export async function explainCalls(
  context: ToolContext,
  input: { chainId: number; from?: string; calls: readonly CallInput[] }
): Promise<ExplainResult> {
  const from = input.from ? getAddress(input.from) : undefined
  const index = await context.registry.index()
  const resolver = context.registry.resolverFor(index)
  const externalDataProvider = context.chains.externalDataProvider()

  let textChanged = false
  const onChange = () => {
    textChanged = true
  }

  const calls = await Promise.all(
    input.calls.map(async (call, i): Promise<ExplainedCall> => {
      const to = getAddress(call.to)
      const data = normalizeData(call.data)
      const value =
        call.value !== undefined && call.value > 0n
          ? {
              wei: call.value.toString(),
              formatted: `${formatUnits(call.value, context.chains.nativeDecimals(input.chainId))} ${context.chains.nativeSymbol(input.chainId)}`,
            }
          : undefined

      if (data === "0x") {
        return {
          index: i,
          to,
          status: "native_transfer",
          ...(value ? { value } : {}),
          warnings: [],
        }
      }

      const display = await format(
        {
          chainId: input.chainId,
          to,
          data,
          ...(call.value !== undefined ? { value: call.value } : {}),
          ...(from ? { from } : {}),
        },
        {
          descriptorResolverOptions: { type: "custom", resolver },
          externalDataProvider,
        }
      )
      const warnings = cleanDeep(display.warnings ?? [], onChange)
      const descriptorPath = index.calldataIndex[caip10(input.chainId, to)]
      const clearSigned =
        Boolean(descriptorPath) &&
        !display.rawCalldataFallback &&
        display.intent !== undefined

      if (clearSigned && descriptorPath) {
        const attestation = await attestationFor(
          context,
          input.chainId,
          to,
          descriptorPath
        )
        const shown = cleanDeep(
          {
            intent: display.intent,
            interpolatedIntent: display.interpolatedIntent,
            fields: display.fields,
            metadata: display.metadata,
          },
          onChange
        )
        return {
          index: i,
          to,
          status: "clear_signed",
          ...(value ? { value } : {}),
          descriptor: {
            path: descriptorPath,
            url: context.registry.webUrl(descriptorPath),
            source: context.registry.label,
          },
          ...(attestation ? { attestation } : {}),
          ...definedOnly(shown),
          warnings,
        }
      }

      const decoded = cleanDeep(
        await plainDecode(context.sourcify, input.chainId, to, data),
        onChange
      )
      const raw = display.rawCalldataFallback
      return {
        index: i,
        to,
        status: decoded.status === "decoded" ? "decoded" : "raw",
        ...(value ? { value } : {}),
        ...(descriptorPath
          ? {
              descriptor: {
                path: descriptorPath,
                url: context.registry.webUrl(descriptorPath),
                source: context.registry.label,
              },
            }
          : {}),
        decoded,
        ...(raw
          ? { raw: { selector: raw.selector, args: raw.args.slice(0, 64) } }
          : {}),
        warnings,
      }
    })
  )

  const sentences = calls.map((call) => call.interpolatedIntent)
  const batchIntent =
    calls.length > 1 &&
    sentences.every((s): s is string => typeof s === "string")
      ? sentences.join(" and ")
      : undefined
  const chain = context.chains.describe(input.chainId).chain
  return {
    chainId: input.chainId,
    ...(chain ? { chain } : {}),
    ...(from ? { from } : {}),
    registry: context.registry.label,
    calls,
    clearSigned: calls.every(
      (call) =>
        call.status === "clear_signed" || call.status === "native_transfer"
    ),
    ...(batchIntent ? { batchIntent } : {}),
    textChanged,
  }
}

export interface TypedDataInput {
  readonly account: string
  readonly domain: Record<string, unknown>
  readonly types: Record<
    string,
    readonly { readonly name: string; readonly type: string }[]
  >
  readonly primaryType: string
  readonly message: Record<string, unknown>
}

export interface ExplainSignatureResult {
  readonly status: "clear_signed" | "not_clear_signed"
  readonly chainId?: number
  readonly verifyingContract?: Address
  readonly primaryType: string
  readonly registry: string
  readonly descriptor?: DescriptorRef
  readonly attestation?: AttestationReport
  readonly intent?: string | Record<string, string>
  readonly interpolatedIntent?: string
  readonly fields?: DisplayModel["fields"]
  readonly metadata?: DisplayModel["metadata"]
  /** For a message no descriptor covers: its domain and fields as sent, for a person to read. */
  readonly message?: {
    readonly domain: Record<string, unknown>
    readonly message: Record<string, unknown>
  }
  readonly warnings: readonly Warning[]
  readonly textChanged: boolean
}

export async function explainTypedData(
  context: ToolContext,
  input: TypedDataInput
): Promise<ExplainSignatureResult> {
  const typedData: TypedData = {
    account: getAddress(input.account),
    domain: input.domain,
    types: input.types as Record<string, TypeMember[]>,
    primaryType: input.primaryType,
    message: input.message,
  }
  const index = await context.registry.index()
  const resolver = context.registry.resolverFor(index)

  let textChanged = false
  const onChange = () => {
    textChanged = true
  }

  const display = await formatTypedData(typedData, {
    descriptorResolverOptions: { type: "custom", resolver },
    externalDataProvider: context.chains.externalDataProvider(),
  })
  const warnings = cleanDeep(display.warnings ?? [], onChange)

  const chainId = parseChainId(input.domain.chainId)
  const verifyingContract =
    typeof input.domain.verifyingContract === "string" &&
    /^0x[0-9a-fA-F]{40}$/.test(input.domain.verifyingContract)
      ? getAddress(input.domain.verifyingContract)
      : undefined
  const descriptorPath =
    chainId !== undefined && verifyingContract
      ? typedDataPath(
          index.typedDataIndex,
          chainId,
          verifyingContract,
          typedData
        )
      : undefined

  const base = {
    primaryType: cleanDeep(input.primaryType, onChange),
    registry: context.registry.label,
    ...(chainId !== undefined ? { chainId } : {}),
    ...(verifyingContract ? { verifyingContract } : {}),
  }

  if (
    descriptorPath &&
    display.intent !== undefined &&
    chainId !== undefined &&
    verifyingContract
  ) {
    let attestation: AttestationReport | undefined
    const resolved = await resolveTypedDataDescriptor(typedData, {
      type: "custom",
      resolver,
    })
    if ("descriptor" in resolved) {
      attestation = await checkAttestations({
        registry: context.registry,
        descriptorPath,
        descriptor: resolved.descriptor,
        attesters: context.attesters,
        chainClient: revocationClient(context),
        chainId,
        address: verifyingContract,
      })
    }
    const shown = cleanDeep(
      {
        intent: display.intent,
        interpolatedIntent: display.interpolatedIntent,
        fields: display.fields,
        metadata: display.metadata,
      },
      onChange
    )
    return {
      status: "clear_signed",
      ...base,
      descriptor: {
        path: descriptorPath,
        url: context.registry.webUrl(descriptorPath),
        source: context.registry.label,
      },
      ...(attestation ? { attestation } : {}),
      ...definedOnly(shown),
      warnings,
      textChanged,
    }
  }

  const message = cleanDeep(
    { domain: jsonSafe(input.domain), message: jsonSafe(input.message) },
    onChange,
    MAX_TEXT_LENGTH
  )
  return { status: "not_clear_signed", ...base, message, warnings, textChanged }
}

async function attestationFor(
  context: ToolContext,
  chainId: number,
  to: Address,
  descriptorPath: string
): Promise<AttestationReport | undefined> {
  const index = await context.registry.index()
  const resolved = await resolveCalldataDescriptor(chainId, to, {
    type: "custom",
    resolver: context.registry.resolverFor(index),
  })
  if (!("descriptor" in resolved)) return undefined
  return checkAttestations({
    registry: context.registry,
    descriptorPath,
    descriptor: resolved.descriptor,
    attesters: context.attesters,
    chainClient: revocationClient(context),
    chainId,
    address: to,
  })
}

/** The descriptor path the library would pick for this message, found the same way it does. */
function typedDataPath(
  typedDataIndex: Awaited<
    ReturnType<ToolContext["registry"]["index"]>
  >["typedDataIndex"],
  chainId: number,
  verifyingContract: Address,
  typedData: TypedData
): string | undefined {
  const entries =
    typedDataIndex[caip10(chainId, verifyingContract)]?.[typedData.primaryType]
  if (!entries?.length) return undefined
  const encodeType = eip712.computeEncodeType(
    typedData.primaryType,
    typedData.types
  )
  if (!encodeType) return undefined
  const hash = keccak256(stringToHex(encodeType))
  return entries.find((entry) => entry.encodeTypeHashes.includes(hash))?.path
}

function normalizeData(data: string | undefined): Hex {
  if (data === undefined || data === "" || data === "0x") return "0x"
  return data.toLowerCase() as Hex
}

function parseChainId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return value
  if (
    typeof value === "bigint" &&
    value > 0n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  )
    return Number(value)
  if (typeof value === "string") {
    const n = value.startsWith("0x")
      ? Number.parseInt(value, 16)
      : Number(value)
    if (Number.isSafeInteger(n) && n > 0) return n
  }
  return undefined
}

function jsonSafe(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify(value, (_key, inner: unknown) =>
      typeof inner === "bigint" ? inner.toString() : inner
    )
  ) as Record<string, unknown>
}

function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined)
  ) as Partial<T>
}
