// Prints the source Sourcify has verified at each deployment of a
// descriptor: the contract's name, compiler and match, and, when the address
// is a proxy, the same for each implementation Sourcify resolves it to (read
// from the chain at request time), with a digest of its source files. Where
// the deployments of one descriptor do not run the same source, it prints how
// each file differs from the first deployment's, so screens written from one
// deployment's code can be checked against the others. Network.
//
//   node submissions/tools/verified-sources.mjs <descriptor.json>... [--files] [--print <name>]...
//
// --files lists every source file with its sha256. --print <name> prints the
// text of the first deployment's source files named <name> (a file name, or
// the end of a path): the code the screens describe, when the protocol's own
// repository is not what is deployed. A difference is reported, not a
// failure; exit status 1 only when Sourcify has no answer for a deployment.

import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, relative, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { parseArgs } from "node:util"

const SOURCIFY = process.env.SOURCIFY_URL ?? "https://sourcify.dev/server"

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    files: { type: "boolean" },
    print: { type: "string", multiple: true },
  },
})
if (positionals.length === 0) {
  console.error(
    "usage: verified-sources.mjs <descriptor.json>... [--files] [--print <name>]..."
  )
  process.exit(2)
}
const printNames = values.print ?? []

// One verified contract, asked again twice, 5 and then 15 seconds later, when
// Sourcify answers 429 or 5xx, or not at all. Undefined when it has none.
async function verified(chainId, address) {
  const url = `${SOURCIFY}/v2/contract/${chainId}/${address}?fields=sources,compilation,proxyResolution`
  let last
  for (const wait of [0, 5_000, 15_000]) {
    if (wait > 0) await sleep(wait)
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      })
      if (response.status === 404) return undefined
      if (response.ok) return await response.json()
      last = new Error(`HTTP ${response.status}`)
      if (response.status !== 429 && response.status < 500) break
    } catch (error) {
      last = error
    }
  }
  throw new Error(`Sourcify, ${chainId}:${address}: ${last.message}`)
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex")

function sourcesOf(contract) {
  const out = new Map()
  for (const [path, source] of Object.entries(contract.sources ?? {}))
    out.set(path, typeof source === "string" ? source : (source?.content ?? ""))
  return out
}

/**
 * The contracts a deployment runs: the one at its address and, through each
 * proxy Sourcify resolves, its implementations.
 */
async function unitsOf(chainId, address) {
  const units = []
  const seen = new Set()
  const pending = [{ address, role: "at the address" }]
  while (pending.length) {
    const next = pending.shift()
    if (seen.has(next.address.toLowerCase())) continue
    seen.add(next.address.toLowerCase())
    const contract = await verified(chainId, next.address)
    if (!contract) {
      units.push({ ...next, missing: true })
      continue
    }
    const sources = sourcesOf(contract)
    const files = new Map([...sources].map(([p, text]) => [p, sha256(text)]))
    const digest = sha256(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([p, h]) => `${p}\0${h}\n`)
        .join("")
    )
    const proxy = contract.proxyResolution
    units.push({
      ...next,
      name: contract.compilation?.name ?? "?",
      target: contract.compilation?.fullyQualifiedName?.split(":")[0],
      compiler: contract.compilation?.compilerVersion ?? "?",
      match: contract.match ?? contract.runtimeMatch ?? "?",
      proxy: proxy?.isProxy
        ? `${proxy.proxyType ?? "a proxy"} to ${(proxy.implementations ?? []).map((i) => i.address).join(", ")}`
        : undefined,
      sources,
      files,
      digest,
    })
    if (proxy?.isProxy)
      for (const implementation of proxy.implementations ?? [])
        pending.push({
          address: implementation.address,
          role: `implementation of ${next.address}`,
        })
  }
  return units
}

// The file of `other` that is `path` of the first deployment: the same path,
// else the only file with the same name.
function counterpart(path, other) {
  if (other.has(path)) return path
  const named = [...other.keys()].filter((p) => basename(p) === basename(path))
  return named.length === 1 ? named[0] : undefined
}

function diff(a, b, labelA, labelB) {
  const work = mkdtempSync(join(tmpdir(), "verified-sources-"))
  try {
    const fileA = join(work, "a")
    const fileB = join(work, "b")
    writeFileSync(fileA, a)
    writeFileSync(fileB, b)
    try {
      execFileSync(
        "diff",
        ["-u", "--label", labelA, "--label", labelB, fileA, fileB],
        { encoding: "utf8" }
      )
      return ""
    } catch (error) {
      if (error.status === 1) return error.stdout
      throw error
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function describe(unit) {
  if (unit.missing) return `${unit.address} (${unit.role}): not verified`
  return [
    `${unit.address} (${unit.role}): ${unit.name}, ${unit.match}, compiler ${unit.compiler}`,
    unit.proxy ? `, ${unit.proxy}` : "",
    `; ${unit.files.size} source ${unit.files.size === 1 ? "file" : "files"}, digest ${unit.digest.slice(0, 16)}`,
  ].join("")
}

let unreadable = 0
for (const path of positionals) {
  const descriptor = JSON.parse(readFileSync(path, "utf8"))
  const deployments = descriptor.context?.contract?.deployments ?? []
  console.log(`\n## ${relative(process.cwd(), resolve(path))}`)
  const read = []
  for (const { chainId, address } of deployments) {
    try {
      const units = await unitsOf(chainId, address)
      read.push({ chainId, address, units })
      console.log(`\n### chain ${chainId}, ${address}`)
      for (const unit of units) {
        console.log(`- ${describe(unit)}`)
        if (values.files && !unit.missing)
          for (const [p, hash] of [...unit.files].sort(([a], [b]) =>
            a.localeCompare(b)
          ))
            console.log(`  - ${p} ${hash.slice(0, 12)}`)
      }
    } catch (error) {
      unreadable++
      console.log(`\n### chain ${chainId}, ${address}\n- ❌ ${error.message}`)
    }
  }
  if (read.length === 0) continue

  // Deployments that run the same contracts, by digest, in the order read:
  // the contract at the address, then its implementations.
  const groups = new Map()
  for (const deployment of read) {
    const key = deployment.units
      .map((u) => (u.missing ? "unverified" : u.digest))
      .join("/")
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(deployment)
  }
  const [[, firstGroup], ...otherGroups] = [...groups]
  const first = firstGroup[0]
  const chains = (group) =>
    `${group.length === 1 ? "chain" : "chains"} ${group.map((d) => d.chainId).join(", ")}`
  console.log(
    read.every((d) => d.units.every((u) => u.missing))
      ? "\nSourcify has verified none of them."
      : groups.size === 1
        ? "\nEvery deployment runs the same source."
        : `\n${groups.size} different sources: ${[...groups.values()].map(chains).join("; ")}.`
  )

  // How each other source differs from the first deployment's.
  for (const [, group] of otherGroups) {
    const other = group[0]
    const where = `chain ${other.chainId}`
    const changes = []
    const count = Math.max(first.units.length, other.units.length)
    for (let i = 0; i < count; i++) {
      const base = first.units[i]
      const unit = other.units[i]
      if (!base || !unit) {
        changes.push(
          `- ${(unit ?? base).role}: only on chain ${(unit ? other : first).chainId}`
        )
        continue
      }
      if (base.missing || unit.missing) {
        if (base.missing !== unit.missing)
          changes.push(
            `- ${unit.role}: verified on chain ${(base.missing ? other : first).chainId} only`
          )
        continue
      }
      if (base.digest === unit.digest) continue
      if (base.name !== unit.name)
        changes.push(`- ${unit.role}: ${unit.name}, not ${base.name}`)
      const matched = new Set()
      for (const [p, text] of base.sources) {
        const q = counterpart(p, unit.sources)
        if (!q) {
          changes.push(`- ${unit.role}: no ${p}`)
          continue
        }
        matched.add(q)
        if (base.files.get(p) !== unit.files.get(q))
          changes.push(
            diff(
              text,
              unit.sources.get(q),
              `chain ${first.chainId} ${p}`,
              `${where} ${q}`
            ).trimEnd()
          )
      }
      for (const q of unit.sources.keys())
        if (!matched.has(q)) changes.push(`- ${unit.role}: also ${q}`)
    }
    console.log(
      `\n### ${chains(group)} against chain ${first.chainId}\n${changes.length ? changes.join("\n") : "- the same files, under other paths"}`
    )
  }

  for (const name of printNames)
    for (const unit of first.units)
      for (const [p, text] of unit.sources ?? [])
        if (p === name || p.endsWith(`/${name}`))
          console.log(
            `\n### ${p}, chain ${first.chainId}, ${unit.address}\n\n${text.trimEnd()}\n\n### end of ${p}`
          )
}
process.exit(unreadable ? 1 : 0)
