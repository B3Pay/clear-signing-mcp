// What the mustMatch fields of the submitted descriptors refuse in real
// transactions. A field with "visible": { "mustMatch": [...] } lets a wallet
// clear sign a call only when the field's value is one of those listed; with
// any other value it shows an error instead of the screen. For each
// deployment of each descriptor under submissions/registry/ and each format
// with such a field, it reads the latest successful calls of that function
// from the SQD Network portal, decodes them, and counts the calls the
// descriptor refuses, the values that make it refuse them, and the senders of
// those calls, with how many each sent: a few senders with many calls each
// are likely programs rather than people signing in a wallet. Read-only,
// network; runs in CI. It never fails a run: it measures what a pull request
// text says the descriptor leaves out.
//
//   node submissions/tools/must-match.mjs [--root <dir like submissions/registry>] \
//     [--count 200] [--minutes 2]
//
// --count is the calls read per deployment and function, newest first;
// --minutes bounds the time spent on each, after which it reports what it
// read and the span that covers. It looks back at most 30 days.
//
// Values are compared the way the Sourcify test runner compares them: a
// number with an integer of any width, a string with an address or bytes
// (case aside), a number with bytes by their value ("0x" is 0).

import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { decodeFunctionData, parseAbiItem, toFunctionSelector } from "viem"
import { DATASETS, latestCalls } from "./portal.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    count: { type: "string", default: "200" },
    minutes: { type: "string", default: "2" },
  },
})
const root = resolve(values.root ?? join(repo, "submissions", "registry"))
const COUNT = Number(values.count)
const BUDGET_MS = Number(values.minutes) * 60_000

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const day = (seconds) =>
  new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")
const short = (address) => `${address.slice(0, 6)}…${address.slice(-4)}`
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// The fields of a format with a mustMatch list, with their paths made whole:
// a field inside a group of fields is relative to the group's path.
function mustMatchFields(fields, prefix = "") {
  return (fields ?? []).flatMap((field) => {
    const path =
      field.path === undefined
        ? prefix
        : field.path.startsWith("@.") || prefix === ""
          ? field.path
          : `${prefix}.${field.path}`
    if (Array.isArray(field.fields)) return mustMatchFields(field.fields, path)
    const list = field.visible?.mustMatch
    return Array.isArray(list) ? [{ path, list }] : []
  })
}

// The values a path names in a decoded call: one, or one per element under
// "[]". null when the path is not one this tool reads. A path under "@." is
// the transaction's: its value, chain, target or sender.
function valuesAt(path, fn, args, tx, chainId, address) {
  if (path === "@.value") return [BigInt(tx.value ?? 0)]
  if (path === "@.chainId") return [BigInt(chainId)]
  if (path === "@.to") return [address]
  if (path === "@.from") return [tx.from]
  if (path.startsWith("@.")) return null
  const [name, ...rest] = path.replace(/^#\./, "").split(".")
  const index = fn.inputs.findIndex((input) => input.name === name)
  if (index < 0) return null
  let current = [args[index]]
  for (const segment of rest) {
    const slice = /^\[(-?\d+)\]$/.exec(segment)
    if (segment === "[]") current = current.flatMap((value) => value)
    else if (slice) current = current.map((value) => value.at(Number(slice[1])))
    else current = current.map((value) => value?.[segment])
  }
  return current
}

function matches(value, candidates) {
  return candidates.some((candidate) => {
    if (typeof value === "bigint") {
      try {
        return BigInt(candidate) === value
      } catch {
        return false
      }
    }
    if (typeof value === "boolean") return candidate === value
    if (typeof value !== "string") return false
    if (typeof candidate === "string")
      return candidate.toLowerCase() === value.toLowerCase()
    if (typeof candidate === "number" && value.startsWith("0x"))
      return BigInt(value === "0x" ? 0 : value) === BigInt(candidate)
    return false
  })
}

const show = (value) =>
  typeof value === "string" && value.startsWith("0x") && value.length > 66
    ? `${(value.length - 2) / 2} bytes`
    : String(value)

// Who sent the refused calls, and how many each sent: "from 2 of the 9
// senders (40 and 3 calls)", with the five that sent the most when there are
// more.
function bySender(refusedBy, all) {
  const counts = [...refusedBy.values()].sort((a, b) => b - a)
  const who =
    all === 1
      ? "the only sender"
      : refusedBy.size === all
        ? `all ${all} senders`
        : `${refusedBy.size} of the ${all} senders`
  if (counts.length > 1 && counts[0] === 1) return `from ${who} (one call each)`
  const shown = counts.slice(0, 5)
  const list =
    shown.length === 1
      ? plural(shown[0], "call", "calls")
      : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)} calls`
  return counts.length > shown.length
    ? `from ${who} (the five that sent the most: ${list})`
    : `from ${who} (${list})`
}

const lines = []
const say = (line = "") => {
  lines.push(line)
  console.log(line)
}
const table = []

say("## What the mustMatch fields refuse")
say()
const descriptors = walk(root).filter(
  (p) => /\/calldata-[^/]+\.json$/.test(p) && !p.includes("/testsv2/")
)
for (const path of descriptors) {
  const descriptor = JSON.parse(readFileSync(path, "utf8"))
  for (const [key, format] of Object.entries(
    descriptor.display?.formats ?? {}
  )) {
    const checks = mustMatchFields(format.fields)
    if (checks.length === 0 || key.startsWith("0x")) continue
    const fn = parseAbiItem(`function ${key}`)
    const selector = toFunctionSelector(fn)
    for (const { chainId, address } of descriptor.context?.contract
      ?.deployments ?? []) {
      if (!DATASETS[chainId]) continue
      const where = `${relative(root, path)}, chain ${chainId}, ${short(address)}`
      say(`### ${where}: \`${fn.name}\``)
      say()
      let result
      try {
        result = await latestCalls(
          chainId,
          address.toLowerCase(),
          selector,
          COUNT,
          BUDGET_MS
        )
      } catch (error) {
        say(`Not read: ${error.message}`)
        say()
        table.push([where, fn.name, "not read", "", ""])
        continue
      }
      const { calls, failed, since, until } = result
      const senders = new Set(calls.map((tx) => tx.from.toLowerCase()))
      // For each field, the values that refuse a call and in how many calls.
      const refusing = new Map(checks.map(({ path }) => [path, new Map()]))
      const unread = new Set()
      let refused = 0
      // The calls refused, by sender.
      const refusedBy = new Map()
      let undecodable = 0
      for (const tx of calls) {
        let args
        try {
          args = decodeFunctionData({ abi: [fn], data: tx.input }).args
        } catch {
          args = null
          undecodable += 1
        }
        let refuses = args === null
        for (const { path: field, list } of checks) {
          const found =
            args === null ? [] : valuesAt(field, fn, args, tx, chainId, address)
          if (found === null) {
            unread.add(field)
            continue
          }
          for (const value of new Set(found.filter((v) => !matches(v, list))))
            refusing
              .get(field)
              .set(show(value), (refusing.get(field).get(show(value)) ?? 0) + 1)
          if (found.some((value) => !matches(value, list))) refuses = true
        }
        if (refuses) {
          refused += 1
          const from = tx.from.toLowerCase()
          refusedBy.set(from, (refusedBy.get(from) ?? 0) + 1)
        }
      }
      say(
        `${plural(calls.length, "successful call", "successful calls")} from ${plural(senders.size, "sender", "senders")}, ${day(since)} to ${day(until)} UTC` +
          (calls.length === COUNT
            ? ` (the latest ${COUNT})`
            : " (all of them in that span)") +
          `; ${failed} failed in the blocks read, not counted.`
      )
      const why = [...refusing]
        .filter(([, seen]) => seen.size > 0)
        .map(
          ([field, seen]) =>
            `\`${field}\` is ` +
            [...seen]
              .sort((a, b) => b[1] - a[1])
              .map(([value, n]) => `${value} in ${plural(n, "call", "calls")}`)
              .join(", ")
        )
      if (undecodable > 0)
        why.push(`${plural(undecodable, "call does", "calls do")} not decode`)
      if (calls.length > 0)
        say(
          refused === 0
            ? "The descriptor refuses none of them."
            : `The descriptor refuses ${refused} of them (${Math.round((100 * refused) / calls.length)}%), ${bySender(refusedBy, senders.size)}: ${why.join("; ")}.`
        )
      if (unread.size > 0)
        say(`Not checked: ${[...unread].map((f) => `\`${f}\``).join(", ")}.`)
      say()
      table.push([
        where,
        fn.name,
        String(calls.length),
        calls.length > 0 ? String(refused) : "",
        refused > 0 ? `${refusedBy.size} of ${senders.size}` : "",
      ])
    }
  }
}
say("| Deployment | Function | Calls read | Refused | Their senders |")
say("| --- | --- | --- | --- | --- |")
for (const row of table) say(`| ${row.join(" | ")} |`)
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n")
