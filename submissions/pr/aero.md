<!-- Pull request to ethereum/clear-signing-erc7730-registry, from the files
under submissions/registry/aero/. Title on the first line, body below it. -->

# aero: add Slipstream SwapRouter and NonfungiblePositionManager calldata descriptors (Ethereum, OP Mainnet, Base, Arbitrum One)

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with Aero or Dromos Labs. Aero has not reviewed it.

Adds calldata descriptors for two contracts of Slipstream, Aero's
concentrated-liquidity pools, at the same addresses on Ethereum, OP Mainnet,
Base and Arbitrum One:

| File                                       | Contract                                                                       | Address                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------ | -------------------------------------------- |
| `calldata-SwapRouter.json`                 | SwapRouter                                                                     | `0x9Ee35Bf1bd69a03c6F0393582030fCe8Bb93D418` |
| `calldata-NonfungiblePositionManager.json` | NonfungiblePositionManager, the position NFT "Slipstream V3 Deposit" (AERO-CL) | `0x4857DB576eE0e45F10525eC59527BfD10beeC60b` |

They are the `swapRouter` and `nftPositionManager` that Dromos Labs lists for
these chains in `deployment-addresses/cl-*.json` of
[metadex-slipstream-public](https://github.com/Dromos-Labs/metadex-slipstream-public).
Neither is a proxy, Sourcify has the source of both on all four chains, and
neither is in the calldata index today.

## Scope

Calls among the latest 1,000 transactions to each contract on each chain,
read on 2026-11-06 from the SQD Network portal, as calls (distinct senders).
The described functions are in bold.

SwapRouter:

| Function                | Ethereum  | OP Mainnet  | Base         | Arbitrum One |
| ----------------------- | --------- | ----------- | ------------ | ------------ |
| **`exactInputSingle`**  | 1,000 (6) | 996 (3)     | 717 (59)     | 996 (7)      |
| **`exactOutputSingle`** |           |             | 252 (9)      | 1 (1)        |
| `exactInput`            |           | 4 (1)       | 11 (8)       | 3 (2)        |
| `multicall`             |           |             | 20 (4)       |              |
| Transactions a day      | about 330 | about 4,300 | about 20,000 | about 480    |

NonfungiblePositionManager:

| Function                      | Ethereum    | OP Mainnet | Base         | Arbitrum One |
| ----------------------------- | ----------- | ---------- | ------------ | ------------ |
| **`mint`**                    | 472 (7)     | 339 (9)    | 366 (41)     | 481 (12)     |
| **`multicall`**               | 431 (7)     | 384 (12)   | 445 (43)     | 467 (9)      |
| **`increaseLiquidity`**       | 20 (2)      | 150 (3)    | 114 (20)     | 43 (4)       |
| **`approve`**                 | 66 (3)      | 94 (6)     | 56 (18)      | 3 (2)        |
| **`setApprovalForAll`**       | 7 (5)       | 27 (23)    | 4 (4)        | 3 (3)        |
| **`collect`**                 | 1 (1)       | 1 (1)      | 6 (4)        | 1 (1)        |
| **`decreaseLiquidity`**       | 1 (1)       |            | 5 (4)        | 1 (1)        |
| **`burn`**                    | 1 (1)       |            | 2 (2)        | 1 (1)        |
| `safeTransferFrom`, with data | 1 (1)       | 5 (2)      | 2 (2)        |              |
| Transactions a day            | about 1,200 | about 150  | about 31,000 | about 2,200  |

**Described:** 3,962 of the router's 4,000 transactions and 3,992 of the
position manager's 4,000.

**Left out:**

- The router's `exactInput` and `exactOutput`. Slipstream encodes a
  multi-pool path as Uniswap V3 does, and a path's last token can be spoofed
  with appended bytes, which is why #3136 dropped these two functions from
  `calldata-UniswapV3Router02.json`. The router's `multicall` is left out
  with them: the batches in the sample wrapped `exactInput`.
- The position manager's `safeTransferFrom(from, to, tokenId, data)`. The 5
  of these 8 calls that the sample kept each send a position to a contract,
  one of three, with 736 to 4,480 bytes of `data` for it to act on. A screen
  that hides `data`, as the Uniswap position manager's does, would not say
  what the receiving contract is told to do with the position.
- The functions that no transaction in the sample called, at the top level or
  inside a batch, so that no real transaction can test them: `refundETH`,
  `sweepToken`, `unwrapWETH9` and the four `selfPermit` functions on both
  contracts, `sweepTokenWithFee` and `unwrapWETH9WithFee` on the router, and
  `permit`, `transferFrom` and `safeTransferFrom(from, to, tokenId)` on the
  position manager.
- The pool callbacks (`uniswapV3SwapCallback`, `uniswapV3MintCallback`) and
  the position manager's owner functions (`setOwner`, `setTokenDescriptor`).

## What the screens say, and why

From the Slipstream source (`contracts/periphery/SwapRouter.sol` and
`NonfungiblePositionManager.sol` at `f99f209`, the same as tag `v1.1.0` for
these files).

**SwapRouter.** The intents, labels and hidden fields are those of
`calldata-UniswapV3SwapRouter.json` (#3135), whose functions these are, with
a pool's tick spacing where Uniswap has its fee: Slipstream names a pool by
its two tokens and its tick spacing, shown as Pool Tick Spacing.

- `exactInputSingle`: "Swap {amountIn} for at least {amountOutMinimum}", then
  Amount to Send, Minimum to Receive, Recipient, Deadline, Pool Tick Spacing
  and ETH Sent.
- `exactOutputSingle`: "Swap at most {amountInMaximum} for {amountOut}", then
  Amount to Receive, Maximum to Send ("Unlimited" from 2^255), Recipient,
  Deadline, Pool Tick Spacing and ETH Sent.
- Both require `sqrtPriceLimitX96` to be 0 (`mustMatch`), as #3146 did for
  `calldata-UniswapV3Router02.json`: with a limit, a swap can stop at the
  limit price, and `exactOutputSingle` checks that it delivered `amountOut`
  only when the limit is 0 (`exactOutputInternal`). A call with a limit gets
  a warning instead of a clean screen.
- Both end with `refundETH()`, which sends the router's whole ETH balance to
  the caller, so ETH sent with a swap and not used comes back. ETH Sent is
  shown, as in Uniswap's file.

**NonfungiblePositionManager.** The eight screens are those of
`calldata-UniswapV3NonfungiblePositionManager.json` (#3175) for the same
functions, with these differences:

- `mint` takes a pool's `tickSpacing` where Uniswap's takes its fee (Pool
  Tick Spacing), and a `sqrtPriceX96`: when that is not 0, `mint` first
  creates the pool at that price, and reverts if the pool already exists. It
  shows as New Pool Sqrt Price only then (`ifNotIn: [0]`).
- `mint` and `increaseLiquidity` end with `refundETH()`, so ETH they do not
  use goes back to the caller. Their ETH Sent is shown, where Uniswap's file
  requires 0: Uniswap's position manager keeps unused ETH until a
  `refundETH` call.
- `decreaseLiquidity`, `collect` and `burn` refund nothing, so as in
  Uniswap's file their ETH Sent must be 0.

As in Uniswap's file: `increaseLiquidity`, `decreaseLiquidity` and `collect`
name a position, not its tokens, so their amounts are in raw units; `collect`
sends to the position manager itself when `recipient` is the zero address,
where any caller can sweep the tokens, and its intent says so; `approve` and
`setApprovalForAll` say "withdraw and transfer", because an approved operator
passes `isAuthorizedForToken` for `decreaseLiquidity`, `collect` and `burn`,
and can transfer the NFT. `multicall` is "Batch position actions", with each
action on its own screen. Every batch in the sample was `decreaseLiquidity`
and `collect`, most of them then `burn`, all of which have a format.

A `deadline` of `type(uint256).max`, which some callers send, renders as
`NaN-NaN-NaN NaN:NaN:NaNZ` in the Sourcify runner. No test case has one.

## Tests

19 cases: each described function on the chains where the sample had one,
both `setApprovalForAll` values, and a batch on three chains. All are real
transactions copied as unsigned `rawTx` with their `txHash`. Each `rawTx` was
compared with its transaction on chain (chain, sender nonce, target, value
and calldata), and each transaction succeeded.

| Case                                            | Transaction                                                                                                            | Screen                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Swap exact input - chain 8453                   | [`0x71377f77…`](https://basescan.org/tx/0x71377f7790158d03afe99828d1d16e7cda59ff556f79dbd2f9c047e657278627)            | Swap 18.51025642 AMZNc for at least 4805.249561 USDC                                   |
| Swap exact input - chain 42161                  | [`0xf9859584…`](https://arbiscan.io/tx/0xf9859584fa252d7f3c7daaf3b2a698f3d4f07ef1876f7f1952d2754569fd0592)             | Swap 3263.614 USDC for at least 3253.814511 USDG                                       |
| Swap exact input - chain 1                      | [`0xc786700a…`](https://etherscan.io/tx/0xc786700aa1038fdd070d8d8021c42e6d6494aa58f9909a8802510c99026b164b)            | Swap 0.01293114 WBTC for at least 980.499327 USDT                                      |
| Swap exact output - chain 8453                  | [`0x6e089e0e…`](https://basescan.org/tx/0x6e089e0e7714b0a61edecc563fd7377b5d103c6ec80db97222e5088b5fad3d12)            | Swap at most 473.484742 USDC for 0.006 cbBTC                                           |
| Swap exact output - chain 42161                 | [`0x6248d227…`](https://arbiscan.io/tx/0x6248d2273e147a6aec77718e1d570ec249c807ef31847015441a0093978bafcd)             | Swap at most 1080.650268 USDG for 0.01417707 WBTC                                      |
| Open liquidity position - chain 8453            | [`0xed9143c2…`](https://basescan.org/tx/0xed9143c2b0d4ce57b70c06d41e895941457c46df6d25e0940224f359d1602b07)            | Add up to 4800.560691 USDC and up to 8.01484749 AMZNc, ticks -9550 to -9540            |
| Open liquidity position - chain 1               | [`0x3345eaa1…`](https://etherscan.io/tx/0x3345eaa1facf5a6b1e191c88f87b9edb24691f36abb108a3e9bfe7f70329d958)            | Add up to 0.01408343 WBTC and up to 1529.060687 USDT, ticks 66310 to 66330             |
| Add to liquidity position - chain 10            | [`0x4e78d305…`](https://optimistic.etherscan.io/tx/0x4e78d30540b6dab68a55e0a96fdaf4979c96291ad50fe7872181088d3253a966) | Add up to 7664379 token0 and up to 31981491061076258 token1 to position 111542         |
| Add to liquidity position - chain 42161         | [`0xf23c6711…`](https://arbiscan.io/tx/0xf23c6711cbbf914463cbfb13346b82f532496a5c65549c7b0d84d52c3fca4658)             | Add up to 857726 token0 and up to 118662394186403338 token1 to position 36334          |
| Decrease liquidity - chain 8453                 | [`0x4e14bc84…`](https://basescan.org/tx/0x4e14bc8436be6971666a32ae461e5c231fce9ca2aa0016c938bf7fdfe9dab517)            | Remove 25383826497 liquidity from position 1704266                                     |
| Collect from position - chain 42161             | [`0xca282181…`](https://arbiscan.io/tx/0xca2821815f48425669a45e1f33fdec9dcf5f48dfcf5042ba588080922b90875e)             | Collect from position 34848, sent to 0xAe30…Ae8d                                       |
| Collect from position - chain 10                | [`0x3d7bdf88…`](https://optimistic.etherscan.io/tx/0x3d7bdf88ebefe7ea629463793a37f8b577969e3bfa3ddaa27b5514e675c7a4c5) | Collect from position 45902, sent to 0x196F…5BEE                                       |
| Burn empty position NFT - chain 1               | [`0x9533af33…`](https://etherscan.io/tx/0x9533af33a6bcf256f944f6143d5b8ba8bbb4557c18ba25bd772b9b2f157c57c7)            | Burn empty position NFT 14094                                                          |
| Approve position operator - chain 8453          | [`0xdf97f913…`](https://basescan.org/tx/0xdf97f913e4c4b4db395e325020f4da0c3e1f1ede4f23f07bff400317b0e3d76d)            | Allow 0xAbb3…6D8C to withdraw and transfer position NFT 1744800                        |
| Set operator for all NFTs, grant - chain 8453   | [`0x544bea3f…`](https://basescan.org/tx/0x544bea3ff10313774c826308c0898bd9092576719de77b6d68c60679bec774f1)            | Grant 0x0fEf…Ee98 access to withdraw and transfer all your position NFTs               |
| Set operator for all NFTs, revoke - chain 42161 | [`0x05a2cf7d…`](https://arbiscan.io/tx/0x05a2cf7d70bef01f982c389abe08f4786efd075a4806360ed1bdf33aa4288238)             | Revoke 0x1243…8947 access to withdraw and transfer all your position NFTs              |
| Batch position actions - chain 42161            | [`0x4dc74b0d…`](https://arbiscan.io/tx/0x4dc74b0d509a847e4e64985ceefbe4ea4d15433f3184bb6d4b1ec8225b0d12c5)             | Decrease liquidity, Collect from position and Burn empty position NFT, position 36297  |
| Batch position actions - chain 10               | [`0xb71e3ce4…`](https://optimistic.etherscan.io/tx/0xb71e3ce45b1b4914796f70a319397ecc1fb0bd569153bddfedac7a6ca4317ab3) | Decrease liquidity, Collect from position and Burn empty position NFT, position 120134 |
| Batch position actions - chain 1                | [`0x3280d157…`](https://etherscan.io/tx/0x3280d1570d84bcf9a3b5a33c53e887efdc2af08f4d2735248404ca4d3d8fd511)            | Decrease liquidity, Collect from position and Burn empty position NFT, position 15423  |

No OP Mainnet swap is a test: both OP Mainnet `exactInputSingle` calls that
the sample kept set a price limit, which gets the warning above.

## Checks

On the registry at `ef582c2`, with the tools its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify): no errors, so Sourcify has verified source for all eight
  deployments. 30 warnings:
  - "Missing display format" for the 13 router functions and 15 position
    manager functions left out (Scope).
  - "Display intent too long", once per file: the interpolated intents are
    over Ledger's 30 characters, as are 441 of the 775 interpolated intents
    in the registry's v2 calldata descriptors.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 19 of 19 cases pass.
- `check-recommended-fields.js`: no suggestion for either file.
