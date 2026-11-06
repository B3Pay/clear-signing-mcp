import { toFunctionSelector, type Abi, type AbiFunction } from "viem"
import type { ChainClient } from "@ethereum-sourcify/clear-signing"
import {
  dataPaths,
  readJson,
  type AbiFile,
  type OnchainRecord,
} from "./data.js"
import {
  deploymentsOn,
  descriptorFacts,
  REGISTRY_REPO,
  type DescriptorFacts,
  type RegistrySnapshot,
} from "./registry.js"
import type {
  ChainId,
  Contract,
  CoverageReport,
  CoverageStatus,
  Protocol,
  Totals,
} from "./report-schema.js"
import {
  TRACKED_CHAINS,
  type Category,
  type UniverseContract,
  type UniverseProtocol,
} from "./universe.js"

/**
 * Builds coverage.json, the tracker's public data: for each tracked
 * contract, whether the registry describes it, what share of its recent
 * transactions that description formats, and whether B3Pay has a tested
 * draft. Only facts with a named source go in; a missing fact stays null.
 */

/** A descriptor that formats at least this share of recent calls is "covered". */
export const COVERED_SHARE = 0.95

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  dex: "DEXs",
  aggregator: "Aggregators",
  bridge: "Bridges",
  lending: "Lending",
  cdp: "CDPs",
  stablecoin: "Stablecoins",
  "liquid-staking": "Liquid staking",
  restaking: "Restaking",
  yield: "Yield",
  derivatives: "Derivatives",
  nft: "NFTs",
  identity: "Identity",
  social: "Social",
  infrastructure: "Infrastructure",
  rwa: "Real-world assets",
  launchpad: "Launchpads",
  payments: "Payments",
  gaming: "Gaming",
}

const EXPLORERS: Readonly<Record<ChainId, string>> = {
  1: "https://etherscan.io",
  8453: "https://basescan.org",
  42161: "https://arbiscan.io",
  10: "https://optimistic.etherscan.io",
}

export function explorerAddress(chainId: ChainId, address: string): string {
  return `${EXPLORERS[chainId]}/address/${address}`
}

export function explorerTx(chainId: ChainId, hash: string): string {
  return `${EXPLORERS[chainId]}/tx/${hash}`
}

/** What the draft step leaves for the report, per deployment. */
export interface DraftSummary {
  readonly functions: number
  readonly testedTxs: number
  readonly lint: "pass" | "warnings"
  readonly preview?: {
    readonly txHash: string
    readonly intent: string
    readonly fields: readonly { label: string; value: string }[]
  }
}

export interface ReportInput {
  readonly universe: readonly UniverseProtocol[]
  readonly dataDir: string
  readonly registry: RegistrySnapshot
  /** Drafts that passed validation, by `chainId:address` (lowercase). */
  readonly drafts?: ReadonlyMap<string, DraftSummary>
  /** Show draft previews (Behrad's choice: yes, without the descriptor itself). */
  readonly previews: boolean
  readonly mainnet?: ChainClient
  readonly now?: Date
  readonly log?: (line: string) => void
}

interface DefiLlamaFile {
  readonly fetchedAt: string
  readonly protocols: readonly {
    slug: string
    parent: string | null
    tvl: Readonly<Record<string, number>>
  }[]
}

function writableFunctions(abi: Abi): AbiFunction[] {
  return abi.filter(
    (item): item is AbiFunction =>
      item.type === "function" &&
      item.stateMutability !== "view" &&
      item.stateMutability !== "pure"
  )
}

function signatureOf(fn: AbiFunction): string {
  const type = (input: AbiFunction["inputs"][number]): string => {
    if (input.type.startsWith("tuple")) {
      const components =
        "components" in input && input.components
          ? input.components.map((c) => type(c)).join(",")
          : ""
      return `(${components})${input.type.slice("tuple".length)}`
    }
    return input.type
  }
  return `${fn.name}(${fn.inputs.map(type).join(",")})`
}

function tvlOf(
  file: DefiLlamaFile | undefined,
  slug: string | undefined
): number | null {
  if (!file || !slug) return null
  const sum = (tvl: Readonly<Record<string, number>>) =>
    Object.entries(tvl)
      .filter(([chain]) => chain in TRACKED_CHAINS)
      .reduce((acc, [, value]) => acc + value, 0)
  const direct = file.protocols.find((p) => p.slug === slug)
  if (direct) return sum(direct.tvl)
  const children = file.protocols.filter((p) => p.parent === `parent#${slug}`)
  if (children.length === 0) return null
  return children.reduce((acc, child) => acc + sum(child.tvl), 0)
}

/**
 * "covered" when the descriptor formats at least COVERED_SHARE of what users
 * call: measured by distinct senders per function when the sample has them,
 * else by transactions, else (no recent calls) by the ABI's state-changing
 * functions. A descriptor whose reach cannot be measured at all is "partial".
 */
export function statusOf(
  descriptor: DescriptorFacts | null,
  measures: {
    readonly signerShare: number | null
    readonly txShare: number | null
    readonly abiShare: number | null
  }
): CoverageStatus {
  if (!descriptor) return "uncovered"
  const share = measures.signerShare ?? measures.txShare ?? measures.abiShare
  if (share === null) return "partial"
  return share >= COVERED_SHARE ? "covered" : "partial"
}

function emptyTotals(): {
  contracts: number
  covered: number
  partial: number
  uncovered: number
  drafts: number
  weighted: number
  weight: number
  signerWeighted: number
  signerWeight: number
  perDay: number
} {
  return {
    contracts: 0,
    covered: 0,
    partial: 0,
    uncovered: 0,
    drafts: 0,
    weighted: 0,
    weight: 0,
    signerWeighted: 0,
    signerWeight: 0,
    perDay: 0,
  }
}

type Accumulator = ReturnType<typeof emptyTotals>

function add(acc: Accumulator, contract: Contract): void {
  acc.contracts += 1
  acc[contract.status] += 1
  if (contract.draft) acc.drafts += 1
  const perDay = contract.sample?.perDay ?? null
  const share = contract.sample?.txShareCovered ?? null
  const signerShare = contract.sample?.signerShareCovered ?? null
  if (perDay !== null) acc.perDay += perDay
  if (perDay !== null && share !== null && perDay > 0) {
    acc.weighted += perDay * share
    acc.weight += perDay
  }
  if (perDay !== null && signerShare !== null && perDay > 0) {
    acc.signerWeighted += perDay * signerShare
    acc.signerWeight += perDay
  }
}

function finish(acc: Accumulator): Totals {
  return {
    contracts: acc.contracts,
    covered: acc.covered,
    partial: acc.partial,
    uncovered: acc.uncovered,
    drafts: acc.drafts,
    txShareCovered: acc.weight > 0 ? round(acc.weighted / acc.weight, 4) : null,
    signerShareCovered:
      acc.signerWeight > 0
        ? round(acc.signerWeighted / acc.signerWeight, 4)
        : null,
    perDay: round(acc.perDay, 1),
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function buildReport(input: ReportInput): Promise<CoverageReport> {
  const paths = dataPaths(input.dataDir)
  const defillama = readJson<DefiLlamaFile>(paths.defillama)
  const fetchedAt: number[] = []
  const protocols: Protocol[] = []

  const overall = emptyTotals()
  const chains = new Map<ChainId, Accumulator>(
    Object.keys(TRACKED_CHAINS).map((id) => [
      Number(id) as ChainId,
      emptyTotals(),
    ])
  )
  const categories = new Map<string, Accumulator>()

  for (const protocol of input.universe) {
    const acc = emptyTotals()
    const contracts: Contract[] = []
    for (const entry of protocol.contracts) {
      const contract = await buildContract(protocol, entry, input, fetchedAt)
      contracts.push(contract)
      add(acc, contract)
      add(overall, contract)
      add(chains.get(contract.chainId)!, contract)
      const category = categories.get(protocol.category) ?? emptyTotals()
      add(category, contract)
      categories.set(protocol.category, category)
    }
    contracts.sort(
      (a, b) => (b.sample?.perDay ?? -1) - (a.sample?.perDay ?? -1)
    )
    const totals = finish(acc)
    protocols.push({
      id: protocol.protocol,
      name: protocol.name,
      category: protocol.category,
      categoryLabel: CATEGORY_LABELS[protocol.category],
      website: protocol.website,
      tvlUsd: (() => {
        const tvl = tvlOf(defillama, protocol.defillama)
        return tvl === null ? null : Math.round(tvl)
      })(),
      status:
        totals.covered === totals.contracts
          ? "covered"
          : totals.uncovered === totals.contracts
            ? "uncovered"
            : "partial",
      totals,
      contracts,
    })
  }
  protocols.sort(
    (a, b) => b.totals.perDay - a.totals.perDay || a.name.localeCompare(b.name)
  )

  const now = input.now ?? new Date()
  return {
    version: 1,
    generatedAt: now.toISOString(),
    registry: {
      repo: REGISTRY_REPO,
      commit: input.registry.commit,
      committedAt: input.registry.committedAt,
      deploymentsOnTrackedChains: deploymentsOn(
        input.registry,
        Object.keys(TRACKED_CHAINS).map(Number)
      ),
    },
    sources: {
      onchain: {
        oldest: new Date(
          fetchedAt.length ? Math.min(...fetchedAt) : now.getTime()
        ).toISOString(),
        newest: new Date(
          fetchedAt.length ? Math.max(...fetchedAt) : now.getTime()
        ).toISOString(),
      },
      ...(defillama ? { defillama: defillama.fetchedAt } : {}),
    },
    totals: { ...finish(overall), protocols: protocols.length },
    chains: Object.fromEntries(
      [...chains.entries()].map(([id, acc]) => [
        String(id),
        { ...finish(acc), name: TRACKED_CHAINS[id] },
      ])
    ) as CoverageReport["chains"],
    categories: Object.fromEntries(
      [...categories.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, acc]) => [
          id,
          { ...finish(acc), label: CATEGORY_LABELS[id as Category] },
        ])
    ),
    protocols,
  }
}

async function buildContract(
  protocol: UniverseProtocol,
  entry: UniverseContract,
  input: ReportInput,
  fetchedAt: number[]
): Promise<Contract> {
  const paths = dataPaths(input.dataDir)
  const chainId = entry.chainId
  const onchain = readJson<OnchainRecord>(paths.onchain(chainId, entry.address))
  const abiFile = readJson<AbiFile>(paths.abi(chainId, entry.address))
  if (onchain) fetchedAt.push(Date.parse(onchain.fetchedAt))

  let descriptor: DescriptorFacts | null = null
  try {
    descriptor = await descriptorFacts(input.registry, chainId, entry.address, {
      ...(input.mainnet ? { mainnet: input.mainnet } : {}),
    })
  } catch (error) {
    input.log?.(
      `${protocol.protocol} ${chainId}:${entry.address}: ${error instanceof Error ? error.message : String(error)}`
    )
  }

  const bySelector = new Map<string, AbiFunction>()
  if (abiFile)
    for (const fn of abiFile.abi.filter(
      (i): i is AbiFunction => i.type === "function"
    ))
      bySelector.set(toFunctionSelector(fn).toLowerCase(), fn)
  const writable = abiFile ? writableFunctions(abiFile.abi) : null
  const formatted = descriptor?.selectors ?? new Set<string>()

  const sample = onchain && !("error" in onchain.sample) ? onchain.sample : null
  const calldataCounts = sample
    ? Object.entries(sample.selectors).filter(([selector]) => selector !== "0x")
    : []
  const calldataTotal = calldataCounts.reduce((acc, [, n]) => acc + n, 0)
  const coveredCount = calldataCounts
    .filter(([selector]) => formatted.has(selector))
    .reduce((acc, [, n]) => acc + n, 0)
  const share =
    calldataTotal > 0 ? round(coveredCount / calldataTotal, 4) : null
  // Each sender counted once per function it called, so a bot that sends
  // hundreds of the same call weighs as much as one person.
  const senderCounts = sample?.sendersBySelector
    ? Object.entries(sample.sendersBySelector).filter(
        ([selector]) => selector !== "0x"
      )
    : []
  const senderTotal = senderCounts.reduce((acc, [, n]) => acc + n, 0)
  const signerShare =
    senderTotal > 0
      ? round(
          senderCounts
            .filter(([selector]) => formatted.has(selector))
            .reduce((acc, [, n]) => acc + n, 0) / senderTotal,
          4
        )
      : null

  const sourcify =
    onchain?.sourcify.status === "verified"
      ? onchain.sourcify.match
      : onchain?.sourcify.status === "not_verified"
        ? "not_verified"
        : "unknown"

  const key = `${chainId}:${entry.address.toLowerCase()}`
  const draft = descriptor ? undefined : input.drafts?.get(key)

  return {
    chainId,
    address: entry.address,
    name: entry.name,
    label: entry.label,
    role: entry.role,
    ...(entry.version ? { version: entry.version } : {}),
    status: statusOf(descriptor, {
      signerShare,
      txShare: share,
      abiShare:
        writable && writable.length > 0
          ? writable.filter((fn) =>
              formatted.has(toFunctionSelector(fn).toLowerCase())
            ).length / writable.length
          : null,
    }),
    addressSource: entry.source,
    explorerUrl: explorerAddress(chainId, entry.address),
    sourcify,
    descriptor: descriptor
      ? {
          path: descriptor.path,
          url: descriptor.url,
          owner: descriptor.owner,
          formats: descriptor.selectors.size,
          attestation:
            descriptor.attestation === "attested"
              ? "verified"
              : descriptor.attestation === "no_file" ||
                  descriptor.attestation === "not_attested"
                ? "none"
                : "unverified",
        }
      : null,
    functions: writable
      ? {
          writable: writable.length,
          formatted: writable.filter((fn) =>
            formatted.has(toFunctionSelector(fn).toLowerCase())
          ).length,
        }
      : null,
    sample: sample
      ? {
          count: sample.count,
          perDay: sample.perDay === null ? null : round(sample.perDay, 2),
          oldest: new Date((sample.oldest ?? 0) * 1000).toISOString(),
          newest: new Date((sample.newest ?? 0) * 1000).toISOString(),
          txShareCovered: share,
          signerShareCovered: signerShare,
        }
      : null,
    topFunctions: calldataCounts
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([selector, count]) => {
        const fn = bySelector.get(selector)
        return {
          selector,
          signature: fn ? signatureOf(fn) : null,
          share: round(count / calldataTotal, 4),
          senders: sample?.sendersBySelector?.[selector] ?? null,
          formatted: formatted.has(selector),
        }
      }),
    draft: draft
      ? {
          functions: draft.functions,
          testedTxs: draft.testedTxs,
          lint: draft.lint,
          ...(input.previews && draft.preview
            ? { preview: draft.preview }
            : {}),
        }
      : null,
  }
}
