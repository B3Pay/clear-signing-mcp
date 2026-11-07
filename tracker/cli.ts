#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { ChainAccess } from "../src/chains.js"
import type { DraftRegistry } from "../src/draft/index.js"
import { dataPaths, stableJson } from "./data.js"
import { diagnose } from "./diag.js"
import { draftContract, draftTop } from "./draft.js"
import { fetchAll, fetchDefiLlama } from "./fetch.js"
import { draftRegistry, loadRegistrySnapshot } from "./registry.js"
import { buildReport, readDraftSummaries } from "./report.js"
import { loadUniverse } from "./universe.js"
import { validateDrafts } from "./validate.js"

/**
 * The coverage tracker's command line. Built by `pnpm tracker:build` into
 * tracker/dist/; run as `node tracker/dist/tracker/cli.js <command>`.
 *
 *   validate      check tracker/contracts/*.json
 *   diag          print which public data sources answer (network)
 *   fetch         read on-chain facts and real transactions (network)
 *   report        score each contract against a registry clone: coverage.json
 *   draft         draft one contract's descriptor and tests: tracker/drafts/
 *   draft-top     draft the busiest contracts the registry does not describe
 *   check-drafts  check drafts as the registry's CI does: drafts/summary.json
 */

const here = dirname(fileURLToPath(import.meta.url))
// tracker/dist/tracker/cli.js -> tracker/
const trackerDir = resolve(here, "..", "..")
const contractsDir = join(trackerDir, "contracts")
const dataDir = join(trackerDir, "data")

interface Command {
  readonly usage: string
  readonly run: (args: string[]) => Promise<number>
}

const commands: Readonly<Record<string, Command>> = {
  validate: {
    usage: "validate",
    run: () => {
      const universe = loadUniverse(contractsDir)
      const contracts = universe.reduce((n, p) => n + p.contracts.length, 0)
      console.log(`${universe.length} protocols, ${contracts} contracts: valid`)
      return Promise.resolve(0)
    },
  },

  diag: {
    usage: "diag",
    run: async () => {
      await diagnose((line) => console.log(line))
      return 0
    },
  },

  fetch: {
    usage:
      "fetch [--only p1,p2] [--max-age-hours N] [--sample-size N] [--minutes N] [--skip-defillama]",
    run: async (args) => {
      const { values } = parseArgs({
        args,
        options: {
          only: { type: "string" },
          "max-age-hours": { type: "string", default: "0" },
          "sample-size": { type: "string", default: "1000" },
          minutes: { type: "string" },
          "skip-defillama": { type: "boolean", default: false },
        },
      })
      const universe = loadUniverse(contractsDir)
      const only = values.only?.split(",").map((s) => s.trim())
      const result = await fetchAll(universe, {
        dataDir,
        maxAgeMs: Number(values["max-age-hours"]) * 3_600_000,
        sampleSize: Number(values["sample-size"]),
        perSelector: 2,
        selectorsKept: 16,
        ...(only
          ? { only: (protocol) => only.includes(protocol.protocol) }
          : {}),
        ...(values.minutes
          ? { deadline: Date.now() + Number(values.minutes) * 60_000 }
          : {}),
        log: (line) => console.log(line),
      })
      if (!values["skip-defillama"]) {
        try {
          const count = await fetchDefiLlama(dataPaths(dataDir).defillama)
          console.log(`DefiLlama: ${count} protocols on the four chains`)
        } catch (error) {
          result.problems.push(
            `DefiLlama: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
      console.log(
        `fetched ${result.fetched}, skipped ${result.skipped}, deferred ${result.deferred}, problems ${result.problems.length}`
      )
      for (const problem of result.problems) console.log(`PROBLEM ${problem}`)
      return 0
    },
  },

  report: {
    usage:
      "report --registry <clone of the registry> [--out file] [--drafts summary.json] [--no-previews] [--attestations]",
    run: async (args) => {
      const { values } = parseArgs({
        args,
        options: {
          registry: { type: "string" },
          out: { type: "string", default: join(dataDir, "coverage.json") },
          drafts: {
            type: "string",
            default: join(trackerDir, "drafts", "summary.json"),
          },
          "no-previews": { type: "boolean", default: false },
          attestations: { type: "boolean", default: false },
        },
      })
      const registryDir = values.registry ?? process.env.REGISTRY_DIR
      if (!registryDir) {
        console.error(
          "report needs --registry: a git clone of ethereum/clear-signing-erc7730-registry"
        )
        return 2
      }
      const registry = loadRegistrySnapshot(registryDir)
      const universe = loadUniverse(contractsDir)
      // The revocation check of an attestation reads Ethereum mainnet.
      const mainnet = values.attestations
        ? new ChainAccess({
            urls: process.env.RPC_URL_1 ? { 1: process.env.RPC_URL_1 } : {},
            publicFallback: true,
            timeoutMs: 20_000,
          }).chainClient()
        : undefined
      const problems: string[] = []
      const drafts = readDraftSummaries(values.drafts)
      const report = await buildReport({
        universe,
        dataDir,
        registry,
        drafts,
        previews: !values["no-previews"],
        ...(mainnet ? { mainnet } : {}),
        log: (line) => problems.push(line),
      })
      mkdirSync(dirname(values.out), { recursive: true })
      writeFileSync(values.out, stableJson(report))
      const t = report.totals
      console.log(
        `registry ${registry.commit.slice(0, 7)} (${registry.committedAt}): ` +
          `${t.protocols} protocols, ${t.contracts} contracts, ${t.covered} covered, ` +
          `${t.partial} partial, ${t.uncovered} uncovered, ${t.drafts} drafts; ` +
          `share of recent calls formatted: ${t.txShareCovered === null ? "n/a" : `${(t.txShareCovered * 100).toFixed(1)}%`}`
      )
      for (const problem of problems) console.log(`PROBLEM ${problem}`)
      console.log(`wrote ${values.out}`)
      return 0
    },
  },

  draft: {
    usage:
      'draft --chain <id> --address 0x… --owner "<name>" [--protocol <id>] [--url https://…] [--legal-name <name>] [--name <contract>] [--selectors 0x…,0x…] [--chains chains_mini.json] [--registry <clone of the registry>]',
    run: async (args) => {
      const { values } = parseArgs({
        args,
        options: {
          chain: { type: "string" },
          address: { type: "string" },
          owner: { type: "string" },
          protocol: { type: "string" },
          url: { type: "string" },
          "legal-name": { type: "string" },
          name: { type: "string" },
          selectors: { type: "string" },
          chains: { type: "string" },
          registry: { type: "string" },
        },
      })
      const chainId = Number(values.chain)
      if (!Number.isInteger(chainId) || !values.address || !values.owner) {
        console.error("draft needs --chain, --address and --owner")
        return 2
      }
      const registry = registryForDrafts(values.registry)
      await draftContract({
        trackerDir,
        chainId,
        address: values.address,
        owner: values.owner,
        ...(values.protocol ? { protocol: values.protocol } : {}),
        ...(values.url ? { url: values.url } : {}),
        ...(values["legal-name"] ? { legalName: values["legal-name"] } : {}),
        ...(values.name ? { contractName: values.name } : {}),
        ...(values.selectors
          ? { selectors: values.selectors.split(",").map((s) => s.trim()) }
          : {}),
        ...(values.chains ? { chainsFile: values.chains } : {}),
        ...(registry ? { registry } : {}),
        log: (line) => console.log(line),
      })
      return 0
    },
  },

  "draft-top": {
    usage:
      "draft-top [--limit N] [--protocols p1,p2] [--chains chains_mini.json] [--registry <clone of the registry>]",
    run: async (args) => {
      const { values } = parseArgs({
        args,
        options: {
          limit: { type: "string", default: "25" },
          protocols: { type: "string" },
          chains: { type: "string" },
          registry: { type: "string" },
        },
      })
      const registry = registryForDrafts(values.registry)
      const { drafted, failed } = await draftTop({
        trackerDir,
        limit: Number(values.limit),
        ...(values.protocols
          ? { protocols: values.protocols.split(",").map((s) => s.trim()) }
          : {}),
        ...(values.chains ? { chainsFile: values.chains } : {}),
        ...(registry ? { registry } : {}),
        log: (line) => console.log(line),
      })
      console.log(`drafted ${drafted.length}, failed ${failed.length}`)
      return 0
    },
  },

  "check-drafts": {
    usage:
      "check-drafts --registry <clone of the registry> [--protocol <id>] [--draft calldata-X.json] [--runner dir] [--python venv/bin/python] [--chains chains_mini.json]",
    run: async (args) => {
      const { values } = parseArgs({
        args,
        options: {
          registry: { type: "string" },
          protocol: { type: "string" },
          draft: { type: "string" },
          runner: { type: "string" },
          python: { type: "string" },
          chains: { type: "string" },
        },
      })
      const registryDir = values.registry ?? process.env.REGISTRY_DIR
      if (!registryDir) {
        console.error(
          "check-drafts needs --registry: a git clone of ethereum/clear-signing-erc7730-registry"
        )
        return 2
      }
      const results = await validateDrafts({
        trackerDir,
        registryDir,
        ...(values.protocol ? { protocol: values.protocol } : {}),
        ...(values.draft ? { draft: values.draft } : {}),
        ...(values.runner ? { runnerDir: values.runner } : {}),
        ...(values.python ? { python: values.python } : {}),
        ...(values.chains ? { chainsFile: values.chains } : {}),
        log: (line) => console.log(line),
      })
      return results.every((r) => r.validation.passed) ? 0 : 1
    },
  },
}

/**
 * The registry a draft's tests render against, read as check-drafts reads
 * it: --registry, else REGISTRY_DIR; none when neither is given.
 */
function registryForDrafts(
  flag: string | undefined
): DraftRegistry | undefined {
  const dir = flag ?? process.env.REGISTRY_DIR
  if (!dir) return undefined
  const registry = draftRegistry(dir)
  console.log(
    `registry ${registry.descriptorDirectory}: ${Object.keys(registry.index.calldataIndex).length} deployments`
  )
  return registry
}

function usage(): string {
  return `usage:\n${Object.values(commands)
    .map((command) => `  cli.js ${command.usage}`)
    .join("\n")}`
}

async function main(argv: string[]): Promise<number> {
  const [name, ...args] = argv
  const command = name ? commands[name] : undefined
  if (!command) {
    console.error(usage())
    return 2
  }
  return command.run(args)
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
