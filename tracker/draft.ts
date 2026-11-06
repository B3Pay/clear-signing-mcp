import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  getAddress,
  toFunctionSelector,
  type Abi,
  type AbiFunction,
} from "viem"
import {
  draftDescriptor,
  type DraftChain,
  type DraftRegistry,
  type DraftResult,
  type RenderedDisplay,
} from "../src/draft/index.js"
import {
  dataPaths,
  readJson,
  stableJson,
  type AbiFile,
  type OnchainRecord,
  type SamplesFile,
  type TokensFile,
} from "./data.js"
import { cleanText } from "../src/text.js"
import { elsewhereShare, type DraftSummary } from "./report.js"
import type { CoverageReport } from "./report-schema.js"
import { deploymentKey, loadUniverse } from "./universe.js"

/**
 * The draft step: one tracked contract's ERC-7730 descriptor, its testsv2
 * file and a review note, drafted from tracker data alone (the ABI, the real
 * transactions and the token list the fetch step wrote) into
 * tracker/drafts/<protocol>/. Validation is a separate step (validate.ts);
 * tracker/drafts/summary.json lists only the drafts that passed it.
 */

/** Selectors a draft describes by default: the most called, up to this many. */
export const MAX_SELECTORS = 12
/** ...until they make up this share of the sampled calls. */
export const SAMPLE_SHARE = 0.99

const PROTOCOL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/

export interface DraftOptions {
  /** The tracker directory: contracts/, data/ and drafts/ are under it. */
  readonly trackerDir: string
  readonly chainId: number
  readonly address: string
  /** Required when the contract is not in tracker/contracts/; else it must match. */
  readonly protocol?: string
  readonly owner: string
  /** Default: the protocol's website in tracker/contracts/. */
  readonly url?: string
  readonly legalName?: string
  /** Default: the contract's name in tracker/contracts/, else the ABI's. */
  readonly contractName?: string
  /** Default: the most called selectors of the sample (see SAMPLE_SHARE). */
  readonly selectors?: readonly string[]
  /** A chainid.network chains_mini.json; default: a cached download. */
  readonly chainsFile?: string
  /**
   * The same contract on other chains, listed in the descriptor's
   * deployments. Each must have an ABI in tracker data with every function
   * the draft describes; the tests use this deployment's transactions.
   */
  readonly extraDeployments?: readonly {
    readonly chainId: number
    readonly address: string
  }[]
  /**
   * A registry clone (registry.ts's draftRegistry): a call a `calldata`
   * field carries then renders through the clone's descriptor for the
   * contract it calls, as check-drafts' test runner renders it.
   */
  readonly registry?: DraftRegistry
  readonly log?: (line: string) => void
}

export interface DraftOutcome {
  readonly protocol: string
  readonly descriptorPath: string
  readonly testsPath: string
  readonly reviewPath: string
  readonly result: DraftResult
}

export async function draftContract(
  options: DraftOptions
): Promise<DraftOutcome> {
  const log = options.log ?? (() => {})
  const address = getAddress(options.address)
  const dataDir = join(options.trackerDir, "data")
  const paths = dataPaths(dataDir)
  const need = <T>(path: string, what: string): T => {
    const value = readJson<T>(path)
    if (value === undefined)
      throw new Error(
        `No ${what} for ${options.chainId}:${address} at ${path}: run the fetch step first.`
      )
    return value
  }
  const abiFile = need<AbiFile>(paths.abi(options.chainId, address), "ABI")
  const samplesFile = need<SamplesFile>(
    paths.samples(options.chainId, address),
    "transaction sample"
  )
  const onchain = need<OnchainRecord>(
    paths.onchain(options.chainId, address),
    "on-chain record"
  )
  const tokens = readJson<TokensFile>(paths.tokens(options.chainId)) ?? {}

  const listed = findListed(options.trackerDir, options.chainId, address)
  const protocol = options.protocol ?? listed?.protocol
  if (!protocol)
    throw new Error(
      `${options.chainId}:${address} is not in tracker/contracts/: name its protocol with --protocol.`
    )
  if (!PROTOCOL_ID.test(protocol))
    throw new Error(
      `"${protocol}" is not a protocol id (lowercase words joined by "-").`
    )
  if (listed && listed.protocol !== protocol)
    throw new Error(
      `${options.chainId}:${address} is listed under "${listed.protocol}", not "${protocol}".`
    )
  const contractName =
    options.contractName ?? listed?.name ?? abiFile.name ?? onchain.abi?.name
  if (!contractName)
    throw new Error(
      `No contract name for ${options.chainId}:${address}: give one with --name.`
    )
  const url = options.url ?? listed?.website

  const selection = options.selectors
    ? {
        selectors: [...options.selectors],
        lines: ["Selectors given on the command line."],
      }
    : chooseSelectors(onchain, samplesFile, abiFile.abi)
  if (selection.selectors.length === 0)
    throw new Error(
      `No selector of ${options.chainId}:${address} has a sample transaction to test it with.`
    )

  const extraDeployments = (options.extraDeployments ?? []).filter((d) => {
    const other = readJson<AbiFile>(paths.abi(d.chainId, d.address))
    const has = new Set(
      (other?.abi ?? []).flatMap((item) =>
        item.type === "function" ? [toFunctionSelector(item).toLowerCase()] : []
      )
    )
    const missing = selection.selectors.filter((sel) => !has.has(sel))
    if (missing.length > 0)
      log(
        `left out ${d.chainId}:${d.address}: its ABI lacks ${missing.join(", ")}`
      )
    return missing.length === 0
  })

  const chainList = await loadChainList(options.chainsFile, log)
  const result = await draftDescriptor({
    ...(extraDeployments.length > 0
      ? {
          extraDeployments: extraDeployments.map((d) => ({
            chainId: d.chainId,
            address: getAddress(d.address),
          })),
        }
      : {}),
    chainId: options.chainId,
    address,
    abi: abiFile.abi,
    contractName,
    owner: options.owner,
    ...(options.legalName ? { legalName: options.legalName } : {}),
    ...(url ? { url } : {}),
    selectors: selection.selectors,
    samples: samplesFile.txs,
    tokens,
    chains: chainList.chains,
    ...(options.registry ? { registry: options.registry } : {}),
  })

  const dir = join(options.trackerDir, "drafts", protocol)
  const descriptorPath = join(dir, result.fileName)
  const testsPath = join(
    dir,
    "testsv2",
    result.fileName.replace(/\.json$/, ".tests.json")
  )
  const reviewPath = join(dir, result.fileName.replace(/\.json$/, ".review.md"))
  writeText(descriptorPath, `${JSON.stringify(result.descriptor, null, 2)}\n`)
  writeText(testsPath, `${JSON.stringify(result.tests, null, 2)}\n`)
  writeText(
    reviewPath,
    reviewMarkdown({
      protocol,
      address,
      chainId: options.chainId,
      abiFile,
      onchain,
      selection,
      chainList,
      result,
    })
  )
  // The new draft has not been validated: a summary entry from an older one goes.
  writeSummary(join(options.trackerDir, "drafts"))
  log(`wrote ${descriptorPath}`)
  log(`wrote ${testsPath} (${result.tests.tests.length} tests)`)
  log(`wrote ${reviewPath} (${result.review.length} review notes)`)
  return { protocol, descriptorPath, testsPath, reviewPath, result }
}

function findListed(
  trackerDir: string,
  chainId: number,
  address: string
): { protocol: string; name: string; website: string } | undefined {
  const key = deploymentKey(chainId, address)
  for (const protocol of loadUniverse(join(trackerDir, "contracts")))
    for (const contract of protocol.contracts)
      if (deploymentKey(contract.chainId, contract.address) === key)
        return {
          protocol: protocol.protocol,
          name: contract.name,
          website: protocol.website,
        }
  return undefined
}

export interface SelectorChoice {
  readonly selectors: string[]
  /** What the choice was, line by line, for the review note. */
  readonly lines: string[]
}

/**
 * The most called selectors of the sample, until they make up SAMPLE_SHARE
 * of it or MAX_SELECTORS are chosen. "Most called" is measured as the report
 * measures coverage: by distinct senders per function when the sample counts
 * them (a bot that sends hundreds of one call weighs as one sender), else by
 * transactions; plain transfers are left out. A selector the ABI does not
 * have, or with no transaction in the sample to test it with, is skipped.
 */
export function chooseSelectors(
  onchain: OnchainRecord,
  samples: SamplesFile,
  abi: Abi
): SelectorChoice {
  if ("error" in onchain.sample)
    return {
      selectors: [],
      lines: [`The sample failed: ${onchain.sample.error}`],
    }
  const calls = onchain.sample.selectors
  // Absent in records written before the fetch step counted senders.
  const senders = onchain.sample.sendersBySelector as
    Readonly<Record<string, number>> | undefined
  const bySenders = senders !== undefined && Object.keys(senders).length > 0
  const unit = bySenders ? "senders" : "calls"
  const weight = (selector: string) =>
    (bySenders ? senders[selector] : calls[selector]) ?? 0
  const all = [
    ...new Set([...Object.keys(calls), ...Object.keys(senders ?? {})]),
  ].filter((selector) => selector !== "0x")
  const total = all.reduce((acc, selector) => acc + weight(selector), 0)
  const inAbi = new Map<string, AbiFunction>()
  for (const item of abi)
    if (item.type === "function") inAbi.set(toFunctionSelector(item), item)
  const sampled = new Set(
    samples.txs.map((tx) => tx.input.slice(0, 10).toLowerCase())
  )
  const ranked = all.sort(
    (a, b) =>
      weight(b) - weight(a) ||
      (calls[b] ?? 0) - (calls[a] ?? 0) ||
      (a < b ? -1 : 1)
  )
  const selectors: string[] = []
  const lines: string[] = []
  let covered = 0
  for (const selector of ranked) {
    if (selectors.length >= MAX_SELECTORS || covered >= SAMPLE_SHARE * total)
      break
    const count = weight(selector)
    const what = `${bySenders ? `${count} senders, ` : ""}${calls[selector] ?? 0} calls, ${((count / total) * 100).toFixed(1)}% of ${unit}`
    const fn = inAbi.get(selector.toLowerCase())
    if (!fn) {
      lines.push(`Skipped ${selector} (${what}): not a function of the ABI.`)
      continue
    }
    if (!sampled.has(selector.toLowerCase())) {
      lines.push(
        `Skipped ${selector} ${fn.name} (${what}): no transaction in the sample to test it with.`
      )
      continue
    }
    selectors.push(selector.toLowerCase())
    covered += count
    lines.push(`${selector} ${fn.name}: ${what}.`)
  }
  if (calls["0x"])
    lines.push(
      `${calls["0x"]} plain transfers (no calldata) in the sample are left out.`
    )
  lines.push(
    `The draft describes ${selectors.length} function(s): ${total === 0 ? "n/a" : `${((covered / total) * 100).toFixed(1)}%`} of the sample's ${total} ${bySenders ? "senders per function called" : "calls with calldata"}.`
  )
  return { selectors, lines }
}

// ---------------------------------------------------------------------------
// The chain list: chain names and native currencies, as the registry's test
// runner reads them from chainid.network. The draft renders its tests with
// it, and validation serves the same file to the runner.

export const CHAIN_LIST_URLS = [
  "https://chainid.network/chains_mini.json",
  // The repository chainid.network is built from.
  "https://raw.githubusercontent.com/ethereum-lists/chains/gh-pages/chains_mini.json",
] as const

const CHAIN_LIST_MAX_AGE_MS = 7 * 24 * 3_600_000

export interface ChainList {
  readonly file: string
  readonly source: string
  readonly sha256: string
  readonly chains: Readonly<Record<string, DraftChain>>
}

export function defaultChainListFile(): string {
  return join(tmpdir(), "clear-signing-drafts", "chains_mini.json")
}

/** The chain list at `file`, else a download cached for a week. */
export async function loadChainList(
  file?: string,
  log: (line: string) => void = () => {}
): Promise<ChainList> {
  const path = file ?? defaultChainListFile()
  if (
    !file &&
    (!existsSync(path) ||
      Date.now() - statSync(path).mtimeMs > CHAIN_LIST_MAX_AGE_MS)
  )
    await downloadChainList(path, log)
  if (!existsSync(path)) throw new Error(`No chain list at ${path}.`)
  const bytes = readFileSync(path)
  const raw: unknown = JSON.parse(bytes.toString("utf8"))
  if (!Array.isArray(raw))
    throw new Error(`${path} is not a chainid.network chain list.`)
  const chains: Record<string, DraftChain> = {}
  // As the runner reads it: an entry without a name or a native currency is
  // skipped, a later one wins, and the native currency is taken as it is.
  for (const entry of raw as unknown[]) {
    if (entry === null || typeof entry !== "object") continue
    const { chainId, name, nativeCurrency } = entry as Record<string, unknown>
    if (!name || !nativeCurrency) continue
    chains[String(chainId)] = {
      name: name as string,
      nativeCurrency: nativeCurrency as DraftChain["nativeCurrency"],
    }
  }
  const sourceFile = `${path}.source`
  return {
    file: path,
    source: existsSync(sourceFile)
      ? readFileSync(sourceFile, "utf8").trim()
      : path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    chains,
  }
}

async function downloadChainList(
  path: string,
  log: (line: string) => void
): Promise<void> {
  const failures: string[] = []
  for (const url of CHAIN_LIST_URLS) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      const parsed: unknown = JSON.parse(text)
      if (!Array.isArray(parsed) || parsed.length < 100)
        throw new Error("not a chain list")
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, text)
      writeFileSync(`${path}.source`, `${url}\n`)
      log(`chain list: ${parsed.length} chains from ${url}`)
      return
    } catch (error) {
      failures.push(
        `${url}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
  throw new Error(`Could not download the chain list:\n${failures.join("\n")}`)
}

// ---------------------------------------------------------------------------
// The review note and the summary the report reads.

function reviewMarkdown(input: {
  protocol: string
  address: string
  chainId: number
  abiFile: AbiFile
  onchain: OnchainRecord
  selection: SelectorChoice
  chainList: ChainList
  result: DraftResult
}): string {
  const { result } = input
  const testsFile = `testsv2/${result.fileName.replace(/\.json$/, ".tests.json")}`
  const formats = Object.entries(result.descriptor.display.formats)
  const lines = [
    `# Draft: ${result.descriptor.metadata.contractName ?? result.fileName} on chain ${input.chainId}`,
    "",
    "Written by the draft engine from the contract's ABI and real transactions, with no person in the loop. Read every note below, and check every label, hidden field and intent, before the draft goes to the registry.",
    "",
    `- Deployment: ${input.chainId}:${input.address}`,
    `- Protocol: ${input.protocol}`,
    `- Owner: ${result.descriptor.metadata.owner}${result.descriptor.metadata.info ? `, ${result.descriptor.metadata.info.url}` : ""}`,
    `- ABI: ${input.abiFile.source}, ${input.abiFile.name ?? "unnamed"} at ${input.abiFile.address}`,
    `- Descriptor: ${result.fileName}; tests: ${testsFile} (${result.tests.tests.length})`,
    `- Chain names: ${input.chainList.source} (sha256 ${input.chainList.sha256})`,
    "",
    "## Functions",
    "",
    ...input.selection.lines.map((line) => `- ${line}`),
    "",
    ...formats.map(
      ([key, format]) =>
        `- \`${key}\`: ${format.intent}${format.interpolatedIntent ? ` ("${format.interpolatedIntent}")` : ""}`
    ),
    "",
    "## Review notes",
    "",
    ...(result.review.length > 0
      ? result.review.map((note) => `- ${note}`)
      : ["- None."]),
    "",
  ]
  return lines.join("\n")
}

/** What validate.ts writes next to a draft: calldata-<Name>.validation.json. */
export interface ValidationFile {
  readonly descriptor: string
  readonly tests: string
  readonly descriptorSha256: string
  readonly testsSha256: string
  readonly passed: boolean
  readonly checks: {
    readonly lint: { readonly status: "pass" | "warnings" | "fail" }
    readonly tests: { readonly status: string; readonly passed: number }
  } & Readonly<Record<string, { readonly status: string }>>
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex")
}

/**
 * Rewrites tracker/drafts/summary.json: the drafts whose validation passed,
 * and whose descriptor and tests are still the files it checked, keyed by
 * `chainId:address` for each of their deployments.
 */
export function writeSummary(draftsDir: string): Record<string, DraftSummary> {
  const out: Record<string, DraftSummary> = {}
  if (existsSync(draftsDir)) {
    for (const protocol of readdirSync(draftsDir).sort()) {
      const dir = join(draftsDir, protocol)
      if (!statSync(dir).isDirectory()) continue
      for (const name of readdirSync(dir).sort()) {
        if (!name.endsWith(".validation.json")) continue
        const validation = readJson<ValidationFile>(join(dir, name))
        if (!validation?.passed) continue
        const descriptorPath = join(dir, validation.descriptor)
        const testsPath = join(dir, validation.tests)
        if (!existsSync(descriptorPath) || !existsSync(testsPath)) continue
        if (sha256File(descriptorPath) !== validation.descriptorSha256) continue
        if (sha256File(testsPath) !== validation.testsSha256) continue
        const lint = validation.checks.lint.status
        if (lint === "fail") continue
        const descriptor = readJson<DraftResult["descriptor"]>(descriptorPath)
        const tests = readJson<DraftResult["tests"]>(testsPath)
        if (!descriptor || !tests) continue
        const first = choosePreview(tests.tests)
        const formats = Object.keys(descriptor.display.formats)
        const functions = formats.length
        const testedTxs = validation.checks.tests.passed
        if (functions < 1 || testedTxs < 1) continue
        const summary: DraftSummary = {
          functions,
          selectors: formats.map((format) => selectorOfFormat(format)).sort(),
          testedTxs,
          lint,
          ...(first
            ? {
                preview: {
                  txHash: first.txHash,
                  intent: publicText(
                    first.expected.interpolatedIntent ?? first.expected.intent
                  ),
                  fields: flatFields(first.expected).map(
                    ({ label, value }) => ({
                      label: publicText(label),
                      value: publicText(value),
                    })
                  ),
                },
              }
            : {}),
        }
        for (const d of descriptor.context.contract.deployments)
          out[deploymentKey(d.chainId, d.address)] = summary
      }
    }
  }
  writeText(join(draftsDir, "summary.json"), stableJson(out))
  return out
}

/**
 * The test shown on the public page: the one that reads best, counting a raw
 * number where an amount belongs, a zero date, long raw bytes, and above all
 * text a token contract chose that looks like a link or a message (a token's
 * symbol is whatever its deployer wrote). A sentence beats none; ties go to
 * the function users call most, which comes first.
 */
export function choosePreview<T extends { readonly expected: RenderedDisplay }>(
  tests: readonly T[]
): T | undefined {
  let best: { test: T; score: number } | undefined
  tests.forEach((test, index) => {
    const display = test.expected
    const texts = [
      display.interpolatedIntent ?? display.intent,
      ...flatFields(display).map((f) => f.value),
    ]
    let score = display.interpolatedIntent ? 0 : 1_000
    for (const text of texts) {
      if (/https?:|www\.|\.(?:com|xyz|io|net|org|app|co|me|link)\b/i.test(text))
        score += 10_000
      if (/\b\d{16,}\b/.test(text)) score += 100
      if (/1970-01-01/.test(text)) score += 100
      if (/0x[0-9a-fA-F]{65,}/.test(text)) score += 10
    }
    for (const field of flatFields(display)) {
      // "1.5 USDC": the symbol after an amount is the token's own text.
      const symbol = /^[\d.,]+\s+(.+)$/.exec(field.value)?.[1]
      if (symbol !== undefined && !/^[A-Za-z0-9.$+_-]{1,16}$/.test(symbol))
        score += 10_000
    }
    score += index
    if (!best || score < best.score) best = { test, score }
  })
  // Text that reads like a link or a message is never shown.
  return best && best.score < 10_000 ? best.test : undefined
}

/** A `display.formats` key's 4-byte selector: the key itself, or its signature's. */
function selectorOfFormat(format: string): string {
  return /^0x[0-9a-fA-F]{8}$/.test(format)
    ? format.toLowerCase()
    : toFunctionSelector(`function ${format}`).toLowerCase()
}

/** Text from a render, made inert and short for the public page. */
function publicText(value: string): string {
  return cleanText(value, 120).text
}

function flatFields(
  display: RenderedDisplay
): { label: string; value: string }[] {
  return display.fields.map((field) => ({
    label: field.label,
    value:
      typeof field.value === "string"
        ? field.value
        : (field.value.interpolatedIntent ?? field.value.intent),
  }))
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export interface DraftTopOptions {
  readonly trackerDir: string
  /** How many contracts to draft: the busiest without a registry descriptor. */
  readonly limit: number
  /** Only drafts for these protocols. */
  readonly protocols?: readonly string[]
  readonly chainsFile?: string
  /** A registry clone for every draft (see DraftOptions). */
  readonly registry?: DraftRegistry
  readonly log?: (line: string) => void
}

/** One contract to draft: its busiest deployment, and the same contract elsewhere. */
export interface DraftCandidate {
  readonly protocol: string
  readonly owner: string
  readonly name: string
  readonly primary: { readonly chainId: number; readonly address: string }
  readonly others: readonly {
    readonly chainId: number
    readonly address: string
  }[]
  /** Estimated distinct senders a day, summed over the deployments. */
  readonly sendersPerDay: number
}

/**
 * A contract whose recent calls the registry's descriptor for another
 * deployment already formats at least this share of is not drafted: adding
 * the deployment to that descriptor, and any function it lacks, is the
 * better change.
 */
export const ELSEWHERE_SKIP_SHARE = 0.5

/**
 * The contracts most worth a draft, from the report (data/coverage.json):
 * those the registry has no descriptor for, and no descriptor elsewhere that
 * formats most of their calls (ELSEWHERE_SKIP_SHARE), ranked by an estimate of how
 * many distinct senders call them a day (each deployment's senders per
 * sampled transaction, times its transactions a day). Deployments of one
 * protocol's contract under the same name on several chains are one
 * candidate, drafted as one descriptor, as the registry lists them.
 */
export function draftCandidates(trackerDir: string): DraftCandidate[] {
  const dataDir = join(trackerDir, "data")
  const paths = dataPaths(dataDir)
  const report = readJson<CoverageReport>(join(dataDir, "coverage.json"))
  if (!report)
    throw new Error(
      `No report at ${join(dataDir, "coverage.json")}: run the report step first.`
    )
  const groups = new Map<string, DraftCandidate & { best: number }>()
  for (const protocol of report.protocols)
    for (const contract of protocol.contracts) {
      if (contract.status !== "uncovered" || !contract.sample) continue
      if (elsewhereShare(contract.elsewhere) >= ELSEWHERE_SKIP_SHARE) continue
      const onchain = readJson<OnchainRecord>(
        paths.onchain(contract.chainId, contract.address)
      )
      if (!onchain || "error" in onchain.sample || !onchain.abi) continue
      const sample = onchain.sample
      if (sample.count === 0 || sample.perDay === null) continue
      const rate = (sample.senders / sample.count) * sample.perDay
      const key = `${protocol.id}/${contract.name}`
      const here = { chainId: contract.chainId, address: contract.address }
      const group = groups.get(key)
      if (!group) {
        groups.set(key, {
          protocol: protocol.id,
          owner: protocol.name,
          name: contract.name,
          primary: here,
          others: [],
          sendersPerDay: rate,
          best: rate,
        })
        continue
      }
      const busier = rate > group.best
      groups.set(key, {
        ...group,
        primary: busier ? here : group.primary,
        others: [...group.others, busier ? group.primary : here],
        sendersPerDay: group.sendersPerDay + rate,
        best: Math.max(group.best, rate),
      })
    }
  return [...groups.values()]
    .map(({ best: _best, ...candidate }) => candidate)
    .sort(
      (a, b) =>
        b.sendersPerDay - a.sendersPerDay ||
        a.protocol.localeCompare(b.protocol) ||
        a.name.localeCompare(b.name)
    )
}

/** Drafts the `limit` best candidates; one that cannot be drafted is logged and skipped. */
export async function draftTop(
  options: DraftTopOptions
): Promise<{ drafted: DraftOutcome[]; failed: string[] }> {
  const log = options.log ?? (() => {})
  const candidates = draftCandidates(options.trackerDir).filter(
    (c) => !options.protocols || options.protocols.includes(c.protocol)
  )
  const drafted: DraftOutcome[] = []
  const failed: string[] = []
  for (const candidate of candidates.slice(0, options.limit)) {
    const where = `${candidate.protocol} ${candidate.name} ${candidate.primary.chainId}:${candidate.primary.address}`
    log(
      `drafting ${where} (+${candidate.others.length} deployments, about ${Math.round(candidate.sendersPerDay)} senders a day)`
    )
    try {
      drafted.push(
        await draftContract({
          trackerDir: options.trackerDir,
          chainId: candidate.primary.chainId,
          address: candidate.primary.address,
          protocol: candidate.protocol,
          owner: candidate.owner,
          extraDeployments: candidate.others,
          ...(options.chainsFile ? { chainsFile: options.chainsFile } : {}),
          ...(options.registry ? { registry: options.registry } : {}),
          log,
        })
      )
    } catch (error) {
      const message = `${where}: ${error instanceof Error ? error.message : String(error)}`
      failed.push(message)
      log(`FAILED ${message}`)
    }
  }
  return { drafted, failed }
}
