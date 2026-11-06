import type { ChainClient } from "@ethereum-sourcify/clear-signing"
import { DEFAULT_ATTESTERS, type Attester } from "./attestation.js"
import { ChainAccess } from "./chains.js"
import type { ServerConfig } from "./config.js"
import type { FetchLike } from "./fetch.js"
import { RegistryClient } from "./registry.js"
import { SourcifyClient } from "./sourcify.js"

/** Everything the tools read from: one registry, Sourcify, and chain access. */
export interface ToolContext {
  readonly registry: RegistryClient
  readonly sourcify: SourcifyClient
  readonly chains: ChainAccess
  readonly attesters: readonly Attester[]
  /**
   * Reads the EAS contract on Ethereum mainnet for revocations. Defaults to
   * the mainnet RPC of `chains`; `null` turns the revocation check off, so no
   * attestation can be reported as attested.
   */
  readonly attestationChainClient?: ChainClient | null
  /** Where a protocol can get a descriptor written; `null` leaves the link out. */
  readonly serviceLink: string | null
}

export const SERVICE_LINK = "https://b3pay.net/clear-signing/"

export interface CreateContextOptions {
  readonly fetch?: FetchLike
  readonly attestationChainClient?: ChainClient | null
}

export function createContext(
  config: ServerConfig,
  options: CreateContextOptions = {}
): ToolContext {
  return {
    registry: new RegistryClient({
      source: config.registry,
      timeoutMs: config.fetchTimeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    sourcify: new SourcifyClient({
      baseUrl: config.sourcifyUrl,
      timeoutMs: config.fetchTimeoutMs,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    chains: new ChainAccess({
      urls: config.rpcUrls,
      publicFallback: config.publicRpcFallback,
      timeoutMs: config.fetchTimeoutMs,
    }),
    attesters: config.trustedAttesters ?? DEFAULT_ATTESTERS,
    ...(options.attestationChainClient !== undefined
      ? { attestationChainClient: options.attestationChainClient }
      : {}),
    serviceLink: config.serviceLink ? SERVICE_LINK : null,
  }
}

/** The chain client used for revocation checks, after the override above. */
export function revocationClient(
  context: ToolContext
): ChainClient | undefined {
  if (context.attestationChainClient === null) return undefined
  return context.attestationChainClient ?? context.chains.chainClient()
}
