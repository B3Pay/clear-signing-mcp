/**
 * Identifier words: how the draft engine reads parameter and function names.
 * `amountOutMin` is ["amount", "out", "min"], `tokenA` is ["token", "a"],
 * `amountETHMin` is ["amount", "eth", "min"], `amount0` is ["amount", "0"].
 * The word lists below are the vocabulary the heuristics match against.
 */

/** Lowercase words of an identifier, digits split off. */
export function words(identifier: string): string[] {
  return split(identifier, /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g).map((w) =>
    w.toLowerCase()
  )
}

function split(identifier: string, pattern: RegExp): string[] {
  const out: string[] = []
  for (const chunk of identifier.split(/[^A-Za-z0-9]+/)) {
    for (const match of chunk.matchAll(pattern)) out.push(match[0])
  }
  return out
}

const ACRONYMS: Readonly<Record<string, string>> = {
  id: "ID",
  ids: "IDs",
  eth: "ETH",
  weth: "WETH",
  nft: "NFT",
  lp: "LP",
  url: "URL",
  uri: "URI",
  evm: "EVM",
}

/** "speedUpDeposit" -> "Speed up deposit"; "depositId" -> "Deposit ID"; "depositV3" -> "Deposit V3". */
export function humanize(identifier: string): string {
  const shown = split(
    identifier,
    /[A-Z]+[0-9]*(?![a-z])|[A-Z]?[a-z]+|[0-9]+/g
  ).map((word) => {
    const acronym = ACRONYMS[word.toLowerCase()]
    if (acronym) return acronym
    // An all-caps word of two or more characters stays: "USDC", "V3".
    if (word.length > 1 && word === word.toUpperCase()) return word
    return word.toLowerCase()
  })
  return sentence(shown.join(" "))
}

/** First letter upper case, the rest as given. */
/** Ledger devices cut a label after this many characters; the linter warns past it. */
export const LABEL_MAX = 20

const SHORTER: readonly (readonly [string, string])[] = [
  ["parameters", "params"],
  ["parameter", "param"],
  ["information", "info"],
  ["configuration", "config"],
  ["identifier", "ID"],
  ["transaction", "tx"],
  ["maximum", "max"],
  ["minimum", "min"],
]

/** A label past LABEL_MAX with its long words shortened, one at a time, until it fits. */
export function fit(label: string): string {
  let out = label
  for (const [long, short] of SHORTER) {
    if (out.length <= LABEL_MAX) break
    out = out
      .split(" ")
      .map((w) =>
        w.toLowerCase() !== long
          ? w
          : w[0] === w[0]?.toUpperCase() && short !== "ID"
            ? short[0]?.toUpperCase() + short.slice(1)
            : short
      )
      .join(" ")
  }
  return out
}

export function sentence(text: string): string {
  const first = text[0]
  return first === undefined ? text : first.toUpperCase() + text.slice(1)
}

export const AMOUNT_WORDS = new Set([
  "amount",
  "amounts",
  "amt",
  "qty",
  "quantity",
  "wad",
  "value",
  "shares",
  "assets",
  "liquidity",
])

/** Bounds an amount can carry: a slippage floor or a ceiling. */
export const MIN_WORDS = new Set(["min", "minimum"])
export const MAX_WORDS = new Set(["max", "maximum", "desired", "limit"])

export const NATIVE_WORDS = new Set(["eth", "ether", "native"])

export const TOKEN_WORDS = new Set([
  "token",
  "tokens",
  "asset",
  "currency",
  "coin",
  "underlying",
  "reserve",
])

/** Direction words, normalized to "in" (what the signer gives) and "out" (what they get). */
export const DIRECTION: Readonly<Record<string, "in" | "out">> = {
  in: "in",
  input: "in",
  src: "in",
  source: "in",
  from: "in",
  sell: "in",
  sold: "in",
  give: "in",
  pay: "in",
  out: "out",
  output: "out",
  dst: "out",
  dest: "out",
  to: "out",
  buy: "out",
  bought: "out",
  return: "out",
  receive: "out",
  received: "out",
}

export const RECIPIENT_WORDS = new Set([
  "to",
  "recipient",
  "receiver",
  "beneficiary",
  "payee",
  "refund",
  "behalf",
])

export const SPENDER_WORDS = new Set([
  "spender",
  "operator",
  "delegate",
  "delegatee",
  "approved",
])

export const ACCOUNT_WORDS = new Set([
  "owner",
  "from",
  "sender",
  "account",
  "user",
  "depositor",
  "holder",
  "borrower",
  "maker",
  "taker",
  "signer",
])

export const DATE_WORDS = new Set([
  "deadline",
  "expiry",
  "expiration",
  "expires",
  "expire",
  "timestamp",
])

export const DURATION_WORDS = new Set([
  "duration",
  "period",
  "offset",
  "interval",
  "delay",
  "cooldown",
  "timelock",
  "window",
])

/** Bytes whose name says they carry a call. */
export const CALL_WORDS = new Set(["data", "calldata", "call", "calls"])

/** Addresses a nested call is sent to. */
export const CALLEE_WORDS = new Set(["target", "callee"])

export const SIGNATURE_NAMES = new Set(["v", "r", "s"])
export const SIGNATURE_WORDS = new Set(["signature", "sig", "signatures"])

/** Chain id words that put a token on the source or on the destination chain. */
export const ORIGIN_CHAIN_WORDS = new Set(["origin", "src", "source", "from"])
export const DESTINATION_CHAIN_WORDS = new Set([
  "destination",
  "dst",
  "dest",
  "to",
  "target",
])
