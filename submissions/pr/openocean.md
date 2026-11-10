<!-- Pull request to ethereum/clear-signing-erc7730-registry, from the files
under submissions/registry/openocean/. Title on the first line, body below it. -->

# openocean: add OpenOcean Exchange calldata descriptor (Ethereum, OP Mainnet, Base, Arbitrum One)

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with OpenOcean. OpenOcean has not reviewed it.

Adds `calldata-OpenOceanExchange.json`, a calldata descriptor for OpenOcean's
aggregation router, OpenOcean Exchange V2, at
`0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` on Ethereum (1), OP Mainnet (10),
Base (8453) and Arbitrum One (42161). It is the address OpenOcean lists for
these chains in the README of
[OpenOceanExchangeV2](https://github.com/openocean-finance/OpenOceanExchangeV2),
and it is not in the calldata index today.

The address is a proxy (`OpenOceanExchangeProxy`, EIP-1967) whose admin can
change its implementation, and the implementation is a different contract on
each chain:

| Chain                | Implementation                               |
| -------------------- | -------------------------------------------- |
| Ethereum (1)         | `0xE29B6B6E96beFE1e9C6f948BcB5A3f71058bDA9B` |
| OP Mainnet (10)      | `0xDCbf4CB83d27C408B30dD7F39bfcabD7176B1Ba3` |
| Base (8453)          | `0x201263Cea08e8F1D6E2fdd1FD2cA44bf6145e2AF` |
| Arbitrum One (42161) | `0x94E8da4a7707b2eDD1688C1ab3B09fD0fB8267Eb` |

Sourcify has verified the proxy and all four implementations (contract
`OpenOceanExchange`, Solidity 0.8.9, partial match). Their `swap` and
`simpleSwap` are the same code on the four chains. The Ethereum, OP Mainnet and
Arbitrum One implementations are one source that differs only in the chain's
WETH address, and they add Uniswap V2 and V3 swaps and `swapGmxV2`, which
Base's implementation does not have. The public repository has `swap` but not
`simpleSwap`, so the screens are written from the verified source. If the admin
upgrades an implementation, they need checking again.

## Scope

Calls among the latest 1,000 transactions to the exchange on Ethereum, OP
Mainnet and Arbitrum One, and among all 281 on Base in the 23 hours to
2026-11-06 22:01 UTC, read on 2026-11-06 from Blockscout (Ethereum, OP Mainnet)
and from the SQD Network portal (Base, Arbitrum One), as calls (distinct
senders). The described functions are in bold.

| Function           | Ethereum  | OP Mainnet | Base      | Arbitrum One |
| ------------------ | --------- | ---------- | --------- | ------------ |
| **`swap`**         | 992 (605) | 996 (318)  | 268 (82)  | 936 (453)    |
| **`simpleSwap`**   | 8 (8)     | 4 (3)      | 13 (12)   | 15 (14)      |
| `uniswapV3SwapTo`  |           |            |           | 49 (30)      |
| Transactions a day | about 67  | about 44   | about 290 | about 45     |

**Described:** 3,232 of the 3,281 transactions: all of them on Ethereum, OP
Mainnet and Base, and 951 of 1,000 on Arbitrum One. Some of these calls are
refused by the descriptor's required values (below); Refused calls counts
them.

**Left out:**

- `uniswapV3SwapTo` (49 calls on Arbitrum One from 30 senders, none on the
  other chains) and `uniswapV3SwapToWithPermit`. Their tokens are not
  parameters: each word of `pools` packs a pool address with flags, the source
  token is one of the first pool's two tokens, and other flags wrap ETH before
  the swap or unwrap WETH after it (`UniswapV3Exchange._uniswapV3Swap`). A
  descriptor cannot name a token from a pool, so the amounts could not be shown
  in their token. They are not in Base's implementation.
- The functions no transaction in the sample called: the Uniswap V2 swaps
  (`callUniswap`, `callUniswapTo` and their `WithPermit` variants) and
  `swapGmxV2`, which are in the Ethereum, OP Mainnet and Arbitrum One
  implementations.
- The pool callback (`uniswapV3SwapCallback`), the owner functions (`pause`,
  `rescueFunds`, `setPermit2`, `transferOwnership`, `renounceOwnership`,
  `initialize`) and the proxy's admin functions (`changeAdmin`, `upgradeTo`,
  `upgradeToAndCall`, `admin`, `implementation`).

## What the screens say, and why

`swap` and `simpleSwap` take the same description of a swap (`simpleSwap`
without `guaranteedAmount`) and do the same with it, so they have one screen:
"Swap {desc.amount} for at least {desc.minReturnAmount}", then Amount to Send,
Minimum to Receive and Recipient.

- Amount to Send is `desc.amount` of `desc.srcToken`. With the claim flag
  (`flags` 2), the exchange moves `desc.amount` of the token from the sender to
  `desc.srcReceiver`, the executor that runs the swap (`_claim`). When the
  token is the native currency, the transaction's value must be exactly
  `desc.amount`, which the exchange passes to the executor; with any other
  token it must be 0 ("Invalid msg.value"). So the screen needs no separate
  ETH Sent.
- The exchange reads three addresses as the native currency:
  `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`, the zero address and
  `0x0000000000000000000000000000000000001010` (`UniversalERC20.isETH`), and so
  does the descriptor (`nativeCurrencyAddress`).
- Minimum to Receive is `desc.minReturnAmount` of `desc.dstToken`: the swap
  reverts unless the recipient's balance of that token, or of ETH, grew by at
  least that much during the executor's calls. A minimum of 0 is rejected.
- Recipient is `desc.dstReceiver`, and the zero address stands for the sender
  (`senderAddress`).
- `flags` must be 0 or 2 (`mustMatch`). Flag 1 is a partial fill: the swap may
  spend less than `desc.amount`, and the minimum becomes a rate, checked as
  `returnAmount * amount >= minReturnAmount * spentAmount`, so neither amount
  on the screen would hold. With `flags` 0 and a token other than the native
  currency, the exchange takes nothing from the sender and the executor swaps
  tokens it already holds, so Amount to Send shows more than leaves the
  sender. In the 16 transactions decoded for this file, every token swap had `flags` 2 and
  every swap from ETH `flags` 0.
- `desc.permit` must be empty (`mustMatch` `0x`). Of 7 or 8 words it is an
  EIP-2612 or DAI permit for the token, and of any other length a Permit2
  `permitTransferFrom`, whose transfer details (recipient and amount) are in
  the unsigned part of the payload and replace the claim of `desc.amount`, so
  Amount to Send would not be what moves. `mustMatch` takes exact values, so
  it cannot allow one length and refuse the others.
- Hidden: the executor (`caller`) and its `calls`, which are the route, and
  which the minimum guards the sender against; `desc.srcReceiver`; and
  `desc.guaranteedAmount` and `desc.referrer`, which are only written to the
  `Swapped` event and checked by nothing.

## Refused calls

To be measured by the `Registry submission batches` workflow
(`must-match.mjs`): how many of the latest calls of each function, on each
chain, have a `flags` or `permit` value that the descriptor refuses.

## Tests

9 cases, a `swap` and a `simpleSwap` on each chain and a swap from ETH on
Ethereum. They are real transactions copied as unsigned `rawTx` with their
`txHash`. Each `rawTx` was compared with its transaction on chain (chain,
sender nonce, target, value and calldata), and each transaction succeeded.
Every screen's Recipient is the transaction's sender.

| Case                                       | Transaction                                                                                                            | Screen                                                              |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Swap ETH for a token - chain 1             | [`0x5c3b5891…`](https://etherscan.io/tx/0x5c3b58910f4d5377a24b20c54c133c59a650c78c5e6a3b3cce59952e2971bed8)            | Swap 2.705 ETH for at least 5832.766688 USDC                        |
| Swap a token for ETH - chain 1             | [`0xcb633b03…`](https://etherscan.io/tx/0xcb633b0340c3dc533a10bafc126b4114b7b2e37d16cbb4b3bb2122b883599070)            | Swap 1.4855862 DAI for at least 0.000629717590444853 ETH            |
| Swap a token for ETH - chain 10            | [`0x8740d395…`](https://optimistic.etherscan.io/tx/0x8740d3953ec1d554ab1b97e48b0c9caa237b141dd575a8ff8c88ad2d05ddffa7) | Swap 0.05 USDT for at least 0.00002201864066108 ETH                 |
| Swap a token for WETH - chain 8453         | [`0x8102c653…`](https://basescan.org/tx/0x8102c653df40d3b303eebeb6b4a819996ee80a9317866afeb245a116872ed4fa)            | Swap 0.0049557 cbBTC for at least 0.167955610003510963 WETH         |
| Swap a token for ETH - chain 42161         | [`0x0103eaa5…`](https://arbiscan.io/tx/0x0103eaa5dd9ea3b309283cae13ef6b0d7cfae9b1c95862df92aab5a223ff756f)             | Swap 0.241624607355051419 ARB for at least 0.000017983070351541 ETH |
| Simple swap, token for token - chain 1     | [`0xbb731d4d…`](https://etherscan.io/tx/0xbb731d4d4dc6515b9638545e6dfc22e824a9700e715fadc8bab63f2b07e147f0)            | Swap 544.6638 SUPER for at least 100.945797 USDC                    |
| Simple swap, a token for ETH - chain 10    | [`0x2f67500b…`](https://optimistic.etherscan.io/tx/0x2f67500bc1305b969008fddc8a25f5d95f0542a04c4c9afa6b7795cda1106637) | Swap 0.00320418 WBTC for at least 0.103518655238863103 ETH          |
| Simple swap, token for token - chain 8453  | [`0x23971fc0…`](https://basescan.org/tx/0x23971fc04b3afa3152412dc1d5b17e8cdad22d15e0f853eb571de9f0650d5f1d)            | Swap 1300876.26034300211 GIZA for at least 142.001083 USDC          |
| Simple swap, a token for ETH - chain 42161 | [`0xc0a51e3b…`](https://arbiscan.io/tx/0xc0a51e3ba54417e28bb62ad2239b6adda52981ba8b998b345090c87f56fc3fdf)             | Swap 3612.727801 USDC for at least 1.504556395371886696 ETH         |

## Checks

On the registry at `8e484f1`, its latest commit on 2026-11-10, with the tools
its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify, through the proxy): no errors. Warnings:
  - "Missing display format" for the functions left out (Scope).
  - "Deployment ABIs differ": Base's implementation has fewer functions than
    the other three. The fields are checked against each ABI.
  - "Display intent too long": the interpolated intent is over Ledger's 30
    characters, as are 495 of the 838 interpolated intents in the registry's
    v2 calldata descriptors.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 9 of 9 cases pass.
- `check-recommended-fields.js`: no suggestion.
