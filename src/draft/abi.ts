import { toFunctionSelector, type Abi, type AbiFunction, type Hex } from "viem"
import { words } from "./words.js"

/**
 * The ABI side of a draft: which functions to describe, the format key of
 * each, and its parameters flattened into the leaves a descriptor field can
 * point at.
 */

/** An ABI parameter, read structurally. */
interface Param {
  readonly type: string
  readonly name?: string
  readonly components?: readonly Param[]
}

/** One displayable value of a function's calldata. */
export interface Leaf {
  /** The ERC-7730 path: "amountIn", "relayData.outputToken", "path.[]", "orders.[].amount". */
  readonly path: string
  /** The parameter's own name: the last segment of the path. */
  readonly name: string
  readonly words: readonly string[]
  /** The element's ABI type: "uint256", "address", "bytes32", "bytes", "bool", "string". */
  readonly type: string
  /** The leaf is every element of a one-dimensional array: its path ends in ".[]". */
  readonly array: boolean
  /** The path of the struct the leaf is a member of; "" at the top level. */
  readonly scope: string
  /** The name had to be made up, because the ABI leaves it out. */
  readonly unnamed: boolean
  /** Why the leaf cannot be displayed, when it cannot. */
  readonly unsupported?: string
}

export interface DescribedFunction {
  readonly fn: AbiFunction
  readonly selector: Hex
  /** The display.formats key: "swap(uint256 amountIn,address[] path)". */
  readonly key: string
  /** How review notes name it: "swap (0x12345678)". */
  readonly title: string
  readonly leaves: readonly Leaf[]
}

export function functionsOf(abi: Abi): AbiFunction[] {
  return abi.filter((item): item is AbiFunction => item.type === "function")
}

export function selectorOf(fn: AbiFunction): Hex {
  return toFunctionSelector(fn)
}

export function isReadOnly(fn: AbiFunction): boolean {
  const legacy = fn as AbiFunction & { constant?: boolean }
  return (
    fn.stateMutability === "view" ||
    fn.stateMutability === "pure" ||
    legacy.constant === true
  )
}

export function isPayable(fn: AbiFunction): boolean {
  const legacy = fn as AbiFunction & { payable?: boolean }
  return fn.stateMutability === "payable" || legacy.payable === true
}

/** The ERC-7730 format key: the signature with parameter names, no spaces after commas. */
export function formatKey(fn: AbiFunction): string {
  return `${fn.name}(${(fn.inputs as readonly Param[]).map(keyParam).join(",")})`
}

function keyParam(param: Param, index: number): string {
  return `${keyType(param)} ${paramName(param, index)}`
}

function keyType(param: Param): string {
  if (!param.type.startsWith("tuple")) return param.type
  const suffix = param.type.slice("tuple".length)
  return `(${(param.components ?? []).map(keyParam).join(",")})${suffix}`
}

function paramName(param: Param, index: number): string {
  return param.name && param.name.length > 0 ? param.name : `_${index}`
}

export function describe(fn: AbiFunction): DescribedFunction {
  const leaves: Leaf[] = []
  walk(fn.inputs, undefined, leaves)
  const selector = selectorOf(fn)
  return {
    fn,
    selector,
    key: formatKey(fn),
    title: `${fn.name} (${selector})`,
    leaves,
  }
}

function walk(
  params: readonly Param[],
  prefix: string | undefined,
  out: Leaf[]
): void {
  params.forEach((param, index) => {
    const name = paramName(param, index)
    const unnamed = !(param.name && param.name.length > 0)
    const path = prefix === undefined ? name : `${prefix}.${name}`
    const dims = param.type.match(/\[\d*\]/g)?.length ?? 0
    const base = param.type.replace(/(\[\d*\])+$/, "")
    const leaf = {
      name,
      words: words(name),
      type: base,
      scope: prefix ?? "",
      unnamed,
    }
    if (base === "tuple") {
      if (dims === 0) walk(param.components ?? [], path, out)
      else if (dims === 1) walk(param.components ?? [], `${path}.[]`, out)
      else
        out.push({
          ...leaf,
          path: `${path}.[]`,
          array: true,
          unsupported: "an array of arrays of structs",
        })
      return
    }
    if (dims >= 2) {
      out.push({
        ...leaf,
        path: `${path}.[]`,
        array: true,
        unsupported: "an array of arrays",
      })
      return
    }
    out.push({
      ...leaf,
      path: dims === 1 ? `${path}.[]` : path,
      array: dims === 1,
    })
  })
}

/** The functions to describe: the selectors asked for, else every function that changes state. */
export function pickFunctions(
  abi: Abi,
  selectors: readonly string[] | undefined,
  review: string[]
): DescribedFunction[] {
  const all = functionsOf(abi)
  const bySelector = new Map<string, AbiFunction>()
  for (const fn of all) {
    const selector = selectorOf(fn)
    if (!bySelector.has(selector)) bySelector.set(selector, fn)
  }
  if (!selectors) {
    return [...bySelector.values()]
      .filter((fn) => !isReadOnly(fn))
      .map(describe)
  }
  const out: DescribedFunction[] = []
  const seen = new Set<string>()
  for (const raw of selectors) {
    const selector = raw.toLowerCase()
    if (seen.has(selector)) continue
    seen.add(selector)
    const fn = bySelector.get(selector)
    if (!fn) {
      review.push(
        `Selector ${selector} is not a function of the ABI, so the draft leaves it out.`
      )
      continue
    }
    if (isReadOnly(fn))
      review.push(
        `${formatKey(fn)} is ${fn.stateMutability}: it changes nothing, yet it was asked for, so it is described.`
      )
    out.push(describe(fn))
  }
  return out
}

/** The contract is an ERC-20 token itself, so an amount with no token of its own is in it. */
export function isTokenContract(abi: Abi): boolean {
  const keys = new Set(functionsOf(abi).map(formatKeyWithoutNames))
  return (
    keys.has("transfer(address,uint256)") &&
    keys.has("balanceOf(address)") &&
    keys.has("totalSupply()")
  )
}

/** The contract is an ERC-4626 vault: its shares are its own token, its assets another one. */
export function isVault(abi: Abi): boolean {
  const keys = new Set(functionsOf(abi).map(formatKeyWithoutNames))
  return (
    isTokenContract(abi) && keys.has("asset()") && keys.has("totalAssets()")
  )
}

function formatKeyWithoutNames(fn: AbiFunction): string {
  return `${fn.name}(${(fn.inputs as readonly Param[]).map(keyType).join(",")})`
}
