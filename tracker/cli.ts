#!/usr/bin/env node
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { dataPaths } from "./data.js"
import { diagnose } from "./diag.js"
import { fetchAll, fetchDefiLlama } from "./fetch.js"
import { loadUniverse } from "./universe.js"

/**
 * The coverage tracker's command line. Built by `pnpm tracker:build` into
 * tracker/dist/; run as `node tracker/dist/tracker/cli.js <command>`.
 *
 *   validate   check tracker/contracts/*.json
 *   fetch      read on-chain facts and real transactions (network)
 */

const here = dirname(fileURLToPath(import.meta.url))
// tracker/dist/tracker/cli.js -> tracker/
const trackerDir = resolve(here, "..", "..")

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      only: { type: "string" },
      "max-age-hours": { type: "string", default: "0" },
      "sample-size": { type: "string", default: "1000" },
      "skip-defillama": { type: "boolean", default: false },
    },
  })
  const command = positionals[0]
  const contractsDir = join(trackerDir, "contracts")
  const dataDir = join(trackerDir, "data")

  if (command === "validate") {
    const universe = loadUniverse(contractsDir)
    const contracts = universe.reduce((n, p) => n + p.contracts.length, 0)
    console.log(`${universe.length} protocols, ${contracts} contracts: valid`)
    return 0
  }

  if (command === "diag") {
    await diagnose((line) => console.log(line))
    return 0
  }

  if (command === "fetch") {
    const universe = loadUniverse(contractsDir)
    const only = values.only?.split(",").map((s) => s.trim())
    const result = await fetchAll(universe, {
      dataDir,
      maxAgeMs: Number(values["max-age-hours"]) * 3_600_000,
      sampleSize: Number(values["sample-size"]),
      perSelector: 2,
      selectorsKept: 16,
      ...(only ? { only: (protocol) => only.includes(protocol.protocol) } : {}),
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
      `fetched ${result.fetched}, skipped ${result.skipped}, problems ${result.problems.length}`
    )
    for (const problem of result.problems) console.log(`PROBLEM ${problem}`)
    return 0
  }

  console.error(
    "usage: cli.js validate | fetch [--only p1,p2] [--max-age-hours N] [--sample-size N]"
  )
  return 2
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
)
