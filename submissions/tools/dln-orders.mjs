// What deBridge's DLN orders carry, for the deBridge pull request text and
// its tests. It reads the latest successful order creations at DlnSource
// (createSaltedOrder and createOrder) on each chain the tracker reads from
// the SQD Network portal, decodes them, and counts what a screen would have
// to show: the chains the orders go to, the tokens given, whether the parts
// an order can leave empty are set (a call to run on the destination chain,
// an affiliate fee, a permit, an allowed taker, a cancel beneficiary), and
// who holds the order's two authorities. With --pick n it prints, for each
// chain, the newest n orders to each EVM chain the tracker reads and to
// Solana, given in the native currency and in a token, the newest order with
// each part an order can leave empty set, and the newest n createOrder
// calls, read back from a public RPC in the form tracker/data/samples keeps
// a transaction: one JSON object per line, after "sample (<why it was
// picked>): ", for a cases file's samples (submissions/README.md). It also
// prints deBridge's own list of the chains DLN serves, from its API, whose
// ids name a destination chain where DLN numbers a chain itself. Read-only,
// network; runs in CI.
//
//   node submissions/tools/dln-orders.mjs [--count 300] [--minutes 3] [--pick 2]

import { parseArgs } from "node:util"
import {
  createPublicClient,
  decodeFunctionData,
  getAddress,
  http,
  parseAbi,
  toFunctionSelector,
} from "viem"
import { latestCalls } from "./portal.mjs"

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "300" },
    minutes: { type: "string", default: "3" },
    pick: { type: "string", default: "0" },
  },
})
const COUNT = Number(values.count)
const BUDGET_MS = Number(values.minutes) * 60_000
const PICK = Number(values.pick)

// DlnSource, at one address on every EVM chain DLN serves
// (github.com/debridge-finance/dln-contracts, README, "Prod addresses").
const DLN_SOURCE = "0xeF4fB24aD0916217251F553c0596F8Edc630EB66"
// The tracker's chains and public endpoints (verify-txs.mjs).
const RPC = {
  1: "https://ethereum-rpc.publicnode.com",
  10: "https://optimism-rpc.publicnode.com",
  8453: "https://base-rpc.publicnode.com",
  42161: "https://arbitrum-one-rpc.publicnode.com",
}
const CHAINS = Object.keys(RPC).map(Number)
const NATIVE = "0x0000000000000000000000000000000000000000"
// DLN's own number for Solana (@debridge-finance/dln-client, ChainId).
const SOLANA = 7565164

const ORDER =
  "(address giveTokenAddress, uint256 giveAmount, bytes takeTokenAddress, uint256 takeAmount, uint256 takeChainId, bytes receiverDst, address givePatchAuthoritySrc, bytes orderAuthorityAddressDst, bytes allowedTakerDst, bytes externalCall, bytes allowedCancelBeneficiarySrc)"
const abi = parseAbi([
  `function createSaltedOrder(${ORDER} _orderCreation, uint64 _salt, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope, bytes _metadata) payable returns (bytes32)`,
  `function createOrder(${ORDER} _orderCreation, bytes _affiliateFee, uint32 _referralCode, bytes _permitEnvelope) payable returns (bytes32)`,
  "function globalFixedNativeFee() view returns (uint88)",
  "function globalTransferFeeBps() view returns (uint16)",
])
const FUNCTIONS = abi
  .filter((item) => item.name.startsWith("create"))
  .map((fn) => ({ fn, selector: toFunctionSelector(fn) }))

const day = (seconds) =>
  new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")
const percent = (n, of) => (of === 0 ? "-" : `${Math.round((100 * n) / of)}%`)
const short = (hex) =>
  hex.length > 14 ? `${hex.slice(0, 8)}…${hex.slice(-4)}` : hex
const lower = (hex) => hex.toLowerCase()

// Counts of values, most common first, as "value n (share)".
function top(values, limit = 8) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, n]) => `${value} ${n} (${percent(n, values.length)})`)
    .join(", ")
}

// deBridge's list of the chains DLN serves: its own id for each, and the
// chain's id where DLN numbers it itself.
try {
  const response = await fetch(
    "https://dln.debridge.finance/v1.0/supported-chains-info",
    { signal: AbortSignal.timeout(30_000) }
  )
  const body = await response.json()
  console.log(
    "## The chains DLN serves (dln.debridge.finance/v1.0/supported-chains-info)"
  )
  console.log()
  if (!Array.isArray(body.chains))
    console.log(JSON.stringify(body).slice(0, 4000))
  for (const chain of body.chains ?? [])
    console.log(
      `- ${chain.chainId}: ${chain.chainName}` +
        (chain.originalChainId !== undefined &&
        chain.originalChainId !== chain.chainId
          ? ` (chain id ${chain.originalChainId})`
          : "")
    )
  console.log()
} catch (error) {
  console.log(
    `::warning::deBridge's chain list could not be read: ${error.message}`
  )
}

for (const chainId of CHAINS) {
  const client = createPublicClient({ transport: http(RPC[chainId]) })
  console.log(`## Chain ${chainId}`)
  console.log()
  try {
    const [fixedFee, transferFeeBps] = await Promise.all(
      ["globalFixedNativeFee", "globalTransferFeeBps"].map((functionName) =>
        client.readContract({ address: DLN_SOURCE, abi, functionName })
      )
    )
    console.log(
      `globalFixedNativeFee ${fixedFee} wei, globalTransferFeeBps ${transferFeeBps}`
    )
  } catch (error) {
    console.log(
      `The fees could not be read: ${error.shortMessage ?? error.message}`
    )
  }
  for (const { fn, selector } of FUNCTIONS) {
    let result
    try {
      result = await latestCalls(
        chainId,
        lower(DLN_SOURCE),
        selector,
        COUNT,
        BUDGET_MS
      )
    } catch (error) {
      console.log(`### ${fn.name}: not read, ${error.message}`)
      continue
    }
    const { calls, failed, since, until } = result
    console.log()
    console.log(
      `### ${fn.name}: ${calls.length} successful calls from ${new Set(calls.map((tx) => lower(tx.from))).size} senders, ${day(since)} to ${day(until)} UTC` +
        (calls.length === COUNT ? ` (the latest ${COUNT})` : "") +
        `; ${failed} failed`
    )
    if (calls.length === 0) continue
    const orders = []
    for (const tx of calls) {
      try {
        const { args } = decodeFunctionData({ abi: [fn], data: tx.input })
        const named = Object.fromEntries(
          fn.inputs.map((input, i) => [input.name, args[i]])
        )
        orders.push({ tx, order: named._orderCreation, ...named })
      } catch {
        console.log(`- ${tx.hash}: does not decode`)
      }
    }
    const of = (test) => orders.filter(test).length
    const n = orders.length
    const sender = ({ tx }) => lower(tx.from)
    const line = (label, text) => console.log(`- ${label}: ${text}`)
    line(
      "destination chain (takeChainId)",
      top(
        orders.map(({ order }) => String(order.takeChainId)),
        20
      )
    )
    line(
      "token given",
      top(
        orders.map(({ order }) =>
          order.giveTokenAddress === NATIVE
            ? "native"
            : lower(order.giveTokenAddress)
        )
      )
    )
    line(
      "length of takeTokenAddress, receiverDst, orderAuthorityAddressDst",
      top(
        orders.map(({ order }) =>
          [
            order.takeTokenAddress,
            order.receiverDst,
            order.orderAuthorityAddressDst,
          ]
            .map((hex) => (hex.length - 2) / 2)
            .join("/")
        )
      )
    )
    line(
      "externalCall set",
      `${of(({ order }) => order.externalCall !== "0x")} of ${n}`
    )
    line("affiliate fee set", `${of((o) => o._affiliateFee !== "0x")} of ${n}`)
    line(
      "permit envelope set",
      `${of((o) => o._permitEnvelope !== "0x")} of ${n}`
    )
    if (fn.name === "createSaltedOrder")
      line("metadata set", `${of((o) => o._metadata !== "0x")} of ${n}`)
    line(
      "allowedCancelBeneficiarySrc",
      top(
        orders.map((o) =>
          o.order.allowedCancelBeneficiarySrc === "0x"
            ? "empty"
            : lower(o.order.allowedCancelBeneficiarySrc) === sender(o)
              ? "the sender"
              : "another address"
        )
      )
    )
    line(
      "orderAuthorityAddressDst",
      top(
        orders.map((o) =>
          lower(o.order.orderAuthorityAddressDst) === sender(o)
            ? "the sender"
            : lower(o.order.orderAuthorityAddressDst) ===
                lower(o.order.receiverDst)
              ? "the recipient"
              : "another address"
        )
      )
    )
    line(
      "receiverDst",
      top(
        orders.map((o) =>
          lower(o.order.receiverDst) === sender(o)
            ? "the sender"
            : "another address"
        )
      )
    )
    line(
      "givePatchAuthoritySrc",
      top(
        orders.map((o) =>
          lower(o.order.givePatchAuthoritySrc) === sender(o)
            ? "the sender"
            : lower(o.order.givePatchAuthoritySrc)
        )
      )
    )
    line(
      "allowedTakerDst",
      top(
        orders.map(({ order }) =>
          order.allowedTakerDst === "0x"
            ? "empty"
            : short(lower(order.allowedTakerDst))
        )
      )
    )
    line(
      "value sent less the amount given in the native currency",
      top(
        orders.map(({ tx, order }) =>
          String(
            BigInt(tx.value) -
              (order.giveTokenAddress === NATIVE ? order.giveAmount : 0n)
          )
        )
      )
    )
    line("referral code", top(orders.map((o) => String(o._referralCode))))

    // The newest orders to each EVM chain the tracker reads and to Solana,
    // given in the native currency and in a token, the newest with each part
    // an order can leave empty set, and the newest createOrder calls, read
    // back in full.
    if (PICK > 0) {
      const picks =
        fn.name === "createOrder"
          ? [["createOrder", () => true, PICK]]
          : [
              ...[...CHAINS, SOLANA].flatMap((destination) =>
                [true, false].map((native) => [
                  `to chain ${destination}, ${native ? "native currency" : "a token"} given`,
                  ({ order }) =>
                    order.takeChainId === BigInt(destination) &&
                    (order.giveTokenAddress === NATIVE) === native,
                  PICK,
                ])
              ),
              ...[
                ["externalCall", ({ order }) => order.externalCall !== "0x"],
                ["affiliate fee", (o) => o._affiliateFee !== "0x"],
                ["permit", (o) => o._permitEnvelope !== "0x"],
                [
                  "allowedTakerDst",
                  ({ order }) => order.allowedTakerDst !== "0x",
                ],
                [
                  "allowedCancelBeneficiarySrc",
                  ({ order }) => order.allowedCancelBeneficiarySrc !== "0x",
                ],
              ].map(([part, test]) => [`${part} set`, test, 1]),
            ]
      const picked = new Map()
      for (const [why, test, n] of picks)
        for (const o of orders.filter(test).slice(0, n))
          if (!picked.has(o.tx.hash)) picked.set(o.tx.hash, { ...o, why })
      for (const { tx, why } of picked.values()) {
        let full
        try {
          full = await client.getTransaction({ hash: tx.hash })
        } catch (error) {
          console.log(
            `- ${tx.hash}: not read back, ${error.shortMessage ?? error.message}`
          )
          continue
        }
        const sample = {
          hash: full.hash,
          chainId,
          blockNumber: Number(full.blockNumber),
          timestamp: tx.time,
          from: getAddress(full.from),
          to: getAddress(full.to),
          value: full.value.toString(),
          input: full.input,
          nonce: full.nonce,
          gas: full.gas.toString(),
          type: full.type,
          ...(full.gasPrice !== undefined
            ? { gasPrice: full.gasPrice.toString() }
            : {}),
          ...(full.maxFeePerGas !== undefined
            ? { maxFeePerGas: full.maxFeePerGas.toString() }
            : {}),
          ...(full.maxPriorityFeePerGas !== undefined
            ? { maxPriorityFeePerGas: full.maxPriorityFeePerGas.toString() }
            : {}),
          ...(full.accessList && full.accessList.length > 0
            ? {
                accessList: full.accessList.map((entry) => ({
                  address: getAddress(entry.address),
                  storageKeys: entry.storageKeys,
                })),
              }
            : {}),
          status: "success",
        }
        console.log(`sample (${why}): ${JSON.stringify(sample)}`)
      }
    }
  }
  console.log()
}
