import {
  computeDescriptorHash,
  resolveCalldataDescriptor,
  type ChainClient,
  type Descriptor,
  type DescriptorResolver,
} from "@ethereum-sourcify/clear-signing"
import { getAddress, type Address } from "viem"
import { caip10, type RegistryClient } from "./registry.js"

/**
 * ERC-8176 attestation checks. A descriptor is reported as attested only when
 * a trusted auditor's attestation verifies offline (schema, descriptor hash,
 * expiry, signature, UID, all done by the Sourcify library) and the canonical
 * EAS contract on Ethereum mainnet says it was not revoked. Any other outcome
 * is reported as something else, never as attested.
 */

export interface Attester {
  readonly address: Address
  /** Who the registry lists at that address, for people reading results. */
  readonly name?: string
}

/**
 * The auditors the registry lists in its `auditors/` directory, checked on
 * 6 November 2026: one profile, `eip155-1-0x3846…31f6`, "Patrick Collins",
 * organization "Cyfrin". Operators can replace this list with
 * `CLEAR_SIGNING_TRUSTED_ATTESTERS`.
 */
export const DEFAULT_ATTESTERS: readonly Attester[] = [
  {
    address: "0x3846c3A30E62075Fa916216b35EF04B8F53931f6",
    name: "Cyfrin (Patrick Collins)",
  },
]

export type AttestationReport =
  | {
      readonly status: "attested"
      readonly descriptorHash: string
      /** The trusted auditors whose attestation verified and is not revoked. */
      readonly attesters: readonly Attester[]
    }
  | {
      readonly status: "not_attested"
      readonly descriptorHash: string
      /** The trusted auditors that were looked for. */
      readonly checked: readonly Attester[]
    }
  | {
      readonly status: "invalid"
      readonly descriptorHash: string
      /** Why each attestation found did not count: wrong hash, expired, bad signature or revoked. */
      readonly detail: string
    }
  | {
      readonly status: "unchecked"
      readonly descriptorHash: string
      /** The trusted auditors that published an attestation file for this descriptor. */
      readonly filesFrom: readonly Attester[]
      readonly reason: string
    }

export interface CheckAttestationsArgs {
  readonly registry: RegistryClient
  readonly descriptorPath: string
  /** The descriptor with its `includes` already merged, as the library resolves it. */
  readonly descriptor: Descriptor
  readonly attesters: readonly Attester[]
  /** Raw `eth_call` access to Ethereum mainnet, for the revocation check. */
  readonly chainClient?: ChainClient
  /** The chain and contract the descriptor is used for. */
  readonly chainId: number
  readonly address: string
}

export async function checkAttestations(
  args: CheckAttestationsArgs
): Promise<AttestationReport> {
  const descriptorHash = computeDescriptorHash(args.descriptor)

  const present: Attester[] = []
  for (const attester of args.attesters) {
    const file = await args.registry.attestation(
      args.descriptorPath,
      getAddress(attester.address)
    )
    if (file) present.push(attester)
  }
  if (present.length === 0) {
    return { status: "not_attested", descriptorHash, checked: args.attesters }
  }
  if (!args.chainClient) {
    return {
      status: "unchecked",
      descriptorHash,
      filesFrom: present,
      reason:
        "An attestation file exists, but checking that it was not revoked needs an Ethereum mainnet RPC, and none is configured.",
    }
  }

  // The library's attestation policy runs inside descriptor resolution, so it
  // is given a resolver whose index holds just this descriptor, one trusted
  // attester at a time, to learn which of them verified.
  const resolver: DescriptorResolver = {
    index: {
      calldataIndex: {
        [caip10(args.chainId, args.address)]: args.descriptorPath,
      },
      typedDataIndex: {},
    },
    fetchDescriptor: (path) => args.registry.descriptor(path),
    fetchAttestation: (path, attester) =>
      args.registry.attestation(path, attester),
  }
  const verified: Attester[] = []
  const failures: string[] = []
  for (const attester of present) {
    let result: Awaited<ReturnType<typeof resolveCalldataDescriptor>>
    try {
      result = await resolveCalldataDescriptor(
        args.chainId,
        args.address,
        {
          type: "custom",
          resolver,
          attestations: { trustedAttesters: [attester.address] },
        },
        args.chainClient
      )
    } catch (error) {
      return {
        status: "unchecked",
        descriptorHash,
        filesFrom: present,
        reason: `The revocation check on Ethereum mainnet failed: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
    if ("descriptor" in result) {
      if (computeDescriptorHash(result.descriptor) === descriptorHash) {
        verified.push(attester)
      } else {
        failures.push(
          `${attester.address}: the descriptor changed while it was being checked`
        )
      }
    } else {
      failures.push(result.warning.message)
    }
  }
  if (verified.length > 0)
    return { status: "attested", descriptorHash, attesters: verified }
  return { status: "invalid", descriptorHash, detail: failures.join("; ") }
}

/** One line for a person: what the attestation status means. */
export function describeAttestation(report: AttestationReport): string {
  switch (report.status) {
    case "attested":
      return `attested by ${report.attesters.map(nameOf).join(", ")} (ERC-8176, verified, not revoked)`
    case "not_attested":
      return "not attested by a trusted auditor"
    case "invalid":
      return "an attestation exists but does not count (wrong descriptor hash, expired, bad signature or revoked)"
    case "unchecked":
      return `attestation file from ${report.filesFrom.map(nameOf).join(", ")} not checked: ${report.reason}`
  }
}

function nameOf(attester: Attester): string {
  return attester.name
    ? `${attester.name} ${attester.address}`
    : attester.address
}
