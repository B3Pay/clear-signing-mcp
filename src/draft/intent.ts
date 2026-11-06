import { humanize, words } from "./words.js"

/**
 * Intents from function names: the verb a person signs ("Swap", "Bridge",
 * "Add liquidity"), and the noun its amount labels use ("Amount to bridge").
 */

export interface Verb {
  /** The format's intent. */
  readonly intent: string
  /** The verb in amount labels: "Maximum to add", "Amount to supply". */
  readonly noun?: string
  /** The amounts of this verb come to the signer: "Minimum to receive". */
  readonly receives?: boolean
}

const GIVES: Readonly<Record<string, string>> = {
  deposit: "Deposit",
  supply: "Supply",
  stake: "Stake",
  repay: "Repay",
  wrap: "Wrap",
  mint: "Mint",
  lock: "Lock",
  send: "Send",
  transfer: "Transfer",
  approve: "Approve",
}

const RECEIVES: Readonly<Record<string, string>> = {
  withdraw: "Withdraw",
  redeem: "Redeem",
  borrow: "Borrow",
  claim: "Claim",
  unstake: "Unstake",
  unwrap: "Unwrap",
  burn: "Burn",
  unlock: "Unlock",
}

/** Words that qualify a verb without changing it: "withdrawETH", "supplyWithPermit", "depositV3". */
const QUALIFIERS = new Set([
  "eth",
  "weth",
  "native",
  "v",
  "to",
  "for",
  "with",
  "permit",
  "from",
  "now",
  "and",
  "call",
  "sig",
  "signature",
  "by",
  "exact",
  "supporting",
  "fee",
  "on",
  "tokens",
  "token",
  "unsafe",
])

/**
 * The verb of a function. `bridgeTo` is a destination chain id among its
 * parameters: a deposit or a send to another chain is a bridge.
 */
export function verbOf(name: string, bridgeTo: boolean): Verb {
  const fw = words(name)
  const has = (w: string) => fw.includes(w)
  if (
    has("swap") ||
    has("sell") ||
    has("buy") ||
    has("trade") ||
    (fw[0] === "exact" && (has("input") || has("output")))
  )
    return { intent: "Swap", noun: "send" }
  if (has("liquidity") && (has("add") || has("increase")))
    return { intent: "Add liquidity", noun: "add" }
  if (has("liquidity") && (has("remove") || has("decrease")))
    return { intent: "Remove liquidity", noun: "remove", receives: true }
  const first = fw[0] ?? ""
  if (
    has("bridge") ||
    (bridgeTo &&
      (first === "deposit" || first === "send" || first === "transfer"))
  )
    return { intent: "Bridge", noun: "bridge" }
  const rest = fw.slice(1).filter((w) => !/^[0-9]+$/.test(w))
  const plain = rest.every((w) => QUALIFIERS.has(w))
  const gives = GIVES[first]
  if (gives) {
    const noun = first === "transfer" ? "send" : first
    return plain ? { intent: gives, noun } : { intent: humanize(name), noun }
  }
  const receives = RECEIVES[first]
  if (receives)
    return plain
      ? { intent: receives, noun: first, receives: true }
      : { intent: humanize(name), noun: first, receives: true }
  return { intent: humanize(name) }
}
