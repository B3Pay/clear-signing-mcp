// The actions of a batch call: the bytes[] argument of the function its
// calldata calls, decoded with the tracker's ABI for the contract it calls
// (tracker/data/abis/<chainId>/<address>.json). Used by build-tests.mjs to
// send one action of a real batch alone, and by verify-txs.mjs to check such
// a case against the batch on chain.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { decodeFunctionData, toFunctionSelector } from "viem"

export function batchActions(repo, chainId, address, input) {
  const file = join(
    repo,
    "tracker",
    "data",
    "abis",
    String(chainId),
    `${address.toLowerCase()}.json`
  )
  const json = JSON.parse(readFileSync(file, "utf8"))
  const abi = Array.isArray(json) ? json : json.abi
  const selector = input.slice(0, 10).toLowerCase()
  const fn = abi.find(
    (item) => item.type === "function" && toFunctionSelector(item) === selector
  )
  if (!fn) throw new Error(`${selector} is not a function of ${address}`)
  const index = fn.inputs.findIndex((i) => i.type === "bytes[]")
  if (
    index < 0 ||
    fn.inputs.findIndex((i, j) => j > index && i.type === "bytes[]") >= 0
  )
    throw new Error(`${fn.name} is not a batch: it needs one bytes[] parameter`)
  return decodeFunctionData({ abi: [fn], data: input }).args[index]
}

export function batchAction(repo, chainId, address, input, n) {
  const actions = batchActions(repo, chainId, address, input)
  if (!Number.isInteger(n) || n < 1 || n > actions.length)
    throw new Error(
      `the batch has ${actions.length} actions, so no action ${n}`
    )
  return actions[n - 1]
}
