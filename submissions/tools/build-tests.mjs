// Builds a registry test file (testsv2) for one descriptor under
// submissions/registry/ from real transactions: each case names a chain and a
// transaction hash, the transaction comes from the tracker's samples
// (tracker/data/samples, read from the chain by the Tracker fetch workflow),
// and is rebuilt unsigned the way the draft engine does it. The expected text
// is what the registry's pinned Sourcify runner renders, so read every
// rendering this prints before you keep it: a test only records what the
// descriptor shows, it does not prove that what it shows is right.
//
// Usage (after `pnpm tracker:build`):
//
//   node submissions/tools/build-tests.mjs <cases.json> \
//     --registry <clone of the registry> --runner <built test runner> \
//     --chains <chains_mini.json>
//
// <cases.json> (submissions/cases/<entity>/<descriptor>.cases.json):
//
//   { "descriptor": "calldata-X.json", "keep": false,
//     "tests": [{ "description": "...", "chainId": 1, "txHash": "0x..." }] }
//
// "keep": true keeps the test cases already in the registry's file for that
// descriptor (a change to an existing descriptor). Tokens for the data
// provider are every token the tracker knows on the case's chain whose
// address is the transaction's target or a word of its calldata.

import { execFileSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { unsignedRawTx } = await import(
  join(repo, "tracker", "dist", "src", "draft", "rawtx.js")
)

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    registry: { type: "string" },
    runner: { type: "string" },
    chains: { type: "string" },
  },
})
if (positionals.length !== 1 || !values.registry || !values.runner) {
  console.error(
    "usage: build-tests.mjs <cases.json> --registry <dir> --runner <dir> [--chains <chains_mini.json>]"
  )
  process.exit(2)
}

const casesPath = resolve(positionals[0])
const entity = basename(dirname(casesPath))
const spec = JSON.parse(readFileSync(casesPath, "utf8"))
const name = spec.descriptor.replace(/\.json$/, "")
const submissionDir = join(repo, "submissions", "registry", entity)
const descriptorPath = join(submissionDir, spec.descriptor)
if (!existsSync(descriptorPath))
  throw new Error(`No descriptor at ${descriptorPath}`)
const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"))

// Every sampled transaction, by hash.
const samples = new Map()
const samplesDir = join(repo, "tracker", "data", "samples")
for (const chain of readdirSync(samplesDir))
  for (const file of readdirSync(join(samplesDir, chain))) {
    const data = JSON.parse(readFileSync(join(samplesDir, chain, file), "utf8"))
    for (const tx of data.txs) samples.set(tx.hash.toLowerCase(), tx)
  }

const tokensByChain = new Map()
function tokensOf(chainId) {
  if (!tokensByChain.has(chainId)) {
    const path = join(repo, "tracker", "data", "tokens", `${chainId}.json`)
    tokensByChain.set(
      chainId,
      existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
    )
  }
  return tokensByChain.get(chainId)
}

/** Token addresses a call can name: its target and every 20-byte word. */
function addressesIn(tx) {
  const out = new Set([tx.to.toLowerCase()])
  const body = tx.input.slice(10)
  for (let i = 0; i + 64 <= body.length; i += 64) {
    const word = body.slice(i, i + 64)
    if (/^0{24}[0-9a-f]{40}$/i.test(word))
      out.add(`0x${word.slice(24).toLowerCase()}`)
  }
  return out
}

const deployments = new Set(
  descriptor.context.contract.deployments.map(
    (d) => `${d.chainId}:${d.address.toLowerCase()}`
  )
)
const tokens = {}
const built = []
for (const c of spec.tests) {
  const tx = samples.get(c.txHash.toLowerCase())
  if (!tx)
    throw new Error(`${c.description}: ${c.txHash} is not in the samples`)
  if (tx.chainId !== c.chainId)
    throw new Error(`${c.description}: ${c.txHash} is on chain ${tx.chainId}`)
  if (tx.status !== "success")
    throw new Error(`${c.description}: ${c.txHash} did not succeed`)
  if (!deployments.has(`${tx.chainId}:${tx.to.toLowerCase()}`))
    throw new Error(
      `${c.description}: ${tx.to} on ${tx.chainId} is not a deployment of ${spec.descriptor}`
    )
  const raw = unsignedRawTx(tx)
  if ("skip" in raw) throw new Error(`${c.description}: ${raw.skip}`)
  const known = tokensOf(tx.chainId)
  for (const address of addressesIn(tx))
    if (known[address]) {
      const { symbol, decimals, name: tokenName } = known[address]
      tokens[address] = { symbol, decimals, name: tokenName }
    }
  built.push({ description: c.description, rawTx: raw.rawTx, txHash: tx.hash })
}

const testsName = `${name}.tests.json`
const existingPath = join(submissionDir, "testsv2", testsName)
const registryTests = join(
  values.registry,
  "registry",
  entity,
  "testsv2",
  testsName
)
const kept = spec.keep
  ? JSON.parse(
      readFileSync(
        existsSync(existingPath) ? existingPath : registryTests,
        "utf8"
      )
    )
  : undefined
const keptTests = (kept?.tests ?? []).filter(
  (t) => !built.some((b) => b.description === t.description)
)
const dataProvider = {
  ...kept?.dataProvider,
  tokens: { ...kept?.dataProvider?.tokens, ...sortKeys(tokens) },
}

// Render with the pinned runner, in a copy of the registry with the
// submissions laid over it.
const work = mkdtempSync(join(tmpdir(), "submission-tests-"))
try {
  const root = join(work, "registry")
  cpSync(values.registry, root, {
    recursive: true,
    filter: (src) => ![".git", "node_modules"].includes(basename(src)),
  })
  cpSync(join(repo, "submissions", "registry"), join(root, "registry"), {
    recursive: true,
  })
  const placeholder = { intent: "", owner: "", fields: [] }
  const draftTests = {
    $schema: "../../../specs/erc7730-tests-v2.schema.json",
    descriptor: `../${spec.descriptor}`,
    dataProvider,
    tests: built.map((b) => ({ ...b, expected: placeholder })),
  }
  const testsFile = join(root, "registry", entity, "testsv2", testsName)
  mkdirSync(dirname(testsFile), { recursive: true })
  writeFileSync(testsFile, JSON.stringify(draftTests, null, 2))
  const shim = join(work, "chain-list-shim.mjs")
  writeFileSync(
    shim,
    [
      'import { readFileSync } from "node:fs"',
      'const url = "https://chainid.network/chains_mini.json"',
      "const real = globalThis.fetch",
      "globalThis.fetch = async (input, init) => {",
      '  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url',
      "  if (target === url && process.env.CHAIN_INFO_FILE)",
      '    return new Response(readFileSync(process.env.CHAIN_INFO_FILE), { status: 200, headers: { "content-type": "application/json" } })',
      "  return real(input, init)",
      "}",
      "",
    ].join("\n")
  )
  const results = join(work, "results.json")
  execFileSync(
    process.execPath,
    [
      "--import",
      `file://${shim}`,
      join(values.runner, "dist", "cli.js"),
      testsFile,
      "-o",
      results,
    ],
    {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
      env: { ...process.env, CHAIN_INFO_FILE: values.chains ?? "" },
    }
  )
  const report = JSON.parse(readFileSync(results, "utf8"))
  const rendered = new Map(report.cases.map((c) => [c.description, c.rendered]))
  const tests = [
    ...keptTests,
    ...built.map((b) => {
      const r = rendered.get(b.description)
      if (!r) throw new Error(`${b.description}: the runner rendered nothing`)
      const expected = {
        intent: r.intent,
        ...(r.interpolatedIntent !== undefined
          ? { interpolatedIntent: r.interpolatedIntent }
          : {}),
        owner: r.owner,
        fields: r.fields,
      }
      return { ...b, expected }
    }),
  ]
  const out = {
    $schema: "../../../specs/erc7730-tests-v2.schema.json",
    descriptor: `../${spec.descriptor}`,
    dataProvider,
    tests,
  }
  mkdirSync(dirname(existingPath), { recursive: true })
  writeFileSync(existingPath, `${JSON.stringify(out, null, 2)}\n`)
  for (const t of tests.slice(keptTests.length)) {
    console.log(`\n${t.description}  (${t.txHash})`)
    console.log(
      `  ${t.expected.intent}${t.expected.interpolatedIntent ? `  |  ${t.expected.interpolatedIntent}` : ""}  [${t.expected.owner}]`
    )
    for (const f of t.expected.fields)
      console.log(
        `  - ${f.label}: ${typeof f.value === "string" ? f.value : JSON.stringify(f.value)}`
      )
  }
  console.log(
    `\nwrote ${existingPath} (${tests.length} tests, ${keptTests.length} kept)`
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}

function sortKeys(object) {
  return Object.fromEntries(
    Object.entries(object).sort(([a], [b]) => a.localeCompare(b))
  )
}
