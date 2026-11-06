import { getAddress, isAddress } from "viem"
import { DEFAULT_ATTESTERS, type Attester } from "./attestation.js"
import { DEFAULT_REGISTRY, type RegistrySource } from "./registry.js"
import { DEFAULT_SOURCIFY_URL } from "./sourcify.js"

/**
 * Configuration comes from environment variables only, so the same build runs
 * locally over stdio and hosted, and no secret ever has to be written into a
 * file this repository tracks. RPC URLs can carry an API key: keep them in the
 * environment or a gitignored `.env`.
 */
export interface ServerConfig {
  readonly registry: RegistrySource
  readonly trustedAttesters?: readonly Attester[]
  readonly rpcUrls: Readonly<Record<number, string>>
  readonly publicRpcFallback: boolean
  readonly sourcifyUrl: string
  readonly fetchTimeoutMs: number
  readonly serviceLink: boolean
}

export const ENVIRONMENT = {
  registryRepo: "CLEAR_SIGNING_REGISTRY_REPO",
  registryRef: "CLEAR_SIGNING_REGISTRY_REF",
  trustedAttesters: "CLEAR_SIGNING_TRUSTED_ATTESTERS",
  publicRpc: "CLEAR_SIGNING_PUBLIC_RPC",
  sourcifyUrl: "SOURCIFY_SERVER_URL",
  timeout: "CLEAR_SIGNING_TIMEOUT_MS",
  serviceLink: "CLEAR_SIGNING_SERVICE_LINK",
  rpcPrefix: "RPC_URL_",
} as const

export function loadConfig(
  env: Readonly<Record<string, string | undefined>>
): ServerConfig {
  const rpcUrls: Record<number, string> = {}
  for (const [name, value] of Object.entries(env)) {
    const match = /^RPC_URL_([1-9][0-9]{0,15})$/.exec(name)
    if (!match?.[1] || !value) continue
    rpcUrls[Number(match[1])] = parseHttpUrl(value, name)
  }

  const attesterList = env[ENVIRONMENT.trustedAttesters]
  let trustedAttesters: Attester[] | undefined
  if (attesterList !== undefined && attesterList.trim() !== "") {
    trustedAttesters = attesterList.split(",").map((raw) => {
      const address = raw.trim()
      if (!isAddress(address, { strict: false })) {
        throw new Error(
          `${ENVIRONMENT.trustedAttesters} has "${address}", which is not an address`
        )
      }
      const checksummed = getAddress(address)
      const known = DEFAULT_ATTESTERS.find((a) => a.address === checksummed)
      return known ?? { address: checksummed }
    })
  }

  const timeout = env[ENVIRONMENT.timeout]
  const fetchTimeoutMs = timeout === undefined ? 10_000 : Number(timeout)
  if (
    !Number.isInteger(fetchTimeoutMs) ||
    fetchTimeoutMs < 100 ||
    fetchTimeoutMs > 120_000
  ) {
    throw new Error(
      `${ENVIRONMENT.timeout} must be a whole number of milliseconds from 100 to 120000`
    )
  }

  return {
    registry: {
      repo: env[ENVIRONMENT.registryRepo]?.trim() || DEFAULT_REGISTRY.repo,
      ref: env[ENVIRONMENT.registryRef]?.trim() || DEFAULT_REGISTRY.ref,
    },
    ...(trustedAttesters ? { trustedAttesters } : {}),
    rpcUrls,
    publicRpcFallback: parseFlag(
      env[ENVIRONMENT.publicRpc],
      true,
      ENVIRONMENT.publicRpc
    ),
    sourcifyUrl: parseHttpUrl(
      env[ENVIRONMENT.sourcifyUrl] ?? DEFAULT_SOURCIFY_URL,
      ENVIRONMENT.sourcifyUrl
    ),
    fetchTimeoutMs,
    serviceLink: parseFlag(
      env[ENVIRONMENT.serviceLink],
      true,
      ENVIRONMENT.serviceLink
    ),
  }
}

function parseHttpUrl(value: string, name: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error(`${name} is not a URL`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be an http or https URL`)
  }
  return url.toString()
}

function parseFlag(
  value: string | undefined,
  fallback: boolean,
  name: string
): boolean {
  if (value === undefined || value.trim() === "") return fallback
  const normalized = value.trim().toLowerCase()
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  throw new Error(`${name} must be 1 or 0`)
}
