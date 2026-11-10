<!-- Pull request to ethereum/clear-signing-erc7730-registry, from the files
under submissions/registry/pancakeswap/. Title on the first line, body below it. -->

# pancakeswap: add Smart Router calldata descriptor (Ethereum, Base, Arbitrum One)

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with PancakeSwap. PancakeSwap has not reviewed it.

Adds `calldata-SmartRouter.json`, a calldata descriptor for PancakeSwap's
Smart Router (v3), on three chains:

| Chain                | Address                                      |
| -------------------- | -------------------------------------------- |
| Ethereum (1)         | `0x13f4EA83D0bd40E75C8222255bc855a974568Dd4` |
| Base (8453)          | `0x678Aa4bF4E210cf2166753e054d5b7c31cc7fa86` |
| Arbitrum One (42161) | `0x32226588378236Fd0c7c4053999F88aC0e5cAc77` |

They are the Smart Router addresses PancakeSwap lists for these chains in
`docs/pages/contracts/v3/addresses.md` of
[pancake-developer](https://github.com/pancakeswap/pancake-developer). None is
a proxy, Sourcify has the source of all three (contract `SmartRouter`), and
none is in the calldata index today.

## Scope

Calls among the latest 1,000 transactions to the router on each chain, or all
of the last 30 days' on Ethereum (442), read on 2026-11-06 from the SQD
Network portal, as calls (distinct senders). The described functions are in
bold.

| Function                            | Ethereum | Base         | Arbitrum One |
| ----------------------------------- | -------- | ------------ | ------------ |
| **`exactInputSingle`**              | 296 (16) | 479 (9)      | 77 (7)       |
| **`exactOutputSingle`**             | 2 (1)    | 497 (5)      |              |
| **`multicall(deadline, data)`**     | 48 (9)   | 19 (2)       | 253 (7)      |
| **`multicall(data)`**               | 21 (7)   | 3 (2)        | 116 (28)     |
| `exactInput`                        | 73 (7)   | 2 (1)        | 552 (22)     |
| `exactInputStableSwap`              |          |              | 2 (1)        |
| `0x414bf389`, not a router function | 2 (2)    |              |              |
| Transactions a day                  | about 15 | about 18,000 | about 41     |

**Described:** 1,811 of the 2,442 transactions at the top level: 367 of 442 on
Ethereum, 998 of 1,000 on Base and 446 of 1,000 on Arbitrum One. A batch's
screen is whole only when every action in it has a format; Batches, below,
counts them.

**Left out:**

- `exactInput` and `exactOutput`. The router encodes a multi-pool path as
  Uniswap V3 does, and a path's last token can be spoofed with appended
  bytes, which is why #3136 dropped these two functions from
  `calldata-UniswapV3Router02.json`. That leaves out the most called function
  on Arbitrum One.
- `exactInputStableSwap`: its 2 calls in the sample, from one sender, swap the
  router's own balance, which `amountIn` 0 stands for, so a screen would show
  an amount of 0. `exactOutputStableSwap` had no call.
- The functions that no transaction in the sample called, at the top level or
  in the sample's batches: the V2 swaps (`swapExactTokensForTokens`,
  `swapTokensForExactTokens`), `exactOutputStableSwap`, `multicall(previousBlockhash,
data)`, the four `selfPermit` functions, `wrapETH`, `pull`, `sweepToken`
  (both), `sweepTokenWithFee` and `unwrapWETH9WithFee` without a recipient,
  and the position-manager calls (`approveMax` and its three variants,
  `callPositionManager`, `mint`, `increaseLiquidity`, `getApprovalType`).
- The pool callback (`pancakeV3SwapCallback`) and the owner functions
  (`setStableSwap`, `transferOwnership`, `renounceOwnership`).

## What the screens say, and why

From the router source (`projects/router/contracts/` of
[pancake-v3-contracts](https://github.com/pancakeswap/pancake-v3-contracts) at
`b68b5c5`), whose functions are those of the ABI Sourcify has for the three
deployments. The router is a fork of Uniswap's SwapRouter02, with
PancakeSwap's pools and its stable-swap pools, so the swap screens are those
of `calldata-UniswapV3Router02.json` as #3146 left it.

- `exactInputSingle`: "Swap {amountIn} for at least {amountOutMinimum}", then
  Amount to Send, Minimum to Receive, Recipient, Pool Fee and ETH Sent.
- `exactOutputSingle`: "Swap at most {amountInMaximum} for {amountOut}", then
  Amount to Receive, Maximum to Send ("Unlimited" from 2^255), Recipient,
  Pool Fee and ETH Sent.
- Both require `sqrtPriceLimitX96` to be 0 (`mustMatch`), as #3146 did: with a
  limit, a swap can stop at the limit price, and `exactOutputSingle` checks
  that it delivered `amountOut` only when the limit is 0
  (`exactOutputInternal`). A call with a limit gets a warning instead of a
  clean screen.
- Pool Fee is the pool's fee tier in hundredths of a basis point, shown as a
  percentage, as Uniswap's file shows its fee.
- The router reads `address(1)` as the caller and `address(2)` as itself
  (`Constants.MSG_SENDER`, `ADDRESS_THIS`). A Recipient of `address(1)` shows
  as the sender (`senderAddress`, as in Uniswap's `swapTokensForExactTokens`).
  A batch sends a swap's output to `address(2)` to unwrap it or take a fee
  from it in the next action, and that Recipient shows as
  `0x0000000000000000000000000000000000000002`.
- `amountIn` 0 stands for the router's whole balance of `tokenIn`
  (`Constants.CONTRACT_BALANCE`), for a batch whose earlier action leaves
  tokens in the router; Amount to Send then shows 0, as in Uniswap's file.
- The swaps refund no ETH: `pay` wraps only what the pool takes, and the rest
  stays in the router until a `refundETH`, by the caller or by anyone. ETH
  Sent is shown when it is not 0, and a batch shows its `refundETH` action.

`multicall`, with and without a deadline, is "Batch swap actions": ETH Sent,
the Deadline, and each action on its own screen. A batch swaps, and then
unwraps the output, sends it on minus a fee, or refunds unused ETH (Batches,
below), so those actions have formats too:

- `unwrapWETH9`: "Unwrap the WETH held by this contract, at least
  {amountMinimum}, and send the ETH to {recipient}". The amount is in the
  chain's native currency (`amount`), ETH on all three chains, which WETH
  unwraps to one for one.
- `unwrapWETH9WithFee` and `sweepTokenWithFee`: the same for ETH and for a
  token, with Fee and Fee Recipient. The fee is `feeBips` ten-thousandths of
  the whole balance (at most 1%), shown as a percentage, and the minimum is
  checked before it is taken: Minimum Before Fee.
- `refundETH`: "Send the ETH held by this contract to you". It shows no
  field, since the batch screen already shows the ETH sent.

The three with a recipient send to it as given: none of them reads
`address(1)` as the caller, so they have no `senderAddress`.

## Batches

To be filled in from the batch-call count of the `Registry submission checks`
workflow.

## Tests

15 cases. 11 are real transactions copied as unsigned `rawTx` with their
`txHash`; each `rawTx` was compared with its transaction on chain (chain,
sender nonce, target, value and calldata), and each transaction succeeded.

The registry's selector coverage wants a test that calls each formatted
function at the top level, and no transaction calls `refundETH`,
`unwrapWETH9`, `unwrapWETH9WithFee` or `sweepTokenWithFee` alone. Their 4
cases are each the second action of a batch case, sent alone: the batch's
transaction with that action's calldata and no value, so they have no
`txHash`. Each was compared with its batch on chain (chain, sender nonce,
target, and the action's calldata), and each batch succeeded.

| Case                                                             | Transaction                                                                                                 | Screen                                                                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Swap exact input - chain 42161                                   | [`0x1f409ca2…`](https://arbiscan.io/tx/0x1f409ca2b9bf7d51f1883e0aa704489ab6b82453781b47c6fad4bba331f09cfc)  | Swap 40 USD₮0 for at least 2669.799684 LAVA                                                                           |
| Swap exact input, paid in ETH - chain 1                          | [`0x479b4c8e…`](https://etherscan.io/tx/0x479b4c8ee0c05d0d8becf6cc7b5a8e492645166eca5e86dd5ad5728564cf1ffe) | Swap 0.00894514037750014 WETH for at least 19.837705 USDT, ETH Sent 0.00894514037750014 ETH                           |
| Swap exact output - chain 1                                      | [`0x1b42bb95…`](https://etherscan.io/tx/0x1b42bb9538d19b5073c6a16828b6878f8a8199b7386dbd17ea752a891fafebdb) | Swap at most 101 USDC for 1627.802092974582732947 BLEND                                                               |
| Batch with a deadline, swap - chain 8453                         | [`0xb38ab37c…`](https://basescan.org/tx/0xb38ab37cbcab65acf91e10f598f5ab4b48e07b1d6f053937e67e69a9e5489d04) | Swap 137.59 USDC for at least 11518.701303070969561088 PLAY                                                           |
| Batch with a deadline, swap - chain 42161                        | [`0xfd01edfb…`](https://arbiscan.io/tx/0xfd01edfb5854e99ead24fe245de8f971619c6ea5e795148e396e619ff8372812)  | Swap 0.2211353564499824 WETH for at least 514.658557 USDC                                                             |
| Batch with a deadline, swap to another account - chain 42161     | [`0xd6564029…`](https://arbiscan.io/tx/0xd65640298f02808f6e2cc78de126c170a45834d16ea0d9011aa847c3714ba87a)  | Swap 1.49073 USD₮0 for at least 1.487622 USDC, to 0x7386…69dc                                                         |
| Batch, swap and unwrap - chain 8453                              | [`0x3aa70615…`](https://basescan.org/tx/0x3aa70615331f55758c1a9a8ab16f5ce1c440742907feee770155a81e5aedce38) | Swap 53 USDC for at least 0.023532201783482653 WETH; unwrap it, at least that, to 0xa68e…c1Ef                         |
| Batch, swap and unwrap - chain 1                                 | [`0xe0a7686c…`](https://etherscan.io/tx/0xe0a7686c0e5b35ed6afc84434a9f938e8ff23901ea5ad14a87a1d0c2ad5d2527) | Swap 116.1 USDT for at least 0.051585191218794598 WETH; unwrap it, at least that, to 0x1221…4C8c                      |
| Batch, swap paid in ETH and refund - chain 1                     | [`0xc2797dde…`](https://etherscan.io/tx/0xc2797ddebd7001db517ee39d21e1a0c1ddc51d60d11a105cdc74c5b187583269) | Send 4.481984482295051855 ETH; swap at most 4.504394404706527114 WETH for 10000 USDT; refund leftover ETH             |
| Batch, swap and unwrap minus a fee - chain 42161                 | [`0x5bf7237f…`](https://arbiscan.io/tx/0x5bf7237fe3b149f9af1556f1574a9ad575ef7686a8b44654a180fa542392dbff)  | Swap 0.01 USDC for at least 0.000004342641890966 WETH; unwrap it, 0.35% to 0xfec6…FB57, the rest to 0xABFF…3E3D       |
| Batch, swap paid in ETH and send minus a fee - chain 42161       | [`0x7bb770c4…`](https://arbiscan.io/tx/0x7bb770c4dfeb37ec1031106c571fbe043b144240d264dc548b6c770d424c378a)  | Send 0.00003 ETH; swap 0.00003 WETH for at least 0.06758 USDC; send it, 0.35% to 0xfec6…FB57, the rest to 0xABFF…3E3D |
| Refund leftover ETH, a batch action sent alone - chain 1         | Action 2 of `0xc2797dde…`                                                                                   | Send the ETH held by this contract to you                                                                             |
| Unwrap WETH to ETH, a batch action sent alone - chain 8453       | Action 2 of `0x3aa70615…`                                                                                   | Unwrap the WETH held by this contract, at least 0.023532201783482653 ETH, and send the ETH to 0xa68e…c1Ef             |
| Unwrap WETH minus a fee, a batch action sent alone - chain 42161 | Action 2 of `0x5bf7237f…`                                                                                   | The same, at least 0.000004342641890966 ETH before the fee, 0.35% to 0xfec6…FB57                                      |
| Send tokens minus a fee, a batch action sent alone - chain 42161 | Action 2 of `0x7bb770c4…`                                                                                   | The token balance, at least 0.06758 USDC before the fee, 0.35% to 0xfec6…FB57                                         |

No Base swap at the top level is a test: the 4 that the sample kept set a
price limit, which gets the warning above.

## Checks

On the registry at `ef582c2`, with the tools its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify): no errors. 31 warnings:
  - "Missing display format" for the 29 functions left out (Scope).
  - "Display intent too long": the interpolated intents are over Ledger's 30
    characters, as are 441 of the 775 interpolated intents in the registry's
    v2 calldata descriptors.
  - "URL too long": `https://pancakeswap.finance` is 27 characters, over
    Ledger's 26.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 15 of 15 cases pass.
- `check-recommended-fields.js`: no suggestion.
