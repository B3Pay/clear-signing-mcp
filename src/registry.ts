import {
  attestationPathForDescriptor,
  type Descriptor,
  type DescriptorResolver,
  type RegistryIndex,
  type TypedDataIndexEntry,
} from "@ethereum-sourcify/clear-signing"
import type { OffchainAttestation } from "@ethereum-sourcify/clear-signing"
import { fetchJson, TtlCache, type FetchLike } from "./fetch.js"

/**
 * Reads ERC-7730 descriptors from one named registry: the Ethereum
 * Foundation's by default. Nothing else is a descriptor source, so a
 * descriptor can only enter through the registry an operator chose.
 */

export interface RegistrySource {
  /** `owner/name` of the GitHub repository. */
  readonly repo: string
  /** Branch, tag or commit. */
  readonly ref: string
}

export const DEFAULT_REGISTRY: RegistrySource = {
  repo: "ethereum/clear-signing-erc7730-registry",
  ref: "master",
}

export interface RegistryClientOptions {
  readonly source?: RegistrySource
  readonly fetch?: FetchLike
  readonly timeoutMs?: number
  /** How long the two index files are reused before they are fetched again. */
  readonly indexTtlMs?: number
  /** How long a descriptor or attestation file is reused. */
  readonly fileTtlMs?: number
  readonly maxCachedFiles?: number
  readonly now?: () => number
}

export interface LoadedIndex extends RegistryIndex {
  /** When the index files were read, in milliseconds since the epoch. */
  readonly fetchedAt: number
  /** Entries left out because their key or path was malformed. */
  readonly dropped: number
}

const MAX_INDEX_BYTES = 8 * 1024 * 1024
const MAX_DESCRIPTOR_BYTES = 2 * 1024 * 1024
const MAX_ATTESTATION_BYTES = 64 * 1024

const CAIP10_KEY = /^eip155:[1-9][0-9]{0,15}:0x[0-9a-f]{40}$/
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const REF_NAME = /^[A-Za-z0-9_./-]+$/
const PATH_SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.+-]*$/
const HASH32 = /^0x[0-9a-f]{64}$/

/**
 * Whether `path` may be read from the registry: a relative `.json` path
 * under `registry/` or `ercs/`, with no `.` or `..` segment and no character
 * outside letters, digits and `_ . + -`. Everything else is refused before
 * any request.
 */
export function isRegistryPath(path: string): boolean {
  if (path.length > 512 || !path.endsWith(".json")) return false
  const segments = path.split("/")
  if (segments.length < 2) return false
  if (segments[0] !== "registry" && segments[0] !== "ercs") return false
  return segments.every((segment) => PATH_SEGMENT.test(segment))
}

export function parseCalldataIndex(value: unknown): {
  index: RegistryIndex["calldataIndex"]
  dropped: number
} {
  if (!isPlainObject(value))
    throw new Error("index.calldata.json is not a JSON object")
  const index: Record<string, string> = {}
  let dropped = 0
  for (const [key, path] of Object.entries(value)) {
    if (
      CAIP10_KEY.test(key) &&
      typeof path === "string" &&
      isRegistryPath(path)
    ) {
      index[key] = path
    } else {
      dropped += 1
    }
  }
  return { index, dropped }
}

export function parseTypedDataIndex(value: unknown): {
  index: RegistryIndex["typedDataIndex"]
  dropped: number
} {
  if (!isPlainObject(value))
    throw new Error("index.eip712.json is not a JSON object")
  const index: RegistryIndex["typedDataIndex"] = {}
  let dropped = 0
  for (const [key, byType] of Object.entries(value)) {
    if (!CAIP10_KEY.test(key) || !isPlainObject(byType)) {
      dropped += 1
      continue
    }
    const types: Record<string, TypedDataIndexEntry[]> = {}
    for (const [primaryType, entries] of Object.entries(byType)) {
      if (!Array.isArray(entries)) {
        dropped += 1
        continue
      }
      const kept: TypedDataIndexEntry[] = []
      for (const entry of entries) {
        if (
          isPlainObject(entry) &&
          typeof entry.path === "string" &&
          isRegistryPath(entry.path) &&
          Array.isArray(entry.encodeTypeHashes) &&
          entry.encodeTypeHashes.every(
            (hash) => typeof hash === "string" && HASH32.test(hash)
          )
        ) {
          kept.push({
            path: entry.path,
            encodeTypeHashes: entry.encodeTypeHashes as string[],
          })
        } else {
          dropped += 1
        }
      }
      if (kept.length > 0) types[primaryType] = kept
    }
    index[key] = types
  }
  return { index, dropped }
}

export class RegistryClient {
  readonly source: RegistrySource
  private readonly fetch: FetchLike
  private readonly timeoutMs: number
  private readonly indexCache: TtlCache<LoadedIndex>
  private readonly descriptorCache: TtlCache<Descriptor>
  private readonly attestationCache: TtlCache<OffchainAttestation | null>
  private readonly now: () => number

  constructor(options: RegistryClientOptions = {}) {
    const source = options.source ?? DEFAULT_REGISTRY
    if (!REPO_NAME.test(source.repo))
      throw new Error(`Registry repository "${source.repo}" is not owner/name`)
    if (!REF_NAME.test(source.ref) || source.ref.split("/").includes("..")) {
      throw new Error(
        `Registry ref "${source.ref}" is not a valid branch, tag or commit`
      )
    }
    this.source = source
    this.fetch =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.now = options.now ?? Date.now
    const fileTtl = options.fileTtlMs ?? 10 * 60_000
    const maxFiles = options.maxCachedFiles ?? 512
    this.indexCache = new TtlCache(
      options.indexTtlMs ?? 10 * 60_000,
      1,
      this.now
    )
    this.descriptorCache = new TtlCache(fileTtl, maxFiles, this.now)
    this.attestationCache = new TtlCache(fileTtl, maxFiles, this.now)
  }

  /** `owner/name@ref`, the name results give for where a descriptor came from. */
  get label(): string {
    return `${this.source.repo}@${this.source.ref}`
  }

  /** A link a person can open to read the file. */
  webUrl(path: string): string {
    return `https://github.com/${this.source.repo}/blob/${this.source.ref}/${encodePath(path)}`
  }

  private rawUrl(path: string): string {
    return `https://raw.githubusercontent.com/${this.source.repo}/${this.source.ref}/${encodePath(path)}`
  }

  index(): Promise<LoadedIndex> {
    return this.indexCache.get("index", async () => {
      const [calldata, typedData] = await Promise.all([
        fetchJson(this.rawUrl("index.calldata.json"), {
          fetch: this.fetch,
          timeoutMs: this.timeoutMs,
          maxBytes: MAX_INDEX_BYTES,
        }),
        fetchJson(this.rawUrl("index.eip712.json"), {
          fetch: this.fetch,
          timeoutMs: this.timeoutMs,
          maxBytes: MAX_INDEX_BYTES,
        }),
      ])
      const parsedCalldata = parseCalldataIndex(calldata)
      const parsedTypedData = parseTypedDataIndex(typedData)
      return {
        calldataIndex: parsedCalldata.index,
        typedDataIndex: parsedTypedData.index,
        fetchedAt: this.now(),
        dropped: parsedCalldata.dropped + parsedTypedData.dropped,
      }
    })
  }

  descriptor(path: string): Promise<Descriptor> {
    if (!isRegistryPath(path))
      return Promise.reject(
        new Error(`Refusing to read registry path "${path}"`)
      )
    return this.descriptorCache.get(path, async () => {
      const value = await fetchJson(this.rawUrl(path), {
        fetch: this.fetch,
        timeoutMs: this.timeoutMs,
        maxBytes: MAX_DESCRIPTOR_BYTES,
      })
      if (!isPlainObject(value))
        throw new Error(`Descriptor ${path} is not a JSON object`)
      return value
    })
  }

  /** The attestation `attester` published for the descriptor at `descriptorPath`, or `null`. */
  attestation(
    descriptorPath: string,
    attester: string
  ): Promise<OffchainAttestation | null> {
    let path: string
    try {
      path = attestationPathForDescriptor(descriptorPath, attester)
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error))
      )
    }
    if (!isRegistryPath(path))
      return Promise.reject(
        new Error(`Refusing to read registry path "${path}"`)
      )
    return this.attestationCache.get(path, async () => {
      const value = await fetchJson(this.rawUrl(path), {
        fetch: this.fetch,
        timeoutMs: this.timeoutMs,
        maxBytes: MAX_ATTESTATION_BYTES,
        allowNotFound: true,
      })
      if (value === null) return null
      if (!isPlainObject(value))
        throw new Error(`Attestation ${path} is not a JSON object`)
      return value
    })
  }

  /** The library's resolver shape, backed by this client's bounded, cached reads. */
  async resolver(): Promise<DescriptorResolver> {
    const index = await this.index()
    return this.resolverFor(index)
  }

  resolverFor(index: RegistryIndex): DescriptorResolver {
    return {
      index,
      fetchDescriptor: (path) => this.descriptor(path),
      fetchAttestation: (path, attester) => this.attestation(path, attester),
    }
  }
}

/** Each segment percent-encoded, so a `+` in a file name stays a `+`. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/")
}

export function caip10(chainId: number, address: string): string {
  return `eip155:${chainId}:${address.toLowerCase()}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
