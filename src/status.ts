import {
  resolveCalldataDescriptor,
  type Descriptor,
} from "@ethereum-sourcify/clear-signing"
import { getAddress, toFunctionSelector, type Address, type Hex } from "viem"
import { checkAttestations, type AttestationReport } from "./attestation.js"
import { revocationClient, type ToolContext } from "./context.js"
import { caip10 } from "./registry.js"
import type { SourcifyReport } from "./sourcify.js"
import { cleanDeep } from "./text.js"

/**
 * Whether one contract is clear-signed: its descriptor in the registry, the
 * functions that descriptor covers, its attestation status, its EIP-712
 * descriptors, and whether its source is verified on Sourcify.
 */

export interface DescribedFunction {
  /** The `display.formats` key: a function signature with parameter names, or a selector. */
  readonly format: string
  readonly selector?: Hex
  readonly intent?: string | Record<string, string>
}

export interface CalldataStatus {
  readonly described: boolean
  readonly descriptorPath?: string
  readonly url?: string
  readonly owner?: string
  readonly contractName?: string
  readonly functions?: readonly DescribedFunction[]
  readonly attestation?: AttestationReport
  /** Set when the descriptor could not be read or resolved. */
  readonly error?: string
}

export interface TypedDataStatus {
  readonly described: boolean
  readonly messages?: readonly {
    readonly primaryType: string
    readonly descriptorPath: string
    readonly url: string
  }[]
}

export interface StatusResult {
  readonly chainId: number
  readonly address: Address
  readonly registry: {
    readonly source: string
    readonly indexFetchedAt: string
  }
  readonly calldata: CalldataStatus
  readonly eip712: TypedDataStatus
  readonly sourcify: SourcifyReport
  /** True when the registry has a calldata or an EIP-712 descriptor for the contract. */
  readonly clearSigned: boolean
  /** Where a protocol can get a descriptor written, when it has none. */
  readonly getDescribed?: string
  /** Strings from the descriptor that had characters spelled out or were cut. */
  readonly textChanged: boolean
}

export async function clearSigningStatus(
  context: ToolContext,
  input: { chainId: number; address: string }
): Promise<StatusResult> {
  const address = getAddress(input.address)
  const index = await context.registry.index()
  const key = caip10(input.chainId, address)

  const sourcifyPromise = context.sourcify
    .contract(input.chainId, address)
    .then((c) => c.report)

  let textChanged = false
  const onChange = () => {
    textChanged = true
  }

  let calldata: CalldataStatus = { described: false }
  const descriptorPath = index.calldataIndex[key]
  if (descriptorPath) {
    try {
      const resolver = context.registry.resolverFor(index)
      const resolved = await resolveCalldataDescriptor(input.chainId, address, {
        type: "custom",
        resolver,
      })
      if ("warning" in resolved) {
        calldata = {
          described: true,
          descriptorPath,
          url: context.registry.webUrl(descriptorPath),
          error: cleanDeep(resolved.warning.message, onChange),
        }
      } else {
        const attestation = await checkAttestations({
          registry: context.registry,
          descriptorPath,
          descriptor: resolved.descriptor,
          attesters: context.attesters,
          chainClient: revocationClient(context),
          chainId: input.chainId,
          address,
        })
        calldata = cleanDeep(
          {
            described: true,
            descriptorPath,
            url: context.registry.webUrl(descriptorPath),
            ...metadataOf(resolved.descriptor),
            functions: functionsOf(resolved.descriptor),
            attestation,
          },
          onChange
        )
      }
    } catch (error) {
      calldata = {
        described: true,
        descriptorPath,
        url: context.registry.webUrl(descriptorPath),
        error: `The descriptor could not be read: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const byType = index.typedDataIndex[key]
  const messages = byType
    ? Object.entries(byType).flatMap(([primaryType, entries]) =>
        entries.map((entry) => ({
          primaryType,
          descriptorPath: entry.path,
          url: context.registry.webUrl(entry.path),
        }))
      )
    : []
  const eip712: TypedDataStatus =
    messages.length > 0
      ? { described: true, messages: cleanDeep(messages, onChange) }
      : { described: false }

  const sourcify = await sourcifyPromise
  const clearSigned = calldata.described || eip712.described
  return {
    chainId: input.chainId,
    address,
    registry: {
      source: context.registry.label,
      indexFetchedAt: new Date(index.fetchedAt).toISOString(),
    },
    calldata,
    eip712,
    sourcify,
    clearSigned,
    ...(!clearSigned && context.serviceLink
      ? { getDescribed: context.serviceLink }
      : {}),
    textChanged,
  }
}

function metadataOf(descriptor: Descriptor): {
  owner?: string
  contractName?: string
} {
  const metadata = descriptor.metadata
  const owner = typeof metadata?.owner === "string" ? metadata.owner : undefined
  const contractName =
    typeof metadata?.contractName === "string"
      ? metadata.contractName
      : undefined
  return {
    ...(owner ? { owner } : {}),
    ...(contractName ? { contractName } : {}),
  }
}

export function functionsOf(descriptor: Descriptor): DescribedFunction[] {
  const formats = descriptor.display?.formats
  if (!formats || typeof formats !== "object") return []
  return Object.entries(formats).map(([format, spec]) => {
    const intent = (spec as { intent?: unknown } | undefined)?.intent
    return {
      format,
      ...selectorOf(format),
      ...(typeof intent === "string" || isStringRecord(intent)
        ? { intent }
        : {}),
    }
  })
}

function selectorOf(format: string): { selector?: Hex } {
  if (/^0x[0-9a-fA-F]{8}$/.test(format))
    return { selector: format.toLowerCase() as Hex }
  try {
    return { selector: toFunctionSelector(`function ${format}`) }
  } catch {
    return {}
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((v) => typeof v === "string")
  )
}
