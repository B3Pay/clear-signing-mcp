<!-- Pull request to ethereum/clear-signing-erc7730-registry, from
submissions/registry/debridge/calldata-DeBridgeRouter.json and its tests.
Title on the first line, body below it. Not opened until Sourcify has
verified the router's implementation on Ethereum, Base and Arbitrum One (the
deployments that submissions/UNVERIFIED lists), and after the DlnSource pull
request (debridge.md), whose screen this one shows for the order. Then the
Checks below are run again and this text is brought up to date with them. -->

# debridge: add DeBridgeRouter calldata descriptor (Ethereum, OP Mainnet, Base, Arbitrum One)

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with deBridge. deBridge has not reviewed it.

Adds `calldata-DeBridgeRouter.json`, a calldata descriptor for deBridge's
router at `0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251` on Ethereum (1), OP
Mainnet (10), Base (8453) and Arbitrum One (42161), for the two functions most
of its senders call: `swap`, which swaps a token and sends the outcome to a
recipient, and `strictlySwapAndCall`, which swaps a token and creates a DLN
order at DlnSource with the outcome. deBridge's `dln-client` (17.6.2, its
latest release) names the address as its `crossChainForwarderAddress`, and no
file in the registry names it today.

The address is a proxy whose admin, the contract
`0xc86ab72dc6da7ef91a96650f3bc23125cd997130` on all four chains, can change its
implementation: `TransparentUpgradeableProxy` on Ethereum and Arbitrum One
(exact match on Sourcify) and `CrosschainForwarderProxy` on OP Mainnet and Base
(match). On all four chains the implementation is
`0xCe56012E880851baa234cD092aF516A0fcA9CFe3`, which Sourcify has verified as
`DeBridgeRouter` (Solidity 0.8.28, exact match, `version()` 320, "3.2.0") on OP
Mainnet only. Its code is the same on the four chains, byte for byte (17,691
bytes, SHA-256
`513781c6f9e076b49b2b5daf12c8d72f24117bd4d5b5d1b7ed61bc98d85119d2`, read from
each chain on 2026-11-10), so the source verified on OP Mainnet is the source
of what the other three run. The screens are written from it. If the admin
upgrades the implementation, the descriptor needs checking again.

It shows the order that `strictlySwapAndCall` creates with the screen of
`calldata-DlnSource.json`, which the DlnSource pull request adds for Ethereum
and Base, so this one follows it.

## Scope

Calls among the latest 1,000 transactions to the router on Ethereum and
Arbitrum One, and among all 434 on OP Mainnet in the 7.6 days and all 107 on
Base in the 23.5 hours to about 22:00 UTC on 2026-11-06, read on 2026-11-06
from the SQD Network portal, as calls (distinct senders), failed calls
included (26 on Ethereum, 17 on Arbitrum One). The described functions are in
bold; `strictlySwapAndCall` is refused on OP Mainnet and Arbitrum One (What
the screen says).

| Function                  | Ethereum  | OP Mainnet | Base      | Arbitrum One |
| ------------------------- | --------- | ---------- | --------- | ------------ |
| **`swap`**                | 79 (50)   | 365 (13)   | 48 (35)   | 358 (137)    |
| **`strictlySwapAndCall`** | 343 (260) | 33 (20)    | 28 (22)   | 302 (220)    |
| `strictlySwapAndCallDln`  | 578 (2)   | 36 (2)     | 31 (1)    | 333 (3)      |
| `fillCrossChain`          |           |            |           | 7 (1)        |
| Senders                   | 307       | 35         | 58        | 346          |
| Transactions a day        | about 439 | about 57   | about 109 | about 47     |

**Described:** 422 of the 1,000 calls on Ethereum, 365 of the 434 on OP
Mainnet, 76 of the 107 on Base and 358 of the 1,000 on Arbitrum One: `swap` on
all four chains, and `strictlySwapAndCall` on Ethereum and Base. A
`strictlySwapAndCall` whose target is not DlnSource is refused (below);
Refused calls counts them.

**Left out:**

- `strictlySwapAndCallDln`, a taker's fill of a DLN order after a swap: the
  router checks the order (`_orderId`) at DlnDestination and calls it with
  the swap's outcome. Its 578 calls on Ethereum came from 2 senders, and it
  has 1 to 3 senders on each of the other chains.
- `fillCrossChain`, also a fill through DlnDestination
  (`_dlnDestinationCalldata`): 7 calls from 1 sender on Arbitrum One.
- The functions no transaction in the sample called: `simulateSwap`, a swap
  whose outcome stays in the router, for simulation; the admin functions
  (`initialize`, `updateFeeTreasury`, `updateSwapVariableFeeBps`,
  `updateSupportedRouter`, `updateAllowanceAggregator`, `rescueFunds`) and the
  role functions (`grantRole`, `revokeRole`, `renounceRole`).

In the tracker's 16 sampled calls of the described functions (two of each per
chain, 2026-11-06), every `strictlySwapAndCall` calls DlnSource's
`createSaltedOrder`, with no external call, an order that gives exactly the
swap's output, and `0x502ea3d95122b5914850E7A4A4CB9e96cF75A35f` as the swap's
refund recipient. Every `swap` sends the outcome to the sender, named by
address, with the whole surplus (100%); two on Base carry an affiliate fee of
0.25%.

## What the screen says, and why

From the verified source of DeBridgeRouter (`contracts/DeBridgeRouter.sol`,
`DeBridgeRouterBase.sol`, `contracts/libraries/Permit.sol` and
`SignatureUtil.sol`), and the router's settings, read on 2026-11-10 from each
chain and the same on all four: version 320, a swap fee of 8 basis points
(`swapVariableFeeBps`) paid to the fee treasury
`0x391276932b5105c2db8ee928dfd8872564d6d246`, an account with no code,
DlnDestination `0xE7351Fd770A37282b91D153Ee690B63579D6dd7f`, and DlnSource
listed as a contract the router may call (`supportedRouters`).

### `swap`

"Swap {_amountIn} for at least {_swapDetails.tokenOutMinAmount}", then:

- Amount to Swap is `_amountIn` of `_tokenIn`, where the zero address is the
  native currency (`nativeCurrencyAddress`). The router takes exactly that
  from the sender: a token with `transferFrom`, failing unless all of it
  arrives (`_obtainSrcTokenIn`), and the native currency as the
  transaction's value, which must be exactly `_amountIn`; a transaction that
  sends a value with a token fails (`ExcessiveMsgValue`).
- Minimum to Receive is `tokenOutMinAmount` of `tokenOut`. The router swaps,
  takes its swap fee from the outcome, then the affiliate fee, and fails
  unless what is left is at least this (`SwapOutcomeTooLow`), so the minimum
  holds after both fees. The swap fee is a setting of the router, which its
  admin can change, not a value in the call, so the screen does not show it.
- Recipient is `recipient`, which receives the outcome; the zero address is
  the sender (`senderAddress`).
- Affiliate Fee, shown when set, is the first 2 bytes of
  `affiliateFeeEnvelope`, a share of the outcome after the swap fee in basis
  points, shown as a percentage, and Affiliate Fee To is the next 20 bytes,
  the address that receives it (`_processAffiliateFee`). An envelope of any
  length but 0 or 22 bytes, or a share over 100%, fails the call.
- Recipient's Surplus, shown when it is not 100%, is `surplusShareBps`: of
  what is left above the minimum after the fees, the recipient gets this
  share and the fee treasury the rest; over 100%, the call fails when
  anything is left.
- Hidden: `_tokenInPermitEnvelope`, an EIP-2612 permit of the input token to
  the router from the sender (`Permit.sol`), after which the router takes
  `_amountIn` as without one. A permit for more leaves the rest as an
  allowance to the router, which takes tokens only from the account calling
  it, as much as each call says. `swapRouter` and `swapCalldata`, the call
  that makes the swap, and `allowanceAggregator`, the address the router
  approves for it instead of `swapRouter`: the router calls only contracts
  its admin has listed, and DlnDestination (`_callCustom`,
  `NotSupportedRouter`), approving them for its own balance, not the
  sender's, and whatever that call does, the recipient gets at least the
  minimum or the transaction fails. `_referralCode`, which is only
  written to the `SameChainSwapExecuted` event.

### `strictlySwapAndCall`

"Swap {_srcAmountIn} for {_srcTokenExpectedAmountOut} and bridge it", then:

- Amount to Swap is `_srcAmountIn` of `_srcTokenIn`, taken from the sender as
  in `swap`, except that the transaction may send more value than that: what
  is left of the value after the swap, with the output itself when that is
  the native currency, goes with the call to DlnSource, whose order needs its
  fixed fee in the native currency.
- Swap Output is `_srcTokenExpectedAmountOut` of `_srcTokenOut`. The swap must
  give at least that much (`NotEnoughSrcFundsIn`), and the call to DlnSource
  must take at least that much from the router (`CallCausedBalanceDiscrepancy`).
  This function takes no swap fee.
- Swap Surplus To is `_srcTokenRefundRecipient`, which receives what the swap
  gives above Swap Output (`_refund`). It is shown because it need not be the
  sender: in every sampled call and every test it is
  `0x502ea3d95122b5914850E7A4A4CB9e96cF75A35f`, an account with no code on the
  four chains, which B3Pay could not attribute.
- Bridge Order is `_targetData`, the call the router makes to `_target` with
  the swap's output, shown with the screen of the contract it calls
  (`calldata`, `calleePath`): DlnSource's `createSaltedOrder` and its screen
  in `calldata-DlnSource.json`, with the order's destination chain, recipient,
  what the taker must send and who can cancel it. That screen's Native Value
  Sent is the transaction's value (`amountPath` `@.value`), because no field
  of the call holds what is left of it after the swap: in the two tests that
  swap ETH, it is Amount to Swap plus DlnSource's fixed fee of 0.001 ETH.
- `_target` must be DlnSource (`mustMatch`). The router may call any contract
  its admin has listed, and DlnDestination (`_callCustom`); called with
  another, the call could be a swap or a fill, which this intent would
  misdescribe.
- The transaction's chain must be Ethereum or Base (`@.chainId`, `mustMatch`).
  DlnSource's descriptor has no deployment on OP Mainnet or Arbitrum One yet,
  since Sourcify has not verified its implementation there, and with no
  descriptor for the inner call the Sourcify runner shows the order as raw
  calldata, as the Rust runner's code does: a wallet would show the swap but
  not where the order goes or to whom. The rule can go when DlnSource's
  descriptor covers those chains.
- Hidden: `_srcTokenInPermitEnvelope`, as in `swap`; `_srcSwapRouter` and
  `_srcSwapCalldata`, the call that makes the swap, as in `swap`: whatever it
  does, the order gets Swap Output or the transaction fails.

## Refused calls

Measured by the `Registry submission batches` workflow (`must-match.mjs`) on
2026-11-10, from the SQD Network portal: the latest successful
`strictlySwapAndCall` calls sent to the router, up to 200 on each chain. Every
one of them calls DlnSource, so the rule on the target refuses none. The rule
on the chain refuses every one on OP Mainnet and Arbitrum One:

| Chain        | Calls read (senders) | From (UTC)       | Refused           |
| ------------ | -------------------- | ---------------- | ----------------- |
| Ethereum     | 57 (46)              | 2026-11-10 01:37 | none              |
| OP Mainnet   | 2 (1)                | 2026-11-10 01:42 | 2, for its chain  |
| Base         | 5 (5)                | 2026-11-10 13:28 | none              |
| Arbitrum One | 54 (47)              | 2026-11-04 19:20 | 54, for its chain |

Each span ends between 14:40 and 14:46 UTC on 2026-11-10. The calls were read
before the rule on the chain was added, so their refusal for it follows from
the rule rather than from the count.

## Tests

9 cases from real transactions, copied as unsigned `rawTx` with their
`txHash`. Each `rawTx` was compared with its transaction on chain (chain,
sender nonce, target, value and calldata), and each transaction succeeded.

| Case                                                                               | Transaction                                                                                                            | Amount to Swap           | Swap Output, or Minimum to Receive | Order: destination; Taker Must Send |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------- | ----------------------------------- |
| Swap ETH for USDC and bridge it to HyperEVM for HYPE - chain 1                     | [`0xa1c4f07d…`](https://etherscan.io/tx/0xa1c4f07d71ed574effbdd8345d8dfa52c936c3a3fa8a05dd697f1299229f8a62)            | 0.017197260098010312 ETH | 38.194948 USDC                     | HyperEVM; 478611676017346231        |
| Swap ETH for USDC and bridge it to Cronos for CRO - chain 1                        | [`0x64754e6c…`](https://etherscan.io/tx/0x64754e6cab96cdcc094a77dc7ca60760d02ec52a9efb72b724ee941d4d4fd305)            | 0.361235601511287407 ETH | 802.699291 USDC                    | Cronos; 15979119140069204730954     |
| Swap a token for USDC and bridge it to Ethereum, to another recipient - chain 8453 | [`0xe37c018f…`](https://basescan.org/tx/0xe37c018fce5802b1424dfd41ff4ab18b9c7207f52c53f8c0ebc57c0d29d8677b)            | 1600937079188991410870   | 510.857867 USDC                    | Ethereum Mainnet; 510.151861 USDC   |
| Swap cbBTC for USDC and bridge it to BNB Chain, with a refund address - chain 8453 | [`0x26001820…`](https://basescan.org/tx/0x260018206a9df2ec54d70a58ab69d58999429d5f128c805dc044b03ecec7da58)            | 0.04620607 cbBTC         | 3483.450514 USDC                   | BNB Smart Chain Mainnet; 4544564    |
| Swap ETH for USDT - chain 1                                                        | [`0xdada87f1…`](https://etherscan.io/tx/0xdada87f17bccfc14d451021295d1ba550423156ccc2f80fcb340ddee8e80c791)            | 0.8 ETH                  | at least 1786.253218 USDT          |                                     |
| Swap USDC for USDT - chain 1                                                       | [`0x49c1d72f…`](https://etherscan.io/tx/0x49c1d72fa5c0ea146046be7d123dcb994337c2291783490db818a3ad951d6381)            | 2800 USDC                | at least 2799.301699 USDT          |                                     |
| Swap a token for WETH - chain 10                                                   | [`0xdcc2c3a7…`](https://optimistic.etherscan.io/tx/0xdcc2c3a7ff0fa7320ebf7b75ff05b37f72bf9c92841cdc5a4f82972b8c129bc6) | 107820 ANTH              | at least 0.000490113359844065 WETH |                                     |
| Swap USDC for ETH, with an affiliate fee - chain 8453                              | [`0xd9f8c6ce…`](https://basescan.org/tx/0xd9f8c6ce1e5d26140a441b51e3777253468863d61d3a3c75e724e30d852e044a)            | 52.955348 USDC           | at least 0.023482225278702362 ETH  |                                     |
| Swap WBTC for USDC - chain 42161                                                   | [`0x0d4e06e0…`](https://arbiscan.io/tx/0x0d4e06e0f22bcb0f1e4e249f1f4167ff8d1b420f44210c8ab214350ff138a3fb)             | 0.00016562 WBTC          | at least 12.47415 USDC             |                                     |

The four swaps then bridges are on Ethereum and Base, the chains where the
order is shown; the five swaps cover all four chains. Amount to Swap is raw
where the input token is in no token list the tests use, and what the taker
must send is raw where it is the destination chain's native currency (HYPE,
CRO), which DlnSource's screen does not declare native, or a token on BNB
Chain, which no token list the tests use covers. One order goes to another
recipient than the sender, and one has another order authority and the
sender as refund address.

## Checks

On the registry at `3bebbd0`, its latest commit on 2026-11-10, with the tools
its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify): three errors, "Proxy implementation not verified" on Ethereum,
  Base and Arbitrum One, for which this pull request waits. Warnings:
  - "Missing display format" for the functions left out (Scope), and for the
    proxy's own `admin`, `changeAdmin`, `implementation`, `upgradeTo` and
    `upgradeToAndCall`, which the reference ABI lists with the
    implementation's.
  - "Display intent too long": both interpolated intents are over Ledger's 30
    characters, as are 495 of the 838 interpolated intents in the registry's
    v2 calldata descriptors.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 9 of 9 cases pass. With
  one of the Base swaps then bridges moved to OP Mainnet, both refuse it for
  its chain: "MUSTMATCH_VIOLATION: Field 'Chain' value does not match any of
  the required values" in the Sourcify runner, and "field 'Chain' (path
  '@.chainId') failed visible.mustMatch" in the Rust runner.
- `check-recommended-fields.js`: no suggestion.
