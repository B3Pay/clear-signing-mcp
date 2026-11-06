import {
  getAddress,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
} from "viem"
import type { ChainClient } from "@ethereum-sourcify/clear-signing"
import { isRecord } from "./net.js"
import {
  dataPaths,
  readJson,
  type AbiFile,
  type OnchainRecord,
  type SampleSummary,
} from "./data.js"
import { caip10 } from "../src/registry.js"
import {
  chainsByAddress,
  deploymentsOn,
  describedFunctions,
  descriptorFacts,
  REGISTRY_REPO,
  type DescribedFunctions,
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

/**
 * The draft step's summary file: tested drafts by `chainId:address`
 * (lowercase). A missing file means no drafts; a malformed entry is an error,
 * so a broken summary never shows as fewer drafts.
 */
export function readDraftSummaries(
  path: string
): ReadonlyMap<string, DraftSummary> {
  const file = readJson<unknown>(path)
  const out = new Map<string, DraftSummary>()
  if (file === undefined) return out
  if (!isRecord(file)) throw new Error(`${path} is not an object`)
  for (const [key, value] of Object.entries(file)) {
    if (!/^\d+:0x[0-9a-f]{40}$/.test(key))
      throw new Error(`${path}: "${key}" is not chainId:address in lowercase`)
    const fail = (why: string) => new Error(`${path} ${key}: ${why}`)
    if (!isRecord(value)) throw fail("not an object")
    const { functions, testedTxs, lint, preview } = value
    if (!Number.isInteger(functions) || (functions as number) < 1)
      throw fail("functions must be a positive integer")
    if (!Number.isInteger(testedTxs) || (testedTxs as number) < 1)
      throw fail("testedTxs must be a positive integer")
    if (lint !== "pass" && lint !== "warnings")
      throw fail('lint must be "pass" or "warnings"')
    let parsedPreview: DraftSummary["preview"]
    if (preview !== undefined) {
      if (
        !isRecord(preview) ||
        typeof preview.txHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(preview.txHash) ||
        typeof preview.intent !== "string" ||
        !Array.isArray(preview.fields) ||
        !preview.fields.every(
          (field) =>
            isRecord(field) &&
            typeof field.label === "string" &&
            typeof field.value === "string"
        )
      )
        throw fail("preview must be {txHash, intent, fields: [{label, value}]}")
      parsedPreview = {
        txHash: preview.txHash,
        intent: preview.intent,
        fields: (preview.fields as { label: string; value: string }[]).map(
          ({ label, value }) => ({ label, value })
        ),
      }
    }
    out.set(key, {
      functions: functions as number,
      testedTxs: testedTxs as number,
      lint,
      ...(parsedPreview ? { preview: parsedPreview } : {}),
    })
  }
  return out
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
 * The span a sample shows: its oldest and newest transaction; with none, the
 * span the scan read every transaction of, or else the time it was read.
 */
export function sampleSpan(
  sample: Pick<SampleSummary, "oldest" | "newest" | "covered">,
  fetchedAt: string
): { oldest: string; newest: string } {
  const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
  if (sample.oldest !== null && sample.newest !== null)
    return { oldest: iso(sample.oldest), newest: iso(sample.newest) }
  if (sample.covered)
    return {
      oldest: iso(sample.covered.since),
      newest: iso(sample.covered.until),
    }
  const at = new Date(fetchedAt).toISOString()
  return { oldest: at, newest: at }
}

/** A label without a trailing "(Base)": the page shows the chain beside it. */
export function withoutChain(label: string, chainId: ChainId): string {
  const suffix = ` (${TRACKED_CHAINS[chainId]})`
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label
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

/**
 * The share of `counts` (calls, or senders, by selector) whose selector is in
 * `formatted`; null when there is nothing to count. Plain transfers ("0x")
 * are left out.
 */
export function shareOf(
  counts: Readonly<Record<string, number>> | undefined,
  formatted: ReadonlySet<string>
): number | null {
  if (!counts) return null
  let total = 0
  let covered = 0
  for (const [selector, n] of Object.entries(counts)) {
    if (selector === "0x") continue
    total += n
    if (formatted.has(selector)) covered += n
  }
  return total > 0 ? round(covered / total, 4) : null
}

/**
 * Chains a descriptor elsewhere may be named on: the tracked four and other
 * mainnets the registry lists deployments on. A deployment on a chain not
 * named here (a testnet, say) is not offered as "described elsewhere".
 */
export const CHAIN_NAMES: Readonly<Record<number, string>> = {
  ...TRACKED_CHAINS,
  56: "BNB Smart Chain",
  100: "Gnosis",
  130: "Unichain",
  137: "Polygon",
  146: "Sonic",
  324: "ZKsync Era",
  480: "World Chain",
  1868: "Soneium",
  5000: "Mantle",
  34443: "Mode",
  42220: "Celo",
  43114: "Avalanche C-Chain",
  57073: "Ink",
  59144: "Linea",
  81457: "Blast",
  534352: "Scroll",
}

/** A deployment the registry describes, offered for an uncovered contract. */
export interface ElsewhereCandidate {
  readonly described: DescribedFunctions
  /** The described deployment's label, when it is tracked; else this contract's. */
  readonly label: string
}

export type Elsewhere = NonNullable<Contract["elsewhere"]>

/** How much of a contract's recent calls a descriptor elsewhere formats: by senders, else by transactions; 0 when none. */
export function elsewhereShare(
  elsewhere: Elsewhere | null | undefined
): number {
  return elsewhere
    ? (elsewhere.signerShareCovered ?? elsewhere.txShareCovered ?? 0)
    : 0
}

/**
 * For a contract the registry has no descriptor for: of the descriptors it
 * has for other deployments (the same address on another chain, or another
 * contract of the same protocol), the one that formats the most of this
 * contract's recent calls. A descriptor qualifies only when every function
 * it formats is in this contract's ABI; without an ABI, only the same
 * address on another chain qualifies. Measured like the contract's own
 * share: by senders, else by transactions. Null when none formats any
 * recent call.
 */
export function bestElsewhere(
  address: string,
  abiSelectors: ReadonlySet<string> | null,
  sample: {
    readonly selectors: Readonly<Record<string, number>>
    readonly sendersBySelector?: Readonly<Record<string, number>>
  },
  candidates: readonly ElsewhereCandidate[]
): Elsewhere | null {
  const own = address.toLowerCase()
  let best: { elsewhere: Elsewhere; score: number } | null = null
  for (const { described, label } of candidates) {
    const chainName = CHAIN_NAMES[described.chainId]
    if (!chainName) continue
    const sameAddress = described.address === own
    if (abiSelectors) {
      if (![...described.selectors].every((s) => abiSelectors.has(s))) continue
    } else if (!sameAddress) continue
    const txShareCovered = shareOf(sample.selectors, described.selectors)
    const signerShareCovered = shareOf(
      sample.sendersBySelector,
      described.selectors
    )
    const score = signerShareCovered ?? txShareCovered ?? 0
    if (score <= 0) continue
    const better =
      !best ||
      score > best.score ||
      (score === best.score &&
        (Number(sameAddress) - Number(best.elsewhere.sameAddress) ||
          Number(described.chainId in TRACKED_CHAINS) -
            Number(best.elsewhere.chainId in TRACKED_CHAINS) ||
          best.elsewhere.chainId - described.chainId) > 0)
    if (!better) continue
    best = {
      score,
      elsewhere: {
        chainId: described.chainId,
        chainName,
        address: getAddress(described.address),
        label,
        sameAddress,
        path: described.path,
        url: described.url,
        txShareCovered,
        signerShareCovered,
      },
    }
  }
  return best?.elsewhere ?? null
}

/** The registry's descriptors for deployments other than `entry`'s that may describe it. */
async function elsewhereCandidates(
  protocol: UniverseProtocol,
  entry: UniverseContract,
  context: ReportContext
): Promise<ElsewhereCandidate[]> {
  const address = entry.address.toLowerCase()
  const wanted = new Map<
    string,
    { chainId: number; address: string; label: string }
  >()
  for (const chainId of context.chainsByAddress.get(address) ?? [])
    if (chainId !== entry.chainId)
      wanted.set(`${chainId}:${address}`, {
        chainId,
        address,
        label: withoutChain(entry.label, entry.chainId),
      })
  for (const sibling of protocol.contracts) {
    const siblingAddress = sibling.address.toLowerCase()
    if (sibling.chainId === entry.chainId && siblingAddress === address)
      continue
    if (
      !context.registry.index.calldataIndex[
        caip10(sibling.chainId, siblingAddress)
      ]
    )
      continue
    wanted.set(`${sibling.chainId}:${siblingAddress}`, {
      chainId: sibling.chainId,
      address: siblingAddress,
      label: withoutChain(sibling.label, sibling.chainId),
    })
  }
  const out: ElsewhereCandidate[] = []
  for (const [key, want] of wanted) {
    let pending = context.described.get(key)
    if (!pending) {
      pending = describedFunctions(context.registry, want.chainId, want.address)
      context.described.set(key, pending)
    }
    try {
      const described = await pending
      if (described) out.push({ described, label: want.label })
    } catch (error) {
      context.log?.(
        `${protocol.protocol} ${key}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  return out
}

/** What every contract of one report shares: the registry's lookups, done once. */
interface ReportContext {
  readonly registry: RegistrySnapshot
  readonly chainsByAddress: ReadonlyMap<string, readonly number[]>
  readonly described: Map<string, Promise<DescribedFunctions | null>>
  readonly log?: (line: string) => void
}

function emptyTotals(): {
  contracts: number
  covered: number
  partial: number
  uncovered: number
  drafts: number
  describedElsewhere: number
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
    describedElsewhere: 0,
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
  if (elsewhereShare(contract.elsewhere) >= COVERED_SHARE)
    acc.describedElsewhere += 1
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
    describedElsewhere: acc.describedElsewhere,
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
  const context: ReportContext = {
    registry: input.registry,
    chainsByAddress: chainsByAddress(input.registry),
    described: new Map(),
    ...(input.log ? { log: input.log } : {}),
  }

  for (const protocol of input.universe) {
    const acc = emptyTotals()
    const contracts: Contract[] = []
    for (const entry of protocol.contracts) {
      const contract = await buildContract(
        protocol,
        entry,
        input,
        context,
        fetchedAt
      )
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
  context: ReportContext,
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
  const span = onchain && sample ? sampleSpan(sample, onchain.fetchedAt) : null
  const calldataCounts = sample
    ? Object.entries(sample.selectors).filter(([selector]) => selector !== "0x")
    : []
  const calldataTotal = calldataCounts.reduce((acc, [, n]) => acc + n, 0)
  const share = shareOf(sample?.selectors, formatted)
  // Each sender counted once per function it called, so a bot that sends
  // hundreds of the same call weighs as much as one person.
  const signerShare = shareOf(sample?.sendersBySelector, formatted)
  // Only for a deployment the index does not list: one whose descriptor
  // failed to resolve is logged above, not offered a stand-in.
  const listed = Boolean(
    input.registry.index.calldataIndex[caip10(chainId, entry.address)]
  )
  const elsewhere =
    listed || !sample
      ? null
      : bestElsewhere(
          entry.address,
          abiFile ? new Set(bySelector.keys()) : null,
          sample,
          await elsewhereCandidates(protocol, entry, context)
        )

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
    label: withoutChain(entry.label, chainId),
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
    sample:
      sample && span
        ? {
            count: sample.count,
            perDay: sample.perDay === null ? null : round(sample.perDay, 2),
            ...span,
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
    elsewhere,
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
