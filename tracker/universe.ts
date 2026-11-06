import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getAddress, isAddress, type Address } from "viem"

/**
 * The contracts the tracker follows: one file per research group under
 * `tracker/contracts/`, each a list of protocols with the entry points users
 * sign transactions to. Every address comes from a source the file names.
 */

export const TRACKED_CHAINS = {
  1: "Ethereum",
  8453: "Base",
  42161: "Arbitrum One",
  10: "OP Mainnet",
} as const

export type TrackedChainId = keyof typeof TRACKED_CHAINS

export const CATEGORIES = [
  "dex",
  "aggregator",
  "bridge",
  "lending",
  "cdp",
  "stablecoin",
  "liquid-staking",
  "restaking",
  "yield",
  "derivatives",
  "nft",
  "identity",
  "social",
  "infrastructure",
  "rwa",
  "launchpad",
  "payments",
  "gaming",
] as const

export type Category = (typeof CATEGORIES)[number]

export interface UniverseContract {
  readonly chainId: TrackedChainId
  readonly address: Address
  readonly name: string
  readonly label: string
  readonly role: string
  readonly version?: string
  readonly proxy?: boolean
  readonly source: string
  readonly sourceKind: "raw" | "webfetch" | "registry"
  readonly sourceNote?: string
}

export interface UniverseProtocol {
  readonly protocol: string
  readonly name: string
  readonly category: Category
  readonly website: string
  readonly defillama?: string
  readonly notes?: string
  readonly contracts: readonly UniverseContract[]
  /** The file under tracker/contracts/ the protocol is listed in. */
  readonly group: string
}

export class UniverseError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `The contract list has ${problems.length} problem(s):\n${problems.join("\n")}`
    )
    this.name = "UniverseError"
  }
}

const PROTOCOL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const HTTPS = /^https:\/\/\S+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function isTrackedChain(value: unknown): value is TrackedChainId {
  return typeof value === "number" && Object.hasOwn(TRACKED_CHAINS, value)
}

/**
 * Checks one group file. Returns the protocols, or the problems found: a
 * missing field, an address that is not EIP-55 checksummed, a chain the
 * tracker does not follow, a source that is not an https URL.
 */
export function parseGroup(
  group: string,
  value: unknown
): { protocols: UniverseProtocol[]; problems: string[] } {
  const problems: string[] = []
  const protocols: UniverseProtocol[] = []
  const list = isRecord(value) ? value.protocols : value
  if (!Array.isArray(list)) {
    return { protocols, problems: [`${group}: expected {"protocols": [...]}`] }
  }
  for (const item of list) {
    if (!isRecord(item)) {
      problems.push(`${group}: a protocol entry is not an object`)
      continue
    }
    const where = `${group}:${String(item.protocol)}`
    const before = problems.length
    if (typeof item.protocol !== "string" || !PROTOCOL_ID.test(item.protocol))
      problems.push(`${where}: protocol id is not kebab-case`)
    if (!text(item.name)) problems.push(`${where}: name is missing`)
    if (!CATEGORIES.includes(item.category as Category))
      problems.push(`${where}: unknown category ${String(item.category)}`)
    if (typeof item.website !== "string" || !HTTPS.test(item.website))
      problems.push(`${where}: website is not an https URL`)
    if (!Array.isArray(item.contracts) || item.contracts.length === 0) {
      problems.push(`${where}: no contracts`)
      continue
    }
    const contracts: UniverseContract[] = []
    for (const entry of item.contracts as unknown[]) {
      if (!isRecord(entry)) {
        problems.push(`${where}: a contract entry is not an object`)
        continue
      }
      const at = `${where}:${String(entry.chainId)}:${String(entry.address)}`
      if (!isTrackedChain(entry.chainId))
        problems.push(`${at}: chain is not one the tracker follows`)
      if (
        typeof entry.address !== "string" ||
        !isAddress(entry.address, { strict: false })
      ) {
        problems.push(`${at}: not an address`)
        continue
      }
      if (entry.address !== getAddress(entry.address))
        problems.push(`${at}: address is not EIP-55 checksummed`)
      for (const key of ["name", "label", "role"] as const)
        if (!text(entry[key])) problems.push(`${at}: ${key} is missing`)
      if (typeof entry.source !== "string" || !HTTPS.test(entry.source))
        problems.push(`${at}: source is not an https URL`)
      if (
        entry.sourceKind !== "raw" &&
        entry.sourceKind !== "webfetch" &&
        entry.sourceKind !== "registry"
      )
        problems.push(`${at}: sourceKind is not raw, webfetch or registry`)
      if (problems.length > before) continue
      contracts.push({
        chainId: entry.chainId as TrackedChainId,
        address: entry.address,
        name: entry.name as string,
        label: entry.label as string,
        role: entry.role as string,
        ...(text(entry.version) ? { version: entry.version } : {}),
        ...(typeof entry.proxy === "boolean" ? { proxy: entry.proxy } : {}),
        source: entry.source as string,
        sourceKind: entry.sourceKind as UniverseContract["sourceKind"],
        ...(text(entry.sourceNote) ? { sourceNote: entry.sourceNote } : {}),
      })
    }
    if (problems.length > before) continue
    protocols.push({
      protocol: item.protocol as string,
      name: item.name as string,
      category: item.category as Category,
      website: item.website as string,
      ...(text(item.defillama) ? { defillama: item.defillama } : {}),
      ...(text(item.notes) ? { notes: item.notes } : {}),
      contracts,
      group,
    })
  }
  return { protocols, problems }
}

/**
 * Reads every group file in `dir` and checks the whole list: each file on
 * its own, then that no protocol id or (chain, address) appears twice.
 * Throws a {@link UniverseError} listing every problem.
 */
export function loadUniverse(dir: string): UniverseProtocol[] {
  const problems: string[] = []
  const protocols: UniverseProtocol[] = []
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
  for (const file of files) {
    const group = file.replace(/\.json$/, "")
    let value: unknown
    try {
      value = JSON.parse(readFileSync(join(dir, file), "utf8"))
    } catch (error) {
      problems.push(
        `${file}: ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }
    const parsed = parseGroup(group, value)
    problems.push(...parsed.problems)
    protocols.push(...parsed.protocols)
  }
  const ids = new Set<string>()
  const deployments = new Map<string, string>()
  for (const protocol of protocols) {
    if (ids.has(protocol.protocol))
      problems.push(`${protocol.group}:${protocol.protocol}: listed twice`)
    ids.add(protocol.protocol)
    for (const contract of protocol.contracts) {
      const key = deploymentKey(contract.chainId, contract.address)
      const other = deployments.get(key)
      if (other)
        problems.push(`${protocol.protocol}: ${key} is also listed by ${other}`)
      deployments.set(key, protocol.protocol)
    }
  }
  if (problems.length > 0) throw new UniverseError(problems)
  return protocols
}

/** `chainId:address`, lowercase: the one key for a deployment. */
export function deploymentKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`
}
