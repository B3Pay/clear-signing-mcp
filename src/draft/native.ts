import { decodeFunctionData, type AbiFunction } from "viem"
import type { DescribedFunction } from "./abi.js"
import type { DescriptorFormat, DraftSample } from "./types.js"

/**
 * The addresses contracts take in place of a token for the chain's native
 * currency, keyed by their lowercase form.
 */
const SENTINELS: ReadonlyMap<string, string> = new Map([
  [
    "0x0000000000000000000000000000000000000000",
    "0x0000000000000000000000000000000000000000",
  ],
  [
    "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  ],
])

interface Param {
  readonly type: string
  readonly name?: string
  readonly components?: readonly Param[]
}

/**
 * A token amount whose token a sample passes as a native-currency sentinel
 * (the zero address, or 0xEeee…EEeE) gets that sentinel as its
 * `nativeCurrencyAddress`, so the amount shows in ETH rather than as a raw
 * number. Only sentinels the samples send are named, and the review note
 * asks a person to check that the contract reads them as native currency:
 * a zero address can also mean "no token".
 */
export function markNativeTokens(
  described: DescribedFunction,
  format: DescriptorFormat,
  samples: readonly DraftSample[],
  review: string[]
): DescriptorFormat {
  const decoded: (readonly unknown[])[] = []
  for (const sample of samples) {
    if (sample.input.slice(0, 10).toLowerCase() !== described.selector) continue
    try {
      const { args } = decodeFunctionData({
        abi: [described.fn],
        data: sample.input,
      })
      decoded.push(args ?? [])
    } catch {
      continue
    }
  }
  if (decoded.length === 0) return format
  let changed = false
  const fields = format.fields.map((field) => {
    const tokenPath = field.params?.tokenPath
    if (
      field.format !== "tokenAmount" ||
      typeof tokenPath !== "string" ||
      tokenPath.startsWith("@.") ||
      tokenPath.startsWith("$.")
    )
      return field
    const seen = new Set<string>()
    for (const args of decoded)
      for (const value of valuesAt(described.fn, args, tokenPath)) {
        const sentinel =
          typeof value === "string"
            ? SENTINELS.get(value.toLowerCase())
            : undefined
        if (sentinel) seen.add(sentinel)
      }
    if (seen.size === 0) return field
    changed = true
    const list = [...seen].sort()
    review.push(
      `${described.title}: ${field.path} is counted in the native currency when ${tokenPath} is ${list.join(" or ")}, as the samples send it; check that the contract reads it so.`
    )
    return {
      ...field,
      params: {
        ...field.params,
        nativeCurrencyAddress: list.length === 1 ? list[0] : list,
      },
    }
  })
  return changed ? { ...format, fields } : format
}

/**
 * The values an ERC-7730 path ("baseRequest.toToken", "path.[0]",
 * "path.[-1]", "orders.[].token") points at in a call decoded by viem: one
 * for each element where the path crosses an array with "[]".
 */
export function valuesAt(
  fn: AbiFunction,
  args: readonly unknown[],
  path: string
): unknown[] {
  const [first, ...rest] = path.split(".")
  const inputs = fn.inputs as readonly Param[]
  const index = inputs.findIndex((p, i) => nameOf(p, i) === first)
  const top = inputs[index]
  if (!top) return []
  let current: { value: unknown; param: Param }[] = [
    { value: args[index], param: top },
  ]
  for (const segment of rest) {
    const next: { value: unknown; param: Param }[] = []
    const position = /^\[(-?\d*)\]$/.exec(segment)
    for (const { value, param } of current) {
      if (position) {
        if (!/\[\d*\]$/.test(param.type) || !Array.isArray(value)) continue
        const element = { ...param, type: param.type.replace(/\[\d*\]$/, "") }
        if (position[1] === "") {
          for (const item of value) next.push({ value: item, param: element })
          continue
        }
        const i = Number(position[1])
        const at = i < 0 ? value.length + i : i
        if (at >= 0 && at < value.length)
          next.push({ value: value[at], param: element })
        continue
      }
      if (param.type !== "tuple") continue
      const components = param.components ?? []
      const ci = components.findIndex((c, i) => nameOf(c, i) === segment)
      const component = components[ci]
      if (!component) continue
      // viem returns a tuple as an object when every member is named.
      const member: unknown = Array.isArray(value)
        ? (value as readonly unknown[])[ci]
        : typeof value === "object" && value !== null && component.name
          ? (value as Record<string, unknown>)[component.name]
          : undefined
      next.push({ value: member, param: component })
    }
    current = next
  }
  return current.map((c) => c.value)
}

function nameOf(param: Param, index: number): string {
  return param.name && param.name.length > 0 ? param.name : `_${index}`
}
