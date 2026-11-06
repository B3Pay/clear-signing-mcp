import { getAddress, type Abi, type Address } from "viem"
import { fetchJson, FetchError, TtlCache, type FetchLike } from "./fetch.js"

/**
 * Sourcify's v2 lookup API: whether a contract's source is verified, its
 * verified ABI, and the implementation behind a proxy. The registry requires
 * Sourcify verification before a descriptor is accepted, so this is also the
 * first thing a protocol without a descriptor needs.
 */

export const DEFAULT_SOURCIFY_URL = "https://sourcify.dev/server"

export type SourcifyMatch = "exact_match" | "match"

export interface ProxyInfo {
  readonly type: string | null
  readonly implementations: readonly {
    readonly address: Address
    readonly name?: string
  }[]
}

export type SourcifyReport =
  | {
      readonly status: "verified"
      readonly match: SourcifyMatch
      readonly creationMatch: SourcifyMatch | null
      readonly runtimeMatch: SourcifyMatch | null
      readonly verifiedAt?: string
      readonly proxy?: ProxyInfo
      /** A page a person can open. */
      readonly url: string
    }
  | { readonly status: "not_verified"; readonly url: string }
  | { readonly status: "unavailable"; readonly reason: string }

export interface SourcifyContract {
  readonly report: SourcifyReport
  readonly abi?: Abi
}

export interface SourcifyClientOptions {
  readonly baseUrl?: string
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  readonly cacheTtlMs?: number
  readonly now?: () => number
}

const MAX_LOOKUP_BYTES = 4 * 1024 * 1024

export class SourcifyClient {
  private readonly baseUrl: string
  private readonly fetch: FetchLike
  private readonly timeoutMs: number
  private readonly cache: TtlCache<SourcifyContract>

  constructor(options: SourcifyClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_SOURCIFY_URL).replace(/\/+$/, "")
    this.fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.cache = new TtlCache(
      options.cacheTtlMs ?? 10 * 60_000,
      512,
      options.now
    )
  }

  /** Verification status, proxy details and the verified ABI, in one request. */
  contract(chainId: number, address: Address): Promise<SourcifyContract> {
    const checksummed = getAddress(address)
    return this.cache
      .get(`${chainId}:${checksummed}`, async () => {
        const url = `${this.baseUrl}/v2/contract/${chainId}/${checksummed}?fields=abi,proxyResolution`
        const page = `https://repo.sourcify.dev/${chainId}/${checksummed}`
        let body: unknown
        try {
          body = await fetchJson(url, {
            fetch: this.fetch,
            timeoutMs: this.timeoutMs,
            maxBytes: MAX_LOOKUP_BYTES,
            allowNotFound: true,
          })
        } catch (error) {
          const reason =
            error instanceof FetchError && error.status === 429
              ? "Sourcify is rate-limiting requests; try again shortly."
              : error instanceof Error
                ? error.message
                : String(error)
          return { report: { status: "unavailable", reason } }
        }
        if (body === null)
          return { report: { status: "not_verified", url: page } }
        return parseContract(body, page)
      })
      .catch((error: unknown) => ({
        report: {
          status: "unavailable" as const,
          reason: error instanceof Error ? error.message : String(error),
        },
      }))
  }
}

function parseContract(body: unknown, page: string): SourcifyContract {
  if (!isObject(body))
    return {
      report: {
        status: "unavailable",
        reason: "Sourcify answered with a non-object",
      },
    }
  const match = asMatch(body.match)
  if (!match) return { report: { status: "not_verified", url: page } }

  let proxy: ProxyInfo | undefined
  const resolution = body.proxyResolution
  if (isObject(resolution) && resolution.isProxy === true) {
    const implementations: { address: Address; name?: string }[] = []
    if (Array.isArray(resolution.implementations)) {
      for (const item of resolution.implementations.slice(0, 16)) {
        if (
          isObject(item) &&
          typeof item.address === "string" &&
          /^0x[0-9a-fA-F]{40}$/.test(item.address)
        ) {
          implementations.push({
            address: getAddress(item.address),
            ...(typeof item.name === "string" ? { name: item.name } : {}),
          })
        }
      }
    }
    proxy = {
      type:
        typeof resolution.proxyType === "string" ? resolution.proxyType : null,
      implementations,
    }
  }

  const abi = Array.isArray(body.abi) ? (body.abi as Abi) : undefined
  return {
    report: {
      status: "verified",
      match,
      creationMatch: asMatch(body.creationMatch),
      runtimeMatch: asMatch(body.runtimeMatch),
      ...(typeof body.verifiedAt === "string"
        ? { verifiedAt: body.verifiedAt }
        : {}),
      ...(proxy ? { proxy } : {}),
      url: page,
    },
    ...(abi ? { abi } : {}),
  }
}

function asMatch(value: unknown): SourcifyMatch | null {
  return value === "exact_match" || value === "match" ? value : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
