// Decides whether the registry's linter passed the submitted descriptors,
// from what `erc7730 lint --require-verified --gha` printed and its exit
// status. The registry's linter fails a deployment whose code Sourcify has
// not verified. A deployment listed in submissions/UNVERIFIED is one that
// waits for its owner to verify it there: its "not verified" error, and no
// other error, is let through, and reported as waiting. When the linter
// passes and a listed deployment no longer has that error, it is reported as
// verified, to be removed from the list. check.sh runs this; it reads no
// network.
//
//   node submissions/tools/lint-verdict.mjs <lint log> <exit status> [--unverified <file>]
//
// Prints one JSON object, { pass, errors, waiting, verified }: errors are the
// linter's errors that fail the check, waiting and verified are the listed
// deployments, as "<chainId>:<address> <descriptor>".

import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { unverified: { type: "string" } },
})
if (positionals.length !== 2) {
  console.error(
    "usage: lint-verdict.mjs <lint log> <exit status> [--unverified <file>]"
  )
  process.exit(2)
}
const [logFile, status] = positionals

// submissions/UNVERIFIED: "<chainId>:<address> <descriptor under
// submissions/registry/>" per line; "#" starts a comment.
const listed = new Map()
const listFile = values.unverified ?? join(repo, "submissions", "UNVERIFIED")
for (const line of readFileSync(listFile, "utf8").split("\n")) {
  const text = line.replace(/#.*/, "").trim()
  if (!text) continue
  const match = text.match(/^(\d+):(0x[0-9a-fA-F]{40})\s+(\S+\.json)$/)
  if (!match)
    throw new Error(
      `${listFile}: not "<chainId>:<address> <descriptor>": ${line}`
    )
  const [, chainId, address, descriptor] = match
  const path = join(repo, "submissions", "registry", descriptor)
  if (!existsSync(path))
    throw new Error(
      `${listFile}: ${descriptor} is not under submissions/registry/`
    )
  const deployments =
    JSON.parse(readFileSync(path, "utf8")).context?.contract?.deployments ?? []
  if (
    !deployments.some(
      (d) =>
        String(d.chainId) === chainId &&
        String(d.address).toLowerCase() === address.toLowerCase()
    )
  )
    throw new Error(
      `${listFile}: ${chainId}:${address} is not a deployment of ${descriptor}`
    )
  listed.set(
    `${chainId}:${address.toLowerCase()} ${descriptor}`,
    `${chainId}:${address} ${descriptor}`
  )
}

// The two errors a deployment Sourcify has not verified gets
// (erc7730/lint/v2/lint_validate_display_fields.py, common/client.py).
const UNVERIFIED_TITLES = new Set([
  "Contract not verified",
  "Proxy implementation not verified",
])
const errors = []
const waiting = new Set()
const log = readFileSync(logFile, "utf8")
for (const line of log.split("\n")) {
  const annotation = line.match(/^::error (.*?)::(.*)$/)
  if (!annotation) continue
  const props = Object.fromEntries(
    annotation[1]
      .split(",")
      .filter(Boolean)
      .map((pair) => {
        const at = pair.indexOf("=")
        return [pair.slice(0, at), pair.slice(at + 1)]
      })
  )
  const message = annotation[2].replaceAll("%0A", "\n")
  const deployment = message.match(
    /^contract (0x[0-9a-fA-F]{40}) on chain (\d+) /
  )
  const file = (props.file ?? "").replace(/^(\.\/)?registry\//, "")
  const key =
    deployment && `${deployment[2]}:${deployment[1].toLowerCase()} ${file}`
  if (UNVERIFIED_TITLES.has(props.title) && key && listed.has(key)) {
    waiting.add(key)
  } else {
    errors.push(`${props.file ?? "?"}: ${props.title ?? "error"}: ${message}`)
  }
}
// The linter prints this last line only when it went through every file.
const finished = /checked \d+ v2 descriptor files?/.test(log)
if (!finished)
  errors.push(
    'the linter did not finish: no "checked N v2 descriptor files" line'
  )
if (status !== "0" && errors.length === 0 && waiting.size === 0)
  errors.push(`the linter exited with status ${status} and reported no error`)

// A listed deployment is verified when the linter, having checked every
// file, failed nothing and did not report it: a failure can hide its error,
// as when Sourcify does not answer for it.
const pass = errors.length === 0
console.log(
  JSON.stringify({
    pass,
    errors,
    waiting: [...listed].filter(([k]) => waiting.has(k)).map(([, v]) => v),
    verified: pass
      ? [...listed].filter(([k]) => !waiting.has(k)).map(([, v]) => v)
      : [],
  })
)
