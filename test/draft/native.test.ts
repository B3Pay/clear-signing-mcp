import { describe, expect, it } from "vitest"
import {
  decodeFunctionData,
  encodeFunctionData,
  parseAbiItem,
  type AbiFunction,
} from "viem"
import { valuesAt } from "../../src/draft/native.js"

const A = "0x00000000000000000000000000000000000000A1"
const B = "0x00000000000000000000000000000000000000b2"
const C = "0x00000000000000000000000000000000000000C3"

function decoded(signature: string, args: readonly unknown[]) {
  const fn = parseAbiItem(signature) as AbiFunction
  const data = encodeFunctionData({ abi: [fn], args })
  return { fn, args: decodeFunctionData({ abi: [fn], data }).args ?? [] }
}

describe("valuesAt", () => {
  it("reads a member of a struct, and the ends of an array", () => {
    const { fn, args } = decoded(
      "function swap((address tokenIn, uint256 amount) order, address[] path)",
      [{ tokenIn: A, amount: 1n }, [A, B, C]]
    )
    expect(valuesAt(fn, args, "order.tokenIn")).toEqual([A])
    expect(valuesAt(fn, args, "path.[0]")).toEqual([A])
    expect(valuesAt(fn, args, "path.[-1]")).toEqual([C])
    expect(valuesAt(fn, args, "path.[]")).toEqual([A, B, C])
  })

  it("reads every element of an array of structs, and unnamed members", () => {
    const { fn, args } = decoded(
      "function fill((address token, uint256 amount)[] orders, (address, uint256) pair)",
      [
        [
          { token: A, amount: 1n },
          { token: B, amount: 2n },
        ],
        [C, 3n],
      ]
    )
    expect(valuesAt(fn, args, "orders.[].token")).toEqual([A, B])
    expect(valuesAt(fn, args, "pair._0")).toEqual([C])
  })

  it("finds nothing at a path the function does not have", () => {
    const { fn, args } = decoded("function send(address to, uint256 amount)", [
      A,
      1n,
    ])
    expect(valuesAt(fn, args, "token")).toEqual([])
    expect(valuesAt(fn, args, "to.[0]")).toEqual([])
    expect(valuesAt(fn, args, "to.member")).toEqual([])
  })
})
