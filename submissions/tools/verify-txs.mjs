// Checks that every test case under submissions/registry/ is a real
// transaction: the transaction its txHash names, read from the chain over a
// public RPC, was mined, succeeded, and has the chain, sender nonce, target,
// value and calldata of the case's unsigned rawTx. Network; runs in CI.
//
//   node submissions/tools/verify-txs.mjs [--root <dir like submissions/registry>] \
//     [--cases <dir like submissions/cases>]
//
// A case without a txHash is checked when its cases file
// (submissions/cases/<entity>/<descriptor>.cases.json) builds it as an action
// of a batch sent alone (build-tests.mjs): the batch its txHash names was
// mined and succeeded, has the case's chain, sender nonce and target, and that
// action is the case's calldata, which carries no value.
//
// Public endpoints are full nodes, which prune old receipts: when none has a
// mined transaction's receipt, its status is read from the chain's Blockscout,
// and the line says so. RPC_URL_<chainId> overrides a chain's public
// endpoints. Exit status 1 when a case does not match, or its chain cannot be
// read.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, dirname, join, relative, resolve } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { parseTransaction } from "viem"
import { batchActions } from "./batch-action.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { values } = parseArgs({
  options: { root: { type: "string" }, cases: { type: "string" } },
})
const root = resolve(values.root ?? join(repo, "submissions", "registry"))
const casesRoot = resolve(values.cases ?? join(repo, "submissions", "cases"))

// The chains the coverage tracker reads, with the tracker's public endpoints.
const PUBLIC_RPC = {
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: [
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
  ],
}

// The explorers the tracker reads (tracker/fetch.ts).
const BLOCKSCOUT = {
  1: "https://eth.blockscout.com",
  10: "https://optimism.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
}

// Whether Blockscout records the transaction as mined and successful. An
// answer of 429 or 5xx, or none, is asked again twice, 5 and then 15 seconds
// later: eth.blockscout.com has answered 500 for minutes at a time.
async function blockscoutSucceeded(chainId, hash) {
  const base = BLOCKSCOUT[chainId]
  if (!base) throw new Error(`no Blockscout for chain ${chainId}`)
  let last
  for (const wait of [0, 5_000, 15_000]) {
    if (wait > 0) await sleep(wait)
    try {
      const response = await fetch(`${base}/api/v2/transactions/${hash}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.ok) {
        const body = await response.json()
        return body.status === "ok" && body.result === "success"
      }
      last = new Error(`Blockscout: HTTP ${response.status}`)
      if (response.status !== 429 && response.status < 500) break
    } catch (error) {
      last = new Error(`Blockscout: ${error.message}`)
    }
  }
  throw last
}

function endpoints(chainId) {
  const override = process.env[`RPC_URL_${chainId}`]
  return override ? [override] : (PUBLIC_RPC[chainId] ?? [])
}

// The first endpoint that has the answer. A null result (no such transaction
// or receipt) is taken only when every endpoint that answered says so: a node
// can lag behind, or have pruned old history.
async function rpc(chainId, method, params) {
  let last
  let answered = false
  for (const url of endpoints(chainId)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      if (body.error) throw new Error(body.error.message)
      if (body.result != null) return body.result
      answered = true
    } catch (error) {
      last = error
    }
  }
  if (answered) return null
  throw new Error(
    `chain ${chainId}: ${endpoints(chainId).length ? `every endpoint failed (${last?.message})` : "no endpoint"}`
  )
}

function testFiles(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...testFiles(path))
    else if (/\/testsv2\/[^/]+\.tests\.json$/.test(path)) out.push(path)
  }
  return out.sort()
}

// The case a test without a txHash was built from, when its cases file sends
// a batch action alone.
function liftedCase(file, test) {
  const entity = basename(dirname(dirname(file)))
  const name = basename(file).replace(/\.tests\.json$/, "")
  const path = join(casesRoot, entity, `${name}.cases.json`)
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, "utf8")).tests.find(
    (c) => c.description === test.description && c.action !== undefined
  )
}

// Whether the mined transaction succeeded. Full nodes prune old receipts;
// then Blockscout answers, and a note says so.
async function checkStatus(chainId, hash, mined, receipt, problems, notes) {
  if (mined.blockNumber == null) problems.push("pending, not mined")
  else if (!receipt) {
    const block = Number(mined.blockNumber)
    try {
      if (await blockscoutSucceeded(chainId, hash))
        notes.push(
          `block ${block}: status from Blockscout, the RPC endpoints have pruned its receipt`
        )
      else
        problems.push(
          `block ${block}: Blockscout does not record it as successful`
        )
    } catch (error) {
      problems.push(
        `block ${block}: no receipt from the RPC endpoints, and ${error.message}`
      )
    }
  } else if (receipt.status !== "0x1")
    problems.push(
      `did not succeed (status ${receipt.status}, block ${Number(receipt.blockNumber)})`
    )
}

let failed = 0
let matched = 0
let total = 0
let liftedMatched = 0
let liftedTotal = 0
for (const file of testFiles(root)) {
  const { tests } = JSON.parse(readFileSync(file, "utf8"))
  for (const test of tests) {
    const where = `${relative(root, file)}: ${test.description}`
    const lifted = test.txHash ? undefined : liftedCase(file, test)
    if (!test.txHash && !lifted) {
      console.log(`- ${where}: no txHash, not checked`)
      continue
    }
    const hash = test.txHash ?? lifted.txHash
    if (lifted) liftedTotal++
    else total++
    const tx = parseTransaction(test.rawTx)
    const chainId = Number(tx.chainId ?? 1)
    try {
      const [mined, receipt] = await Promise.all([
        rpc(chainId, "eth_getTransactionByHash", [hash]),
        rpc(chainId, "eth_getTransactionReceipt", [hash]),
      ])
      const problems = []
      const notes = []
      const of = lifted ? "batch " : ""
      if (!mined) problems.push(`${of}not found on chain`)
      else {
        if (Number(mined.chainId ?? chainId) !== chainId)
          problems.push(`${of}chain ${Number(mined.chainId)}`)
        if ((mined.to ?? "").toLowerCase() !== (tx.to ?? "").toLowerCase())
          problems.push(`${of}to ${mined.to}`)
        if (Number(mined.nonce) !== Number(tx.nonce ?? 0))
          problems.push(`${of}nonce ${Number(mined.nonce)}`)
        if (!lifted) {
          if (BigInt(mined.value) !== (tx.value ?? 0n))
            problems.push(`value ${BigInt(mined.value)}`)
          if (mined.input.toLowerCase() !== (tx.data ?? "0x").toLowerCase())
            problems.push("calldata differs")
        } else {
          if ((tx.value ?? 0n) !== 0n)
            problems.push(`carries a value, ${tx.value}`)
          let actions
          try {
            actions = batchActions(repo, chainId, mined.to, mined.input)
          } catch (error) {
            problems.push(`the batch cannot be read: ${error.message}`)
          }
          if (
            actions &&
            (actions[lifted.action - 1] ?? "").toLowerCase() !==
              (tx.data ?? "0x").toLowerCase()
          )
            problems.push(
              `the calldata is not action ${lifted.action} of the batch, which has ${actions.length}`
            )
          notes.push(`action ${lifted.action} of ${hash}, sent alone`)
        }
        await checkStatus(chainId, hash, mined, receipt, problems, notes)
      }
      if (problems.length) {
        failed++
        console.log(`- ❌ ${where}: ${problems.join(", ")}`)
      } else {
        if (lifted) liftedMatched++
        else matched++
        console.log(
          `- ✅ ${where}${notes.length ? ` (${notes.join("; ")})` : ""}`
        )
      }
    } catch (error) {
      failed++
      console.log(`- ❌ ${where}: ${error.message}`)
    }
  }
}
console.log(`\n${matched} of ${total} test transactions match the chain`)
if (liftedTotal > 0)
  console.log(
    `${liftedMatched} of ${liftedTotal} batch actions sent alone match their batch on chain`
  )
process.exit(failed ? 1 : 0)
