#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { ChainAccess } from "../src/chains.js"
import { dataPaths, stableJson } from "./data.js"
import { diagnose } from "./diag.js"
import { fetchAll, fetchDefiLlama } from "./fetch.js"
import { loadRegistrySnapshot } from "./registry.js"
import { buildReport, readDraftSummaries } from "./report.js"
import { loadUniverse } from "./universe.js"

/**
 * The coverage tracker's command line. Built by `pnpm tracker:build` into
 * tracker/dist/; run as `node tracker/dist/tracker/cli.js <command>`.
 *
 *   validate   check tracker/contracts/*.json
 *   diag       print which public data sources answer (network)
 *   fetch      read on-chain facts and real transactions (network)
 *   report     score each contract against a registry clone: coverage.json
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
