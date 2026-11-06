import { describe, expect, it } from "vitest"
import { parseAbiItem, type AbiFunction } from "viem"
import { describe as describeFunction } from "../../src/draft/abi.js"
import { draftFormat, type ContractTraits } from "../../src/draft/heuristics.js"
import { fit, humanize, words } from "../../src/draft/words.js"
import type { DescriptorField } from "../../src/draft/types.js"

const PLAIN: ContractTraits = {
  token: false,
  vault: false,
  nativeSymbol: "ETH",
}
const TOKEN: ContractTraits = { token: true, vault: false, nativeSymbol: "ETH" }
const ADDRESS_PARAMS = {
  types: ["eoa", "contract"],
  sources: ["local", "ens"],
}

function draft(signature: string, traits: ContractTraits = PLAIN) {
  const fn = parseAbiItem(signature) as AbiFunction
  const described = describeFunction(fn)
  const review: string[] = []
  const format = draftFormat(described, traits, review)
  const field = (path: string): DescriptorField => {
    const found = format.fields.find((f) => f.path === path)
    if (!found) throw new Error(`no field at ${path}`)
    return found
  }
  return { described, format, review, field }
}

/** Every parameter is a field, shown or hidden on purpose. */
function expectEveryParameter(result: ReturnType<typeof draft>): void {
  const paths = new Set(result.format.fields.map((f) => f.path))
  for (const leaf of result.described.leaves) expect(paths).toContain(leaf.path)
  for (const f of result.format.fields.filter((f) => f.visible === "never"))
    expect(result.review.join("\n")).toContain(`${f.path} is hidden`)
}

describe("words", () => {
  it("splits identifiers into lowercase words, digits apart", () => {
    expect(words("amountOutMin")).toEqual(["amount", "out", "min"])
    expect(words("amountETHMin")).toEqual(["amount", "eth", "min"])
    expect(words("amount0Desired")).toEqual(["amount", "0", "desired"])
    expect(words("_srcToken")).toEqual(["src", "token"])
  })

  it("humanizes in sentence case and keeps acronyms", () => {
    expect(humanize("depositId")).toBe("Deposit ID")
    expect(humanize("amountETHMin")).toBe("Amount ETH min")
    expect(humanize("sqrtPriceLimitX96")).toBe("Sqrt price limit X96")
  })

  it("shortens a label past 20 characters, and only then", () => {
    expect(fit("Exclusivity parameter")).toBe("Exclusivity param")
    expect(fit("Minimum ETH to receive")).toBe("Min ETH to receive")
    expect(fit("Minimum to receive")).toBe("Minimum to receive")
  })
})

describe("draftFormat: amounts and their tokens", () => {
  it("pairs amountIn with tokenIn and amountOutMinimum with tokenOut inside a tuple", () => {
    const result = draft(
      "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"
    )
    expect(result.described.key).toBe(
      "exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 deadline,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params)"
    )
    expect(result.field("params.amountIn")).toEqual({
      path: "params.amountIn",
      label: "Amount to send",
      format: "tokenAmount",
      params: { tokenPath: "params.tokenIn" },
    })
    expect(result.field("params.amountOutMinimum")).toEqual({
      path: "params.amountOutMinimum",
      label: "Minimum to receive",
      format: "tokenAmount",
      params: { tokenPath: "params.tokenOut" },
    })
    expect(result.field("params.recipient")).toEqual({
      path: "params.recipient",
      label: "Recipient",
      format: "addressName",
      params: ADDRESS_PARAMS,
    })
    expect(result.field("params.deadline")).toEqual({
      path: "params.deadline",
      label: "Deadline",
      format: "date",
      params: { encoding: "timestamp" },
    })
    expect(result.field("params.tokenIn").visible).toBe("never")
    expect(result.field("params.tokenOut").visible).toBe("never")
    expect(result.format.intent).toBe("Swap")
    expect(result.format.interpolatedIntent).toBe(
      "Swap {params.amountIn} for at least {params.amountOutMinimum}"
    )
    expectEveryParameter(result)
  })

  it("pairs amount0 with token0 and amount1 with token1", () => {
    const result = draft(
      "function addLiquidity(address token0, address token1, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address to, uint256 deadline)"
    )
    expect(result.field("amount0Desired").params).toEqual({
      tokenPath: "token0",
    })
    expect(result.field("amount1Desired").params).toEqual({
      tokenPath: "token1",
    })
    expect(result.field("amount0Min").params).toEqual({ tokenPath: "token0" })
    expect(result.field("amount1Min").params).toEqual({ tokenPath: "token1" })
    expect(result.field("amount0Desired").label).toBe("Maximum to add")
    expect(result.field("amount0Min").label).toBe("Minimum to add")
    expect(result.format.intent).toBe("Add liquidity")
    expect(result.format.interpolatedIntent).toBe(
      "Add up to {amount0Desired} and up to {amount1Desired} as liquidity"
    )
    expectEveryParameter(result)
  })

  it("pairs srcAmount with srcToken, and what returns with the dst token", () => {
    const result = draft(
      "function swap(address srcToken, address dstToken, uint256 srcAmount, uint256 minReturnAmount, address dstReceiver)"
    )
    expect(result.field("srcAmount").params).toEqual({ tokenPath: "srcToken" })
    expect(result.field("minReturnAmount")).toMatchObject({
      label: "Minimum to receive",
      params: { tokenPath: "dstToken" },
    })
    expect(result.field("dstReceiver").format).toBe("addressName")
    expectEveryParameter(result)
  })

  it("pairs a lone amount with a lone token", () => {
    const result = draft(
      "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"
    )
    expect(result.field("amount")).toEqual({
      path: "amount",
      label: "Amount to supply",
      format: "tokenAmount",
      params: { tokenPath: "asset" },
    })
    expect(result.field("onBehalfOf").label).toBe("On behalf of")
    expect(result.format.interpolatedIntent).toBe("Supply {amount}")
    expectEveryParameter(result)
  })

  it("reads an address[] path: the first token is sold, the last bought", () => {
    const result = draft(
      "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)"
    )
    expect(result.field("amountIn").params).toEqual({ tokenPath: "path.[0]" })
    expect(result.field("amountOutMin").params).toEqual({
      tokenPath: "path.[-1]",
    })
    expect(result.field("path.[]")).toEqual({
      path: "path.[]",
      label: "Path",
      visible: "never",
    })
    expect(result.format.fields.map((f) => f.label)).toEqual([
      "Amount to send",
      "Minimum to receive",
      "Recipient",
      "Deadline",
      "Path",
    ])
    expectEveryParameter(result)
  })

  it("counts an amount with no token in the contract's own token when it is one", () => {
    const result = draft(
      "function transfer(address to, uint256 amount) returns (bool)",
      TOKEN
    )
    expect(result.field("amount").params).toEqual({ tokenPath: "@.to" })
    expect(result.format.interpolatedIntent).toBe("Transfer {amount} to {to}")
    const approve = draft(
      "function approve(address spender, uint256 amount) returns (bool)",
      TOKEN
    )
    expect(approve.field("spender").label).toBe("Spender")
    expect(approve.format.interpolatedIntent).toBe(
      "Approve {spender} to spend {amount}"
    )
  })

  it("shows liquidity raw: no parameter names the pool's token", () => {
    const result = draft(
      "function removeLiquidityETH(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) returns (uint256 amountToken, uint256 amountETH)"
    )
    expect(result.field("liquidity").format).toBe("raw")
    expect(result.field("amountTokenMin").params).toEqual({
      tokenPath: "token",
    })
    expect(result.field("amountETHMin").format).toBe("amount")
    expect(result.review.join("\n")).toContain(
      "liquidity looks like an amount, but no token parameter goes with it"
    )
  })

  it("pairs arrays element by element, in tuples and side by side", () => {
    const legs = draft(
      "function multiSwap((address tokenIn, uint256 amountIn)[] legs, address recipient)"
    )
    expect(legs.field("legs.[].amountIn").params).toEqual({
      tokenPath: "legs.[].tokenIn",
    })
    expect(legs.field("legs.[].tokenIn").visible).toBe("never")
    // A list has no single value for a sentence.
    expect(legs.format.interpolatedIntent).toBeUndefined()
    expectEveryParameter(legs)

    const batch = draft(
      "function batchDeposit(address[] tokens, uint256[] amounts)"
    )
    expect(batch.field("amounts.[]").params).toEqual({ tokenPath: "tokens.[]" })
    expectEveryParameter(batch)
  })
})

describe("draftFormat: native currency", () => {
  it("shows the value of a payable swap as the amount sent", () => {
    const result = draft(
      "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)"
    )
    expect(result.format.fields[0]).toEqual({
      path: "@.value",
      label: "Amount to send",
      format: "amount",
    })
    expect(result.format.interpolatedIntent).toBe(
      "Swap {@.value} for at least {amountOutMin}"
    )
  })

  it("counts what a swap ...ForETH returns in native currency", () => {
    const result = draft(
      "function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)"
    )
    expect(result.field("amountIn").params).toEqual({ tokenPath: "path.[0]" })
    expect(result.field("amountOutMin")).toEqual({
      path: "amountOutMin",
      label: "Minimum to receive",
      format: "amount",
    })
    expect(result.format.fields.some((f) => f.path === "@.value")).toBe(false)
  })

  it("names the native one of two fields that share a label", () => {
    const result = draft(
      "function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)"
    )
    expect(
      result.format.fields.map((f) => [f.path, f.label, f.format ?? null])
    ).toEqual([
      ["amountTokenDesired", "Maximum to add", "tokenAmount"],
      ["@.value", "Maximum ETH to add", "amount"],
      ["amountTokenMin", "Minimum to add", "tokenAmount"],
      ["amountETHMin", "Minimum ETH to add", "amount"],
      ["to", "Recipient", "addressName"],
      ["deadline", "Deadline", "date"],
      ["token", "Token", null],
    ])
    expect(result.format.interpolatedIntent).toBe(
      "Add up to {amountTokenDesired} and up to {@.value} as liquidity"
    )
  })
})

describe("draftFormat: bridges, calls, signatures, time", () => {
  it("reads a bridge deposit: bytes32 tokens, the destination chain, a foreign recipient", () => {
    const result = draft(
      "function deposit(bytes32 depositor, bytes32 recipient, bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 destinationChainId, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) payable"
    )
    expect(result.field("inputAmount")).toEqual({
      path: "inputAmount",
      label: "Amount to bridge",
      format: "tokenAmount",
      params: { tokenPath: "inputToken.[12:32]" },
    })
    expect(result.field("outputAmount")).toEqual({
      path: "outputAmount",
      label: "Amount to receive",
      format: "tokenAmount",
      params: {
        tokenPath: "outputToken.[12:32]",
        chainIdPath: "#.destinationChainId",
      },
    })
    expect(result.field("destinationChainId")).toEqual({
      path: "destinationChainId",
      label: "Destination chain",
      format: "chainId",
    })
    expect(result.field("depositor").format).toBe("addressName")
    // On the destination chain it need not be an EVM address.
    expect(result.field("recipient").format).toBe("raw")
    expect(result.field("fillDeadline").format).toBe("date")
    expect(result.field("exclusivityParameter").label).toBe("Exclusivity param")
    expect(result.format.intent).toBe("Bridge")
    expect(result.format.interpolatedIntent).toBe(
      "Bridge {inputAmount} to {destinationChainId}"
    )
    expectEveryParameter(result)
  })

  it("shows the calls of a multicall through the contract they call", () => {
    const result = draft(
      "function multicall(bytes[] data) payable returns (bytes[] results)"
    )
    expect(result.field("data.[]")).toEqual({
      path: "data.[]",
      label: "Action",
      format: "calldata",
      params: { calleePath: "@.to", amountPath: "@.value" },
    })
  })

  it("hides a signature and says so", () => {
    const result = draft(
      "function removeLiquidityETHWithPermit(address token, uint256 liquidity, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline, bool approveMax, uint8 v, bytes32 r, bytes32 s) returns (uint256 amountToken, uint256 amountETH)"
    )
    for (const path of ["v", "r", "s"]) {
      expect(result.field(path).visible).toBe("never")
      expect(result.review.join("\n")).toContain(
        `${path} is hidden: a signature is not for reading`
      )
    }
    expectEveryParameter(result)
  })

  it("formats durations as durations", () => {
    const result = draft(
      "function lock(uint256 amount, uint256 duration)",
      TOKEN
    )
    expect(result.field("duration")).toEqual({
      path: "duration",
      label: "Duration",
      format: "duration",
    })
  })

  it("is deterministic", () => {
    const signature =
      "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)"
    expect(draft(signature).format).toEqual(draft(signature).format)
  })
})
