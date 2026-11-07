import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, type Dirent } from "node:fs"
import { dirname, join, resolve } from "node:path"
import {
  mergeDescriptors,
  resolveCalldataDescriptor,
  type ChainClient,
  type Descriptor,
  type RegistryIndex,
} from "@ethereum-sourcify/clear-signing"
import { createFilesystemResolver } from "@ethereum-sourcify/clear-signing/filesystem"
import {
  checkAttestations,
  DEFAULT_ATTESTERS,
  type AttestationReport,
} from "../src/attestation.js"
import type { DraftRegistry } from "../src/draft/index.js"
import {
  caip10,
  parseCalldataIndex,
  parseTypedDataIndex,
  RegistryClient,
} from "../src/registry.js"
import { functionsOf } from "../src/status.js"

/**
 * The registry as the tracker reads it: a local clone of
 * ethereum/clear-signing-erc7730-registry at one commit. Descriptors are
 * resolved with Sourcify's library, `includes` and all, exactly as a wallet
 * that uses the library resolves them.
 */

export const REGISTRY_REPO = "ethereum/clear-signing-erc7730-registry"

export interface RegistrySnapshot {
  readonly dir: string
  readonly commit: string
  readonly committedAt: string
  readonly index: RegistryIndex
}

export function loadRegistrySnapshot(dir: string): RegistrySnapshot {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(join(dir, name), "utf8"))
  const calldata = parseCalldataIndex(read("index.calldata.json"))
  const typed = parseTypedDataIndex(read("index.eip712.json"))
  const [commit, committedAt] = execFileSync(
    "git",
    ["-C", dir, "log", "-1", "--format=%H %cI"],
    { encoding: "utf8" }
  )
    .trim()
    .split(" ")
  if (!commit || !/^[0-9a-f]{40}$/.test(commit) || !committedAt)
    throw new Error(`${dir} is not a git clone of the registry`)
  return {
    dir,
    commit,
    committedAt,
    index: {
      calldataIndex: calldata.index,
      typedDataIndex: typed.index,
    },
  }
}

/**
 * A clone as the draft engine reads it, so that a draft's tests render a
 * call a `calldata` field carries as check-drafts' test runner renders it:
 * with the calldata index the runner builds from the clone's files
 * (src/descriptor-index.ts at validate.ts's TEST_RUNNER.commit). Every
 * calldata-* and eip712-* file under registry/ and ercs/, outside tests/,
 * testsv2/ and dot folders, is read with its includes merged, and the first
 * in name order to list a contract deployment gets it; a file that cannot be
 * read is left out. Typed data is not indexed, since a calldata field
 * carries a contract call. index.calldata.json is not read: a workflow
 * rewrites it after descriptors change, so it can lag them.
 */
export function draftRegistry(dir: string): DraftRegistry {
  const root = resolve(dir)
  if (!existsSync(join(root, "registry")))
    throw new Error(
      `${root} is not a clone of the ERC-7730 registry: it has no registry folder.`
    )
  const calldataIndex: Record<string, string> = {}
  for (const path of descriptorPaths(root)) {
    let descriptor: Descriptor
    try {
      descriptor = withIncludes(join(root, path), new Set())
    } catch {
      continue
    }
    for (const d of descriptor.context?.contract?.deployments ?? [])
      if (d.chainId != null && d.address)
        calldataIndex[`eip155:${d.chainId}:${d.address.toLowerCase()}`] ??= path
  }
  return {
    index: { calldataIndex, typedDataIndex: {} },
    descriptorDirectory: root,
  }
}

/** The descriptor files the runner indexes, relative to the clone, in its order. */
function descriptorPaths(root: string): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const path = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (
          entry.name !== "tests" &&
          entry.name !== "testsv2" &&
          !entry.name.startsWith(".")
        )
          walk(path)
      } else if (
        entry.isFile() &&
        /^(calldata|eip712)-/.test(entry.name) &&
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".tests.json")
      )
        out.push(path)
    }
  }
  walk("registry")
  walk("ercs")
  return out
}

/** A descriptor with what it includes merged in, as the runner merges it. */
function withIncludes(file: string, seen: Set<string>): Descriptor {
  if (seen.has(file)) throw new Error(`${file} includes itself`)
  seen.add(file)
  const descriptor = JSON.parse(readFileSync(file, "utf8")) as Descriptor
  if (typeof descriptor.includes !== "string") return descriptor
  return mergeDescriptors(
    descriptor,
    withIncludes(resolve(dirname(file), descriptor.includes), seen)
  )
}

export interface DescriptorFacts {
  readonly path: string
  readonly url: string
  readonly owner: string | null
  /** Lowercase 4-byte selectors of the functions the descriptor formats. */
  readonly selectors: ReadonlySet<string>
  /** The `display.formats` keys, by selector. */
  readonly formats: ReadonlyMap<string, string>
  readonly attestation: AttestationReport["status"] | "no_file"
}

export interface CheckOptions {
  /** Ethereum mainnet access, for the attestation revocation check. */
  readonly mainnet?: ChainClient
}

interface Resolved {
  readonly path: string
  readonly descriptor: Descriptor
}

/** The descriptor the calldata index lists for (chainId, address), includes resolved. */
async function resolveDescriptor(
  snapshot: RegistrySnapshot,
  chainId: number,
  address: string
): Promise<Resolved | null> {
  const path = snapshot.index.calldataIndex[caip10(chainId, address)]
  if (!path) return null
  const resolver = createFilesystemResolver({
    index: snapshot.index,
    descriptorDirectory: snapshot.dir,
  })
  const result = await resolveCalldataDescriptor(chainId, address, {
    type: "custom",
    resolver,
  })
  if ("warning" in result)
    throw new Error(`${path} did not resolve: ${result.warning.message}`)
  return { path, descriptor: result.descriptor }
}

function formatsOf(descriptor: Descriptor): Map<string, string> {
  const formats = new Map<string, string>()
  for (const fn of functionsOf(descriptor))
    if (fn.selector) formats.set(fn.selector.toLowerCase(), fn.format)
  return formats
}

function urlOf(snapshot: RegistrySnapshot, path: string): string {
  return `https://github.com/${REGISTRY_REPO}/blob/${snapshot.commit}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`
}

/**
 * The registry's descriptor for a deployment, with what it formats and
 * whether a trusted auditor's attestation verifies; null when the index
 * lists nothing for (chainId, address).
 */
export async function descriptorFacts(
  snapshot: RegistrySnapshot,
  chainId: number,
  address: string,
  options: CheckOptions = {}
): Promise<DescriptorFacts | null> {
  const resolved = await resolveDescriptor(snapshot, chainId, address)
  if (!resolved) return null
  const { path, descriptor } = resolved
  const formats = formatsOf(descriptor)
  const owner =
    typeof descriptor.metadata?.owner === "string"
      ? descriptor.metadata.owner
      : null
  return {
    path,
    url: urlOf(snapshot, path),
    owner,
    selectors: new Set(formats.keys()),
    formats,
    attestation: await attestationOf(
      snapshot,
      path,
      descriptor,
      chainId,
      address,
      options
    ),
  }
}

/** What a deployment's descriptor formats, without the attestation check. */
export interface DescribedFunctions {
  readonly chainId: number
  /** Lowercase, as the calldata index keys it. */
  readonly address: string
  readonly path: string
  readonly url: string
  /** Lowercase 4-byte selectors of the functions the descriptor formats. */
  readonly selectors: ReadonlySet<string>
}

/**
 * The functions the registry's descriptor for (chainId, address) formats;
 * null when the index lists nothing for it. No network: this is the cheap
 * lookup for comparing one deployment's calls with another's descriptor.
 */
export async function describedFunctions(
  snapshot: RegistrySnapshot,
  chainId: number,
  address: string
): Promise<DescribedFunctions | null> {
  const resolved = await resolveDescriptor(snapshot, chainId, address)
  if (!resolved) return null
  return {
    chainId,
    address: address.toLowerCase(),
    path: resolved.path,
    url: urlOf(snapshot, resolved.path),
    selectors: new Set(formatsOf(resolved.descriptor).keys()),
  }
}

/** The chains the calldata index lists each address on, by lowercase address. */
export function chainsByAddress(
  snapshot: RegistrySnapshot
): ReadonlyMap<string, readonly number[]> {
  const out = new Map<string, number[]>()
  for (const key of Object.keys(snapshot.index.calldataIndex)) {
    const match = /^eip155:(\d+):(0x[0-9a-f]{40})$/.exec(key)
    if (!match) continue
    const chains = out.get(match[2]!) ?? []
    chains.push(Number(match[1]))
    out.set(match[2]!, chains)
  }
  for (const chains of out.values()) chains.sort((a, b) => a - b)
  return out
}

async function attestationOf(
  snapshot: RegistrySnapshot,
  path: string,
  descriptor: Descriptor,
  chainId: number,
  address: string,
  options: CheckOptions
): Promise<DescriptorFacts["attestation"]> {
  const slash = path.lastIndexOf("/")
  const name = path.slice(slash + 1).replace(/\.json$/, "")
  const sigs = join(snapshot.dir, path.slice(0, slash), "sigs")
  const anyFile = DEFAULT_ATTESTERS.some((attester) =>
    existsSync(join(sigs, `${name}.eip155-1-${attester.address}.json`))
  )
  if (!anyFile) return "no_file"
  // Files are read through the registry client pinned to the snapshot's
  // commit, so the check sees the same bytes as the clone.
  const registry = new RegistryClient({
    source: { repo: REGISTRY_REPO, ref: snapshot.commit },
  })
  const report = await checkAttestations({
    registry,
    descriptorPath: path,
    descriptor,
    attesters: DEFAULT_ATTESTERS,
    ...(options.mainnet ? { chainClient: options.mainnet } : {}),
    chainId,
    address,
  })
  return report.status
}

/** Deployments the calldata index lists on the given chains. */
export function deploymentsOn(
  snapshot: RegistrySnapshot,
  chainIds: readonly number[]
): number {
  const wanted = new Set(chainIds.map(String))
  return Object.keys(snapshot.index.calldataIndex).filter((key) =>
    wanted.has(key.split(":")[1] ?? "")
  ).length
}
