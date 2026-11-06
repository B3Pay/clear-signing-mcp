import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Abi, Address, Hex } from "viem"

/**
 * The files the fetch step writes under `tracker/data/` and the later steps
 * read. Each is plain JSON written with sorted keys, so a re-fetch that
 * learns nothing new changes nothing.
 */

export type SourcifyFacts =
  | {
      readonly status: "verified"
      readonly match: "exact_match" | "match"
      readonly name?: string
      readonly proxy?: {
        readonly type: string | null
        readonly implementations: readonly { address: Address; name?: string }[]
      }
    }
  | { readonly status: "not_verified" }
  | { readonly status: "error"; readonly reason: string }

export type BlockscoutFacts =
  | {
      readonly status: "ok"
      readonly isContract: boolean
      readonly verified: boolean
      readonly name?: string
      readonly implementations: readonly { address: Address; name?: string }[]
    }
  | { readonly status: "error"; readonly reason: string }

export interface SampleSummary {
  readonly source: "blockscout-txlist" | "blockscout-v2"
  /** How many transactions were asked for. */
  readonly requested: number
  /** Top-level transactions sent to the contract in the sample. */
  readonly count: number
  readonly failed: number
  /** Unix seconds of the oldest and newest transaction in the sample. */
  readonly oldest: number | null
  readonly newest: number | null
  /** Transactions per day over the sample's time span; null below 2 transactions. */
  readonly perDay: number | null
  /** Transactions per 4-byte selector; "0x" is a call with no selector (a plain transfer). */
  readonly selectors: Readonly<Record<string, number>>
}

export interface OnchainRecord {
  readonly chainId: number
  readonly address: Address
  readonly fetchedAt: string
  readonly codeBytes: number | null
  readonly codeError?: string
  readonly sourcify: SourcifyFacts
  readonly blockscout: BlockscoutFacts
  /** Where the ABI in abis/ came from, when there is one. */
  readonly abi: {
    readonly source: "sourcify" | "blockscout"
    /** The contract whose ABI it is: the implementation, behind a proxy. */
    readonly address: Address
    readonly name?: string
    readonly functions: number
  } | null
  readonly sample: SampleSummary | { readonly error: string }
}

export interface AbiFile {
  readonly source: "sourcify" | "blockscout"
  readonly address: Address
  readonly name?: string
  readonly abi: Abi
}

/** One real transaction, with every field needed to rebuild it unsigned. */
export interface SampleTx {
  readonly hash: Hex
  readonly chainId: number
  readonly blockNumber: number
  readonly timestamp: number
  readonly from: Address
  readonly to: Address
  readonly value: string
  readonly input: Hex
  readonly nonce: number
  readonly gas: string
  readonly type: "legacy" | "eip2930" | "eip1559" | "eip4844" | "eip7702"
  readonly gasPrice?: string
  readonly maxFeePerGas?: string
  readonly maxPriorityFeePerGas?: string
  readonly accessList?: readonly {
    address: Address
    storageKeys: readonly Hex[]
  }[]
  readonly status: "success" | "reverted"
}

export interface SamplesFile {
  readonly chainId: number
  readonly address: Address
  readonly txs: readonly SampleTx[]
}

export interface TokenInfo {
  readonly symbol: string
  readonly decimals: number
  readonly name?: string
}

export type TokensFile = Readonly<Record<string, TokenInfo>>

export function dataPaths(root: string) {
  return {
    onchain: (chainId: number, address: string) =>
      join(root, "onchain", String(chainId), `${address.toLowerCase()}.json`),
    abi: (chainId: number, address: string) =>
      join(root, "abis", String(chainId), `${address.toLowerCase()}.json`),
    samples: (chainId: number, address: string) =>
      join(root, "samples", String(chainId), `${address.toLowerCase()}.json`),
    tokens: (chainId: number) => join(root, "tokens", `${chainId}.json`),
    defillama: join(root, "defillama.json"),
  }
}

/** JSON with object keys sorted at every level, two-space indent, final newline. */
export function stableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(value), null, 2)}\n`
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
    )
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]))
  }
  return value
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stableJson(value))
}

export function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, "utf8")) as T
}
