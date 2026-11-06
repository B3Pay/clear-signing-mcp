import { isPayable, type DescribedFunction, type Leaf } from "./abi.js"
import { verbOf, type Verb } from "./intent.js"
import type { DescriptorField, DescriptorFormat } from "./types.js"
import {
  ACCOUNT_WORDS,
  AMOUNT_WORDS,
  CALL_WORDS,
  CALLEE_WORDS,
  DATE_WORDS,
  DESTINATION_CHAIN_WORDS,
  DIRECTION,
  DURATION_WORDS,
  MAX_WORDS,
  MIN_WORDS,
  NATIVE_WORDS,
  ORIGIN_CHAIN_WORDS,
  RECIPIENT_WORDS,
  SIGNATURE_NAMES,
  SIGNATURE_WORDS,
  SPENDER_WORDS,
  TOKEN_WORDS,
  LABEL_MAX,
  fit,
  humanize,
  sentence,
  words,
} from "./words.js"

/**
 * One display format per function, from the ABI alone: what each parameter
 * is (an amount, the token it is counted in, a recipient, a deadline), how to
 * show it, and what to call it. Every parameter is shown or hidden on
 * purpose, and every hidden one gets a review note.
 */

export interface ContractTraits {
  /** The contract is an ERC-20 token: an amount with no token of its own is in it (`@.to`). */
  readonly token: boolean
  /** The contract is an ERC-4626 vault: shares are its token, assets are not. */
  readonly vault: boolean
  /** The native currency's symbol on every deployment's chain, when they agree. */
  readonly nativeSymbol?: string
}

type Side = "in" | "out"
type Bound = "min" | "max" | "exact"

type Role =
  | {
      readonly kind: "amount"
      readonly native: boolean
      readonly side?: Side
      readonly bound: Bound
    }
  | { readonly kind: "token"; readonly side?: Side }
  | { readonly kind: "chain"; readonly place?: "origin" | "destination" }
  | {
      readonly kind:
        | "recipient"
        | "spender"
        | "account"
        | "date"
        | "duration"
        | "call"
        | "callee"
        | "signature"
        | "unsupported"
        | "other"
    }

interface Classified {
  readonly leaf: Leaf
  readonly role: Role
  /** Position in the ABI. */
  readonly order: number
}

interface Planned {
  readonly field: DescriptorField
  readonly role: Role
  /** 0 what the signer gives, 1 what they get, 2 other amounts, 3 the rest, 4 hidden. */
  readonly group: number
  readonly order: number
  readonly bound?: Bound
}

const ADDRESS_PARAMS = {
  types: ["eoa", "contract"],
  sources: ["local", "ens"],
} as const

/** Words that make an address a person's, not a token, even next to "token". */
const PERSON_WORDS = new Set([
  "recipient",
  "receiver",
  "beneficiary",
  "payee",
  "spender",
  "owner",
  "sender",
  "account",
  "user",
  "depositor",
  "holder",
])

const AMOUNT_STRIP = new Set([
  ...AMOUNT_WORDS,
  ...MIN_WORDS,
  ...MAX_WORDS,
  ...TOKEN_WORDS,
])
const TOKEN_STRIP = new Set([...TOKEN_WORDS, "address", "addr"])

export function draftFormat(
  described: DescribedFunction,
  traits: ContractTraits,
  review: string[]
): DescriptorFormat {
  const { leaves } = described
  const classified = leaves.map((leaf, order): Classified => ({
    leaf,
    role: classify(leaf),
    order,
  }))
  const bridgeTo = classified.some(
    (c) => c.role.kind === "chain" && c.role.place === "destination"
  )
  const verb = verbOf(described.fn.name, bridgeTo)
  const nativeSide = nativeSideOf(described.fn.name)
  const note = (text: string) => review.push(`${described.title}: ${text}`)

  for (const c of classified) {
    if (c.leaf.unnamed)
      note(
        `parameter ${c.leaf.path} has no name in the ABI; the draft names it, and the registry's linter may reject that name.`
      )
  }

  const tokens = classified.filter((c) => c.role.kind === "token")
  const chains = classified.filter((c) => c.role.kind === "chain")
  const used = new Set<string>()
  const planned: Planned[] = []
  const hide = (c: Classified, why: string) => {
    planned.push({
      field: {
        path: c.leaf.path,
        label: humanize(c.leaf.name),
        visible: "never",
      },
      role: c.role,
      group: 4,
      order: c.order,
    })
    note(`${c.leaf.path} is hidden: ${why}.`)
  }

  for (const c of classified) {
    const { leaf, role } = c
    switch (role.kind) {
      case "amount": {
        const group = groupOf(role, verb)
        // swapExactTokensForETH: what comes out is ETH, whatever the path ends in.
        if (
          role.native ||
          (role.side !== undefined && role.side === nativeSide)
        ) {
          planned.push({
            field: {
              path: leaf.path,
              label: amountLabel(role, verb, leaf),
              format: "amount",
            },
            role,
            group,
            order: c.order,
            bound: role.bound,
          })
          break
        }
        const paired = pair(c, role, scoped(tokens, leaf.scope))
        if (paired) {
          if (paired.token) used.add(paired.token.path)
          const chainIdPath = chainPathFor(
            paired.side,
            scoped(chains, leaf.scope)
          )
          planned.push({
            field: {
              path: leaf.path,
              label: amountLabel(role, verb, leaf),
              format: "tokenAmount",
              params: {
                tokenPath: paired.tokenPath,
                ...(chainIdPath ? { chainIdPath } : {}),
              },
            },
            role,
            group,
            order: c.order,
            bound: role.bound,
          })
          if (chainIdPath)
            note(
              `${leaf.path} is counted in a token on the chain at ${chainIdPath.slice(2)}, not on this one; a wallet needs that chain's token list to show it.`
            )
          break
        }
        const selfToken =
          traits.token && !(traits.vault && leaf.words.includes("assets"))
        if (selfToken) {
          planned.push({
            field: {
              path: leaf.path,
              label: amountLabel(role, verb, leaf),
              format: "tokenAmount",
              params: { tokenPath: "@.to" },
            },
            role,
            group,
            order: c.order,
            bound: role.bound,
          })
          note(
            `${leaf.path} has no token parameter, so it is counted in the contract's own token (@.to).`
          )
          break
        }
        planned.push({
          field: { path: leaf.path, label: humanize(leaf.name), format: "raw" },
          role,
          group,
          order: c.order,
        })
        note(
          `${leaf.path} looks like an amount, but no token parameter goes with it: it is shown raw, in base units.`
        )
        break
      }
      case "token":
      case "chain":
        // Tokens wait for the pairing; chain ids are placed below.
        break
      case "recipient":
      case "spender":
      case "account":
        if (leaf.type === "bytes32" && role.kind === "recipient" && bridgeTo) {
          planned.push({
            field: {
              path: leaf.path,
              label: addressLabel(leaf, role.kind),
              format: "raw",
            },
            role,
            group: 3,
            order: c.order,
          })
          note(
            `${leaf.path} is a bytes32 recipient on the destination chain, which need not be an EVM address: it is shown raw.`
          )
          break
        }
        planned.push({
          field: {
            path: leaf.path,
            label: addressLabel(leaf, role.kind),
            format: "addressName",
            params: ADDRESS_PARAMS,
          },
          role,
          group: 3,
          order: c.order,
        })
        break
      case "date":
        planned.push({
          field: {
            path: leaf.path,
            label: leaf.name === "deadline" ? "Deadline" : humanize(leaf.name),
            format: "date",
            params: { encoding: "timestamp" },
          },
          role,
          group: 3,
          order: c.order,
        })
        break
      case "duration":
        planned.push({
          field: {
            path: leaf.path,
            label: humanize(leaf.name),
            format: "duration",
          },
          role,
          group: 3,
          order: c.order,
        })
        break
      case "call": {
        const callee = calleeFor(c, classified, described)
        if (callee) {
          planned.push({
            field: {
              path: leaf.path,
              label: CALL_WORDS.has(leaf.name.toLowerCase())
                ? "Action"
                : humanize(leaf.name),
              format: "calldata",
              params: callee,
            },
            role,
            group: 3,
            order: c.order,
          })
          note(
            `${leaf.path} is a call to ${callee.calleePath}: a wallet shows it through that contract's descriptor.`
          )
        } else {
          planned.push({
            field: {
              path: leaf.path,
              label: humanize(leaf.name),
              format: "raw",
            },
            role,
            group: 3,
            order: c.order,
          })
          note(
            `${leaf.path} looks like call data, but no parameter names the contract it calls: it is shown raw.`
          )
        }
        break
      }
      case "signature":
        hide(c, "a signature is not for reading")
        break
      case "unsupported":
        hide(c, `the draft does not display ${leaf.unsupported ?? "it"}`)
        break
      case "callee":
      case "other":
        planned.push({
          field:
            leaf.type === "address"
              ? {
                  path: leaf.path,
                  label: humanize(leaf.name),
                  format: "addressName",
                  params: ADDRESS_PARAMS,
                }
              : { path: leaf.path, label: humanize(leaf.name), format: "raw" },
          role,
          group: 3,
          order: c.order,
        })
        if (leaf.type === "bytes" || leaf.type === "string")
          note(`${leaf.path} (${leaf.type}) is shown raw.`)
        break
    }
  }

  for (const c of chains) {
    const place = c.role.kind === "chain" ? c.role.place : undefined
    planned.push({
      field: {
        path: c.leaf.path,
        label: chainLabel(c.leaf, place),
        format: "chainId",
      },
      role: c.role,
      group: 3,
      order: c.order,
    })
  }

  for (const c of tokens) {
    if (used.has(c.leaf.path)) {
      hide(c, "the amount counted in it shows its symbol")
      continue
    }
    const side = c.role.kind === "token" ? c.role.side : undefined
    const chainIdPath = chainPathFor(side, scoped(chains, c.leaf.scope))
    planned.push({
      field: {
        path: c.leaf.path,
        label: humanize(c.leaf.name),
        format: "tokenTicker",
        ...(chainIdPath ? { params: { chainIdPath } } : {}),
      },
      role: c.role,
      group: 3,
      order: c.order,
    })
  }

  if (isPayable(described.fn)) planned.push(nativeValue(planned, verb))
  nameNativeTwins(planned, traits.nativeSymbol)

  planned.sort((a, b) => a.group - b.group || a.order - b.order)
  const interpolatedIntent = interpolate(verb, planned)
  return {
    intent: verb.intent,
    fields: planned.map((p) => ({ ...p.field, label: fit(p.field.label) })),
    ...(interpolatedIntent ? { interpolatedIntent } : {}),
  }
}

function classify(leaf: Leaf): Role {
  if (leaf.unsupported) return { kind: "unsupported" }
  const has = (set: ReadonlySet<string>) => leaf.words.some((w) => set.has(w))
  const type = leaf.type
  if (
    SIGNATURE_NAMES.has(leaf.name) &&
    (type === "uint8" || type === "bytes32")
  )
    return { kind: "signature" }
  if (has(SIGNATURE_WORDS) && type.startsWith("bytes"))
    return { kind: "signature" }
  if (type === "address" || type === "bytes32") {
    const role = addressRole(leaf)
    if (role) return role
    return type === "address" && has(CALLEE_WORDS)
      ? { kind: "callee" }
      : { kind: "other" }
  }
  if (type.startsWith("uint") || type.startsWith("int")) {
    if (has(DURATION_WORDS)) return { kind: "duration" }
    if (isDate(leaf.words)) return { kind: "date" }
    if (
      leaf.words.includes("chain") &&
      (leaf.words.includes("id") || leaf.words.includes("ids"))
    )
      return {
        kind: "chain",
        ...(has(ORIGIN_CHAIN_WORDS)
          ? { place: "origin" as const }
          : has(DESTINATION_CHAIN_WORDS)
            ? { place: "destination" as const }
            : {}),
      }
    if (isAmount(leaf.words)) {
      const side = sideOf(leaf.words)
      return {
        kind: "amount",
        native: has(NATIVE_WORDS),
        bound: has(MIN_WORDS) ? "min" : has(MAX_WORDS) ? "max" : "exact",
        ...(side ? { side } : {}),
      }
    }
    return { kind: "other" }
  }
  if (type === "bytes" && has(CALL_WORDS)) return { kind: "call" }
  return { kind: "other" }
}

function addressRole(leaf: Leaf): Role | undefined {
  const has = (set: ReadonlySet<string>) => leaf.words.some((w) => set.has(w))
  const tokenish =
    has(TOKEN_WORDS) ||
    (leaf.array && (leaf.name === "path" || leaf.name === "route"))
  if (tokenish && !has(PERSON_WORDS)) {
    const side = sideOf(leaf.words)
    return { kind: "token", ...(side ? { side } : {}) }
  }
  if (has(RECIPIENT_WORDS)) return { kind: "recipient" }
  if (has(SPENDER_WORDS)) return { kind: "spender" }
  if (has(ACCOUNT_WORDS)) return { kind: "account" }
  return undefined
}

/** The side a function's name says is native currency: "ForETH" is what comes out, "ETHFor" what goes in. */
function nativeSideOf(name: string): Side | undefined {
  const ws = words(name)
  const at = ws.indexOf("for")
  if (at < 0) return undefined
  if (ws.slice(at + 1).some((w) => NATIVE_WORDS.has(w))) return "out"
  if (ws.slice(0, at).some((w) => NATIVE_WORDS.has(w))) return "in"
  return undefined
}

function isDate(ws: readonly string[]): boolean {
  if (ws.some((w) => DATE_WORDS.has(w))) return true
  if (
    ws[0] === "valid" &&
    ["to", "until", "after", "before", "from"].includes(ws[1] ?? "")
  )
    return true
  return ws.includes("time") && !ws.includes("lock")
}

function isAmount(ws: readonly string[]): boolean {
  if (ws.some((w) => AMOUNT_WORDS.has(w))) return true
  const bounded = ws.some((w) => MIN_WORDS.has(w) || MAX_WORDS.has(w))
  return bounded && ws.some((w) => DIRECTION[w] !== undefined)
}

function sideOf(ws: readonly string[]): Side | undefined {
  for (const w of ws) {
    const side = DIRECTION[w]
    if (side) return side
  }
  return undefined
}

function rest(ws: readonly string[], strip: ReadonlySet<string>): string {
  return ws
    .filter((w) => !strip.has(w) && DIRECTION[w] === undefined)
    .sort()
    .join(" ")
}

/** The candidates of a scope: its own members first, else the top level. */
function scoped(all: readonly Classified[], scope: string): Classified[] {
  const own = all.filter((c) => c.leaf.scope === scope)
  return own.length > 0 ? own : all.filter((c) => c.leaf.scope === "")
}

interface Pairing {
  readonly tokenPath: string
  readonly token?: Leaf
  readonly side?: Side
}

/** The token an amount is counted in: amountIn and tokenIn, amount0 and token0, a lone amount and a lone token. */
function pair(
  amount: Classified,
  role: { readonly side?: Side },
  tokens: readonly Classified[]
): Pairing | undefined {
  const sideOfToken = (c: Classified) =>
    c.role.kind === "token" ? c.role.side : undefined
  const of = (c: Classified): Pairing => {
    const side = sideOfToken(c) ?? role.side
    return {
      tokenPath:
        c.leaf.type === "bytes32" ? `${c.leaf.path}.[12:32]` : c.leaf.path,
      token: c.leaf,
      ...(side ? { side } : {}),
    }
  }
  const scalars = tokens.filter((c) => !c.leaf.array)
  const arrays = tokens.filter((c) => c.leaf.array)
  const amountRest = rest(amount.leaf.words, AMOUNT_STRIP)
  const tokenRest = (c: Classified) => rest(c.leaf.words, TOKEN_STRIP)
  const one = (list: Classified[]) => (list.length === 1 ? list[0] : undefined)
  // Liquidity is counted in the pool's own token, which no parameter names.
  const strict = amount.leaf.words.some((w) => w === "liquidity" || w === "lp")

  // amounts.[] and tokens.[]: element by element.
  const list = one(arrays)
  if (amount.leaf.array && list)
    return { tokenPath: list.leaf.path, token: list.leaf }

  if (role.side !== undefined || amountRest !== "") {
    const exact = one(
      scalars.filter(
        (c) => sideOfToken(c) === role.side && tokenRest(c) === amountRest
      )
    )
    if (exact) return of(exact)
  }
  if (strict) return undefined
  // address[] path: the first token is sold, the last one bought.
  if (role.side && list) {
    const base = list.leaf.path.slice(0, -".[]".length)
    return {
      tokenPath: `${base}.[${role.side === "in" ? 0 : -1}]`,
      token: list.leaf,
      side: role.side,
    }
  }
  if (role.side) {
    const bySide = one(scalars.filter((c) => sideOfToken(c) === role.side))
    if (bySide) return of(bySide)
  }
  if (amountRest !== "") {
    const byRest = one(scalars.filter((c) => tokenRest(c) === amountRest))
    if (byRest) return of(byRest)
  }
  const lone = one(scalars)
  if (lone && arrays.length === 0) {
    const side = sideOfToken(lone)
    if (!role.side || !side || side === role.side) return of(lone)
  }
  return undefined
}

/**
 * The chain a token is on, when it is not this one: what a bridge deposit
 * sends out lands on the destination chain, and what a fill pays back came
 * in on the origin chain.
 */
function chainPathFor(
  side: Side | undefined,
  chains: readonly Classified[]
): string | undefined {
  const place = (want: "origin" | "destination") =>
    chains.find((c) => c.role.kind === "chain" && c.role.place === want)
  const origin = place("origin")
  const destination = place("destination")
  if (side === "in" && origin) return `#.${origin.leaf.path}`
  if (side === "out" && destination) return `#.${destination.leaf.path}`
  return undefined
}

function calleeFor(
  call: Classified,
  all: readonly Classified[],
  described: DescribedFunction
): { calleePath: string; amountPath?: string } | undefined {
  const fnWords = described.fn.name.toLowerCase()
  if (
    call.leaf.array &&
    (fnWords.includes("multicall") || fnWords.includes("aggregate"))
  )
    return {
      calleePath: "@.to",
      ...(isPayable(described.fn) ? { amountPath: "@.value" } : {}),
    }
  const sibling = all.find(
    (c) =>
      c.role.kind === "callee" &&
      c.leaf.scope === call.leaf.scope &&
      !c.leaf.array
  )
  return sibling ? { calleePath: sibling.leaf.path } : undefined
}

function groupOf(role: { readonly side?: Side }, verb: Verb): number {
  if (role.side === "in") return 0
  if (role.side === "out") return 1
  if (verb.noun && !verb.receives) return 0
  if (verb.receives) return 1
  return 2
}

function amountLabel(
  role: { readonly side?: Side; readonly bound: Bound },
  verb: Verb,
  leaf: Leaf
): string {
  if (!verb.noun) return humanize(leaf.name)
  const lead =
    role.bound === "min"
      ? "Minimum"
      : role.bound === "max"
        ? "Maximum"
        : "Amount"
  if (role.side === "out") return `${lead} to receive`
  if (verb.receives) {
    if (role.side === "in") return `${lead} to send`
    return role.bound === "min"
      ? "Minimum to receive"
      : `${lead} to ${verb.noun}`
  }
  return `${lead} to ${verb.noun}`
}

function addressLabel(
  leaf: Leaf,
  kind: "recipient" | "spender" | "account"
): string {
  if (kind === "recipient") {
    if (leaf.words.includes("behalf")) return "On behalf of"
    const others = leaf.words.filter(
      (w) => !["to", "recipient", "receiver", "address", "addr"].includes(w)
    )
    if (others.length === 0) return "Recipient"
  }
  if (kind === "spender" && leaf.name === "spender") return "Spender"
  return humanize(leaf.name)
}

function chainLabel(
  leaf: Leaf,
  place: "origin" | "destination" | undefined
): string {
  if (place === "destination") return "Destination chain"
  if (place === "origin") return "Origin chain"
  const others = leaf.words.filter(
    (w) => w !== "chain" && w !== "id" && w !== "ids"
  )
  return sentence([...others, "chain"].join(" "))
}

/** The `@.value` field of a payable function: what the signer sends in native currency. */
function nativeValue(planned: readonly Planned[], verb: Verb): Planned {
  const amounts = planned.filter(
    (p) => p.role.kind === "amount" && p.field.format !== "raw"
  )
  const firstIn = amounts.find((p) => p.group === 0)
  const exactOut =
    verb.intent === "Swap" &&
    !firstIn &&
    amounts.some((p) => p.group === 1 && p.bound === "exact")
  let label = "Value sent"
  let bound: Bound = "exact"
  if (verb.intent === "Add liquidity") {
    label = "Maximum to add"
    bound = "max"
  } else if (verb.noun && !verb.receives && !firstIn) {
    bound = exactOut ? "max" : "exact"
    label = `${exactOut ? "Maximum" : "Amount"} to ${verb.noun}`
  }
  return {
    field: { path: "@.value", label, format: "amount" },
    role: { kind: "amount", native: true, side: "in", bound },
    group: 0,
    order: firstIn ? firstIn.order + 0.5 : -1,
    bound,
  }
}

/**
 * "Maximum to add" twice, once in a token and once in ETH: the native one
 * becomes "Maximum ETH to add" (or "Maximum to add (native)" when the chains
 * of the deployments name their currency differently).
 */
function nameNativeTwins(
  planned: Planned[],
  nativeSymbol: string | undefined
): void {
  const shown = planned.filter((p) => p.field.visible === undefined)
  for (const [index, p] of planned.entries()) {
    if (p.field.format !== "amount" || p.field.visible !== undefined) continue
    const label = p.field.label
    const twin = shown.some((q) => q !== p && q.field.label === label)
    if (!twin) continue
    const [lead = "", ...tail] = label.split(" ")
    const renamed = !nativeSymbol
      ? `${label} (native)`
      : lead === "Amount"
        ? [nativeSymbol, ...tail].join(" ")
        : [lead, nativeSymbol, ...tail].join(" ")
    if (renamed.length > LABEL_MAX) continue
    planned[index] = { ...p, field: { ...p.field, label: renamed } }
  }
}

/**
 * The sentence a wallet shows: "Swap {amountIn} for at least {amountOutMin}".
 * It names only fields that are always shown, since a hidden field has no
 * value to put in it.
 */
function interpolate(
  verb: Verb,
  planned: readonly Planned[]
): string | undefined {
  // A list has no single value to put in a sentence.
  const shown = planned.filter(
    (p) => p.field.visible === undefined && !p.field.path.includes("[]")
  )
  const amounts = shown.filter(
    (p) =>
      p.role.kind === "amount" &&
      (p.field.format === "tokenAmount" || p.field.format === "amount")
  )
  const ins = amounts.filter((p) => p.group === 0)
  const outs = amounts.filter((p) => p.group === 1)
  const ref = (p: Planned) => `{${p.field.path}}`
  const find = (kind: Role["kind"]) => shown.find((p) => p.role.kind === kind)
  switch (verb.intent) {
    case "Swap": {
      const give = ins[0]
      const get = outs[0]
      if (!give && !get) return undefined
      let text = "Swap"
      if (give)
        text += `${give.bound === "max" ? " at most " : " "}${ref(give)}`
      if (get)
        text += ` for${get.bound === "min" ? " at least " : " "}${ref(get)}`
      return text
    }
    case "Add liquidity": {
      const added = ins.filter((p) => p.bound !== "min")
      if (added.length === 0) return undefined
      return `Add ${added.map((p) => `${p.bound === "max" ? "up to " : ""}${ref(p)}`).join(" and ")} as liquidity`
    }
    case "Remove liquidity": {
      const floors = outs.filter((p) => p.bound === "min")
      if (floors.length === 0) return undefined
      return `Remove liquidity for at least ${floors.map(ref).join(" and ")}`
    }
    case "Bridge": {
      const sent = ins.find((p) => p.field.path !== "@.value") ?? ins[0]
      if (!sent) return undefined
      const destination = shown.find(
        (p) => p.role.kind === "chain" && p.role.place === "destination"
      )
      return `Bridge ${ref(sent)}${destination ? ` to ${ref(destination)}` : ""}`
    }
    case "Approve": {
      const amount = amounts[0]
      const spender = find("spender")
      if (amount && spender)
        return `Approve ${ref(spender)} to spend ${ref(amount)}`
      return amount ? `Approve ${ref(amount)}` : undefined
    }
  }
  if (!verb.noun) return undefined
  const amount = verb.receives
    ? (outs[0] ?? amounts[0])
    : (ins[0] ?? amounts[0])
  if (!amount) return undefined
  const recipient = verb.noun === "send" ? find("recipient") : undefined
  return `${verb.intent} ${ref(amount)}${recipient ? ` to ${ref(recipient)}` : ""}`
}
