// What the batch calls to a submitted contract carry. For each deployment of
// each descriptor under submissions/registry/ whose contract has a batch
// function (in the tracker's ABI for it, a function named multicall with a
// bytes[] parameter: multicall(bytes[]), multicall(uint256,bytes[]),
// multicall(bytes32,bytes[])), it reads the latest successful transactions
// that call one from the SQD Network portal, decodes their actions, and
// counts which sequences of actions occur and which actions the descriptor
// has no format for. Read-only, network; runs in CI. It never fails a run:
// it measures what a batch screen would show, for the pull request text.
//
//   node submissions/tools/multicall-actions.mjs [--root <dir like submissions/registry>] \
//     [--count 200] [--minutes 4]
//
// --count is the batches read per deployment and function, newest first;
// --minutes bounds the time spent on each, after which it reports what it
// read and the span that covers. It looks back at most 30 days.

import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import {
  decodeFunctionData,
  parseAbiItem,
  toFunctionSelector,
  toFunctionSignature,
} from "viem"
import { DATASETS, latestCalls } from "./portal.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { values } = parseArgs({
  options: {
    root: { type: "string" },
    count: { type: "string", default: "200" },
    minutes: { type: "string", default: "4" },
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

const lines = []
const say = (line = "") => {
  lines.push(line)
  console.log(line)
}

say("## What batch calls carry")
say()
const descriptors = walk(root).filter(
  (p) => /\/calldata-[^/]+\.json$/.test(p) && !p.includes("/testsv2/")
)
for (const path of descriptors) {
  const descriptor = JSON.parse(readFileSync(path, "utf8"))
  const formatted = new Map(
    Object.keys(descriptor.display?.formats ?? {}).map((key) => [
      toFunctionSelector(parseAbiItem(`function ${key}`)),
      key.slice(0, key.indexOf("(")),
    ])
  )
  for (const { chainId, address } of descriptor.context?.contract
    ?.deployments ?? []) {
    const abiFile = join(
      repo,
      "tracker",
      "data",
      "abis",
      String(chainId),
      `${address.toLowerCase()}.json`
    )
    let abi
    try {
      abi = JSON.parse(readFileSync(abiFile, "utf8"))
      abi = Array.isArray(abi) ? abi : abi.abi
    } catch {
      continue
    }
    const functions = abi.filter((item) => item.type === "function")
    const batch = functions.filter(
      (f) =>
        f.name === "multicall" && f.inputs.some((i) => i.type === "bytes[]")
    )
    if (batch.length === 0 || !DATASETS[chainId]) continue
    const names = new Map(functions.map((f) => [toFunctionSelector(f), f.name]))
    for (const fn of batch) {
      const selector = toFunctionSelector(fn)
      const where = `${relative(root, path)}, chain ${chainId}, ${short(address)}`
      say(
        `### ${where}: \`${toFunctionSignature(fn)}\`${formatted.has(selector) ? "" : " (no format)"}`
      )
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
        continue
      }
      const { calls, failed, since, until } = result
      const index = fn.inputs.findIndex((i) => i.type === "bytes[]")
      const sequences = new Map()
      const missing = new Map()
      let complete = 0
      const senders = new Set()
      for (const tx of calls) {
        senders.add(tx.from.toLowerCase())
        let actions
        try {
          actions = decodeFunctionData({ abi: [fn], data: tx.input }).args[
            index
          ]
        } catch {
          actions = null
        }
        const selectors =
          actions === null
            ? ["undecodable"]
            : actions.map((a) => a.slice(0, 10).toLowerCase())
        const key =
          selectors.map((s) => names.get(s) ?? s).join(", ") || "(empty)"
        const entry = sequences.get(key) ?? { batches: 0, senders: new Set() }
        entry.batches += 1
        entry.senders.add(tx.from.toLowerCase())
        sequences.set(key, entry)
        const unformatted = [
          ...new Set(selectors.filter((s) => !formatted.has(s))),
        ]
        if (unformatted.length === 0) complete += 1
        for (const s of unformatted) {
          const name = names.get(s) ?? s
          missing.set(name, (missing.get(name) ?? 0) + 1)
        }
      }
      say(
        `${plural(calls.length, "successful batch", "successful batches")} from ${plural(senders.size, "sender", "senders")}, ${day(since)} to ${day(until)} UTC` +
          (calls.length === COUNT
            ? ` (the latest ${COUNT})`
            : " (all of them in that span)") +
          `; ${failed} failed in the blocks read, not counted.`
      )
      if (calls.length === 0) {
        say()
        continue
      }
      say(
        `Every action has a format in ${complete} of ${calls.length} batches (${Math.round((100 * complete) / calls.length)}%).`
      )
      say()
      say("| Actions | Batches | Senders |")
      say("| --- | --- | --- |")
      for (const [key, entry] of [...sequences].sort(
        (a, b) => b[1].batches - a[1].batches
      ))
        say(`| ${key} | ${entry.batches} | ${entry.senders.size} |`)
      say()
      if (missing.size > 0) {
        say(
          "Actions with no format, in batches: " +
            [...missing]
              .sort((a, b) => b[1] - a[1])
              .map(([n, c]) => `${n} (${c})`)
              .join(", ") +
            "."
        )
        say()
      }
    }
  }
}
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n")
