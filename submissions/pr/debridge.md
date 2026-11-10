<!-- Pull request to ethereum/clear-signing-erc7730-registry, from the files
under submissions/registry/debridge/. Title on the first line, body below it. -->

# debridge: add DlnSource calldata descriptor (Ethereum, Base)

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with deBridge. deBridge has not reviewed it.

Adds `calldata-DlnSource.json`, a calldata descriptor for `createSaltedOrder`
of DlnSource, the contract where a DLN cross-chain order is created and its
tokens locked, at `0xeF4fB24aD0916217251F553c0596F8Edc630EB66` on Ethereum (1)
and Base (8453). It is the address that the README of
[dln-contracts](https://github.com/debridge-finance/dln-contracts) gives for
DlnSource ("Prod addresses"), and it is not in the calldata index today.

The address is a proxy (`TransparentUpgradeableProxy`, exact match on
Sourcify) whose admin can change its implementation. On both chains the
implementation is `0x2b426a0Ac391490e88d15B304436e7a84Df78611`, which Sourcify
has verified as `DlnSource` (Solidity 0.8.28, exact match). The public
repository is from June 2024 and is not what is deployed (the deployed
contract has `createSaltedOrderForIntent`, which the repository has not), so
the screen is written from the verified source. If the admin upgrades the
implementation, the descriptor needs checking again.

DlnSource is at the same address, behind the same implementation address, on
OP Mainnet and Arbitrum One too, but Sourcify has not verified the
implementation there, so `erc7730 lint --require-verified` cannot read its ABI
and those chains wait.

## Scope

Calls among the latest 1,000 transactions to DlnSource on Ethereum and
Arbitrum One, and among all 23 on OP Mainnet in the 7.6 days and all 46 on
Base in the 23.5 hours to 2026-11-06 22:01 UTC, read on 2026-11-06 from the
SQD Network portal, as calls (distinct senders). The described function is in
bold; OP Mainnet and Arbitrum One have no deployment in the file (Left out).

| Function                                      | Ethereum  | OP Mainnet | Base     | Arbitrum One |
| --------------------------------------------- | --------- | ---------- | -------- | ------------ |
| **`createSaltedOrder`**                       | 995 (644) | 22 (16)    | 46 (42)  | 997 (579)    |
| `createOrder`                                 |           |            |          | 3 (1)        |
| `withdrawCollectedFees`                       | 3 (1)     | 1 (1)      |          |              |
| `0x3381ae71`, which is not in DlnSource's ABI | 2 (1)     |            |          |              |
| Transactions a day                            | about 90  | about 3    | about 47 | about 68     |

**Described:** 1,041 of the 1,046 transactions on Ethereum and Base, the
`createSaltedOrder` calls. Those with an external call are refused (below);
Refused calls counts them.

**Left out:**

- OP Mainnet and Arbitrum One, until Sourcify has verified the implementation
  there (above).
- `createOrder`, the same order with the sender's next nonce as its salt and
  no metadata: 3 calls from one sender on Arbitrum One, none on Ethereum or
  Base, and none on any of the four chains in the orders read again on
  2026-11-10. With no transaction to test it on Ethereum or Base, it has no
  format.
- `withdrawCollectedFees`, which only an account with DlnSource's fee
  collector role can call (`onlyFeeCollector`), and the two calls to
  `0x3381ae71`.
- The functions no transaction in the sample called:
  `createSaltedOrderForIntent` (both), which only deBridge's intent manager
  can call (`onlyIntentManager`); `claimUnlock`, `claimCancel`,
  `claimBatchUnlock` and `claimBatchCancel`, which only DlnDestination can
  call, through deBridge's messaging (`_onlyDlnDestinationAddress`);
  `withdrawUnclaimedAffiliateFees`; and the admin functions.

What the orders carry, from the latest `createSaltedOrder` calls read again
on 2026-11-10 (`dln-orders.mjs`): on Ethereum, 116 successful calls from 92
senders from 2026-11-08 19:20 to 2026-11-10 11:28 UTC. 65% give USDC and 35%
ETH; they go to Arbitrum One (34%), Base (22%), Solana (21%) and eight other
chains. Half carry a permit (58), 5 an affiliate fee, 13 a refund address and
none an external call. The recipient is the sender in 59%; the order
authority is the sender in 66%, the recipient in 22% and another address in
11%. Every order sends 0.001 ETH more than it gives in ETH, the fixed fee
(`globalFixedNativeFee`, 0.001 ETH on all four chains, beside a fee of 4 basis
points of the amount given, `globalTransferFeeBps`).

## What the screen says, and why

From the verified source of DlnSource (`contracts/DLN/DlnSource.sol`,
`DlnBase.sol`, `contracts/libraries/DlnOrderLib.sol` and `Permit.sol`) and of
DlnDestination, where a taker fills the order on the destination chain
(`contracts/DLN/DlnDestination.sol`). DlnDestination is at
`0xE7351Fd770A37282b91D153Ee690B63579D6dd7f` behind the same kind of proxy,
and Sourcify has verified its implementation,
`0xD9b4f9CacFFB59F2B982ad3c45096e3AA4B4020e` (Solidity 0.8.28, exact match),
on Ethereum only; the other EVM chains have the same implementation address.
Solana's DLN program was not read.

An order locks the tokens given on the source chain. A taker fills it on the
destination chain by sending the recipient what the order asks, and is then
paid the locked tokens. An order nobody fills can be cancelled from the
destination chain, and the locked tokens go back. The screen follows `deposit`
in `calldata-Ethereum_SpokePool.json`, the registry's Across descriptor, which
describes the same kind of order: "Bridge {_orderCreation.giveAmount} to
{_orderCreation.receiverDst} on the destination chain; the taker must send
{_orderCreation.takeAmount}", then:

- Amount to Send is `giveAmount` of `giveTokenAddress`, where the zero address
  is the native currency (`nativeCurrencyAddress`). DlnSource takes all of it
  from the sender before the fees come out of it (`_pullTokens`): a token with
  `transferFrom`, failing unless all of it arrives (`_safeTransferFrom`,
  strict), and the native currency as the transaction's value, which must be
  `giveAmount` plus the fixed native fee (`MismatchNativeGiveAmount`).
- Destination Chain is `takeChainId`. DLN numbers most chains by their chain
  id, and some by a number of its own. Of the 18 chains that deBridge's API
  lists as served (`dln.debridge.finance/v1.0/supported-chains-info`, read on
  2026-11-10), Solana is 7565164, and Story, Cronos, HyperEVM, Tron,
  Injective, Monad and MegaETH, though the API gives each a chain id of its
  own, are 100000013, 100000019, 100000022, 100000026, 100000029, 100000030
  and 100000031. Neon, Gnosis, LightLink, Metis and Bitrock are 100000001 to
  100000005 in deBridge's `dln-client` (17.6.2, its latest release), and the
  API lists none of these five today. A wallet would show these numbers as
  unknown chains, so, as in the Across file, there are two fields: a `chainId`
  field, hidden for DLN's own numbers, and an enum,
  `$.metadata.enums.dlnChainId`, that names them and is hidden for the ten
  chains the API lists by their chain id (1, 10, 56, 137, 4663, 5042, 8453,
  42161, 43114, 59144). A chain id in neither list shows in both fields, the
  enum one as a number.
- Recipient is `receiverDst`, which receives the take token when a taker fills
  the order (`_fulfillOrder`). It is `bytes`, an address in the destination
  chain's own form (20 bytes on an EVM chain, 32 on Solana), so it is shown
  raw.
- Taker Must Send is `takeAmount` of `takeTokenAddress` on the destination
  chain (`chainIdPath`): a fill must send at least that much, and fails unless
  the recipient received at least that much (`InsufficientTakerAmount`,
  `InsufficientActualFulfillAmount`). A wallet that cannot look the token up
  on that chain, a Solana token or one on a chain it does not know, shows the
  amount raw, and Token to Receive (dest.) is the token, raw. The zero address,
  the destination chain's native currency, is not declared native
  (`nativeCurrencyAddress`): a wallet would give it the decimals and symbol of
  the source chain's currency, and the registry's Rust runner gives any chain
  it does not know those of ETH, so an order wanting SOL would read as ETH.
- Order Authority (can cancel; picks refund address if none set) is
  `orderAuthorityAddressDst`. On the destination chain, only it can cancel the
  order (`_authorizeOrderCancellation`), and when the order sets no refund
  address, it chooses where the refund goes (`sendEvmOrderCancel`). An app
  that put its own address here could cancel the order and take the refund.
  The label follows the registry's LI.FI descriptor, which shows DLN's order
  authority as "Order Authority (can cancel and choose the refund address)".
- Refund Address (if cancelled), shown when set, is
  `allowedCancelBeneficiarySrc`: a cancelled order's tokens and fees go back
  to it (`_claimCancel`), and then deBridge's governance can also cancel the
  order (`GOVERNANCE_DELEGATED_ORDER_CANCEL_ROLE`).
- Native Value Sent is the transaction's value: the fixed native fee, plus
  `giveAmount` when the native currency is given.
- `externalCall` must be empty (`mustMatch` `0x`). With an external call, a
  fill sends the take token to deBridge's external call adapter instead of the
  recipient, and the adapter runs the call's instructions with it
  (`_fulfillOrder`, `receiveCall`). The screen could not show what those do.
- Hidden: `givePatchAuthoritySrc`, which DlnOrderLib marks "Deprecated field.
  It is always ignored."; `allowedTakerDst`, which limits who may fill the
  order but not what a fill must send; `_salt`, which makes the order's id;
  `_referralCode` and `_metadata`, which are only written to the
  `CreatedOrder` event; `_affiliateFee`, an affiliate's share that comes out of
  `giveAmount` like DLN's percentage fee, so it changes what the taker is paid,
  not what the sender sends or the recipient gets, and is refunded with the
  rest if the order is cancelled; and `_permitEnvelope`, an EIP-2612 permit of
  the given token to DlnSource from the sender (`Permit.sol`, the same file,
  by its SHA-256, as in the public repository), after which DlnSource takes
  `giveAmount` as without one.

## Refused calls

Measured by the `Registry submission batches` workflow (`must-match.mjs`) on
2026-11-10: of the latest 200 `createSaltedOrder` calls on Ethereum (from 154
senders, 2026-11-07 13:15 to 2026-11-10 12:06 UTC) and all 19 on Base in the
twelve hours to 12:06 UTC (from 16 senders), none carries an external call, so
the descriptor refuses none of them. `dln-orders.mjs` found none either among
the latest 300 on Arbitrum One, which this file leaves out.

## Tests

9 cases from real transactions, copied as unsigned `rawTx` with their
`txHash`. Each `rawTx` was compared with its transaction on chain (chain,
sender nonce, target, value and calldata), and each transaction succeeded.

| Case                                                              | Transaction                                                                                                 | Amount to Send           | Destination Chain | Taker Must Send      |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------- | -------------------- |
| Bridge USDC to Solana - chain 1                                   | [`0xab704fc3…`](https://etherscan.io/tx/0xab704fc3b3adb036bb80e5ff661e9c6d5503120d09d2bc9b9b7a1c7abc2e7852) | 2.81238 USDC             | Solana            | 22084547             |
| Bridge USDC to HyperEVM - chain 1                                 | [`0xb316c4b3…`](https://etherscan.io/tx/0xb316c4b3edd467854a42e9002db6f4cab72a577a602bf26501970d2f47621f98) | 1048.7 USDC              | HyperEVM          | 13326497411676627465 |
| Bridge ETH for USDT on OP Mainnet - chain 1                       | [`0xa104f005…`](https://etherscan.io/tx/0xa104f00569f0944a2587cba6a26d046d7051f44fa86ee41def261d76a8352a0a) | 0.091129935764579605 ETH | OP Mainnet        | 194.673657 USDT      |
| Bridge ETH for USDC on Arbitrum One - chain 1                     | [`0x56a91b28…`](https://etherscan.io/tx/0x56a91b28ece3241e2dd36be0f616f9b4c2953e34a9bca04f3ff3274e0a4e4c8c) | 0.600144570327205848 ETH | Arbitrum One      | 1268.992355 USDC     |
| Bridge USDC to Base with a permit, to another recipient - chain 1 | [`0x30314442…`](https://etherscan.io/tx/0x3031444230ded495295af42e96f81601bedeb55ad686c703a6c3860f2ce7eff3) | 1000.271943 USDC         | Base              | 999.200162 USDC      |
| Bridge ETH for ETH on Base, with an affiliate fee - chain 1       | [`0xdae9d96d…`](https://etherscan.io/tx/0xdae9d96dc7a59efb2ffd699d95c5e47c4068a398e4e0169f33694875eac28659) | 2.3 ETH                  | Base              | 2292289348557253515  |
| Bridge USDC for a Solana token, with a refund address - chain 1   | [`0xd9596ad1…`](https://etherscan.io/tx/0xd9596ad1f4c1cec167e0d5d35b255a5deccf979e17e1f791c1821eab22162648) | 3600 USDC                | Solana            | 986103057265         |
| Bridge USDC to Solana - chain 8453                                | [`0xec814f7f…`](https://basescan.org/tx/0xec814f7fbce2c359fcd3935974f6e8ff736681dd8725207106204d393e229690) | 5 USDC                   | Solana            | 4197789              |
| Bridge USDC to HyperEVM - chain 8453                              | [`0xd6b3514f…`](https://basescan.org/tx/0xd6b3514f275014430275d5624610bb014412913dfd2b6828620da071f9051d06) | 300.473775 USDC          | HyperEVM          | 299760050            |

Taker Must Send is raw where the take token is on Solana or HyperEVM, which
no token list the tests use covers, and where it is the destination chain's
native currency (SOL, HYPE and, on Base, ETH), which the screen does not
declare native (above). The order authority is the sender in six cases and
the Solana recipient in two; in the case of a Solana token, it is another
Solana address. The senders of that case and of the order to Solana from Base
set themselves as refund address.

## Checks

On the registry at `8e484f1`, its latest commit on 2026-11-10, with the tools
its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify): no errors. Warnings:
  - "Missing display format" for the functions left out (Scope), and for the
    proxy's own `admin`, `changeAdmin`, `implementation`, `upgradeTo` and
    `upgradeToAndCall`, which the reference ABI lists with the
    implementation's.
  - "Display label too long": Refund Address (if cancelled), Token to Receive
    (dest.) and the order authority's label, which follows the LI.FI
    descriptor's (above). They are over Ledger's 20 characters, as are 384 of
    the 7,629 labels in the registry's v2 calldata descriptors.
  - "Display intent too long": the interpolated intent, the Across file's
    form, is over Ledger's 30 characters, as are 495 of the 838 interpolated
    intents in the registry's v2 calldata descriptors.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 9 of 9 cases pass.
- `check-recommended-fields.js`: no suggestion.
