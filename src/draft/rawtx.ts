import { serializeTransaction, type Hex } from "viem"
import type { DraftSample } from "./types.js"

/**
 * A sample transaction rebuilt unsigned, the form a testsv2 `rawTx` takes:
 * the same type, chain, nonce, gas, fees, recipient, value and calldata, and
 * no signature. A legacy transaction carries its chain id the EIP-155 way.
 */
export function unsignedRawTx(
  tx: DraftSample
): { readonly rawTx: Hex } | { readonly skip: string } {
  const base = {
    chainId: tx.chainId,
    to: tx.to,
    nonce: tx.nonce,
    gas: BigInt(tx.gas),
    value: BigInt(tx.value),
    data: tx.input,
  }
  const accessList = (tx.accessList ?? []).map((entry) => ({
    address: entry.address,
    storageKeys: [...entry.storageKeys],
  }))
  switch (tx.type) {
    case "legacy":
      if (tx.gasPrice === undefined)
        return { skip: "a legacy transaction without its gas price" }
      return {
        rawTx: serializeTransaction({
          ...base,
          type: "legacy",
          gasPrice: BigInt(tx.gasPrice),
        }),
      }
    case "eip2930":
      if (tx.gasPrice === undefined)
        return { skip: "an EIP-2930 transaction without its gas price" }
      return {
        rawTx: serializeTransaction({
          ...base,
          type: "eip2930",
          gasPrice: BigInt(tx.gasPrice),
          accessList,
        }),
      }
    case "eip1559":
      if (
        tx.maxFeePerGas === undefined ||
        tx.maxPriorityFeePerGas === undefined
      )
        return { skip: "an EIP-1559 transaction without its fee caps" }
      return {
        rawTx: serializeTransaction({
          ...base,
          type: "eip1559",
          maxFeePerGas: BigInt(tx.maxFeePerGas),
          maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
          accessList,
        }),
      }
    default:
      return {
        skip: `a transaction of type ${tx.type}, which the draft does not rebuild (only legacy, EIP-2930 and EIP-1559)`,
      }
  }
}
