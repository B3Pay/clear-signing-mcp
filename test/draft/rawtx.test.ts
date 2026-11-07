import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseTransaction, type Hex } from "viem"
import { unsignedRawTx } from "../../src/draft/rawtx.js"
import type { DraftSample } from "../../src/draft/types.js"

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/draft/uniswap-v2-router02.json", import.meta.url),
    "utf8"
  )
) as { samples: DraftSample[] }

function rebuilt(sample: DraftSample): Hex {
  const out = unsignedRawTx(sample)
  if (!("rawTx" in out)) throw new Error(out.skip)
  return out.rawTx
}

describe("unsignedRawTx", () => {
  it("rebuilds a legacy transaction with its chain id (EIP-155) and no signature", () => {
    const sample = fixture.samples.find((s) => s.type === "legacy")
    if (!sample) throw new Error("the fixture has no legacy sample")
    const tx = parseTransaction(rebuilt(sample))
    expect(tx.type).toBe("legacy")
    expect(tx.chainId).toBe(1)
    expect(tx.to).toBe(sample.to.toLowerCase())
    expect(tx.value).toBe(BigInt(sample.value))
    expect(tx.data).toBe(sample.input)
    expect(tx.nonce).toBe(sample.nonce)
    expect(tx.gas).toBe(BigInt(sample.gas))
    expect(tx.gasPrice).toBe(BigInt(sample.gasPrice ?? "x"))
    expect(tx.r).toBeUndefined()
    expect(tx.s).toBeUndefined()
  })

  it("rebuilds an EIP-1559 transaction with its fees", () => {
    const sample = fixture.samples.find((s) => s.type === "eip1559")
    if (!sample) throw new Error("the fixture has no EIP-1559 sample")
    const tx = parseTransaction(rebuilt(sample))
    expect(tx.type).toBe("eip1559")
    expect(tx.chainId).toBe(1)
    expect(tx.to).toBe(sample.to.toLowerCase())
    expect(tx.data).toBe(sample.input)
    expect(tx.value ?? 0n).toBe(BigInt(sample.value))
    expect(tx.maxFeePerGas).toBe(BigInt(sample.maxFeePerGas ?? "x"))
    expect(tx.maxPriorityFeePerGas).toBe(
      BigInt(sample.maxPriorityFeePerGas ?? "x")
    )
    expect(tx.r).toBeUndefined()
  })

  it("rebuilds an EIP-2930 transaction with its access list", () => {
    const sample: DraftSample = {
      hash: `0x${"11".repeat(32)}`,
      chainId: 10,
      to: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
      value: "0",
      input: "0x095ea7b3",
      nonce: 7,
      gas: "50000",
      type: "eip2930",
      gasPrice: "1000",
      accessList: [
        {
          address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
          storageKeys: [`0x${"00".repeat(31)}01`],
        },
      ],
    }
    const tx = parseTransaction(rebuilt(sample))
    expect(tx.type).toBe("eip2930")
    expect(tx.chainId).toBe(10)
    expect(tx.accessList).toEqual(
      sample.accessList?.map((entry) => ({
        ...entry,
        address: entry.address.toLowerCase(),
      }))
    )
  })

  it("skips a type it cannot rebuild, and a legacy transaction without its gas price", () => {
    const base = fixture.samples[0]
    if (!base) throw new Error("the fixture has no sample")
    expect(unsignedRawTx({ ...base, type: "eip7702" })).toHaveProperty("skip")
    const { gasPrice: _gasPrice, ...noPrice } = base
    expect(unsignedRawTx({ ...noPrice, type: "legacy" })).toHaveProperty("skip")
  })
})
