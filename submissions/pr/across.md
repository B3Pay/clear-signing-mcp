<!-- Pull request to ethereum/clear-signing-erc7730-registry, from the files
under submissions/registry/across/. Title on the first line, body below it. -->

# across: add SpokePoolPeriphery calldata descriptors for ETH deposits (Ethereum, Base, Arbitrum One)

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with Across. Across has not reviewed it.

Adds calldata descriptors for `depositNative` of Across's SpokePoolPeriphery,
at `0x97CCDBea4632140639aD5eA9b944aa034eb15fD4` on Ethereum (1), Base (8453)
and Arbitrum One (42161), the address that `broadcast/deployed-addresses.json`
of [across-protocol/contracts](https://github.com/across-protocol/contracts)
lists for it on these chains (at `d0725ea`). It is not in the calldata index
today.

`depositNative` sends the ETH it receives to the `deposit` function of the
spoke pool it is given, so each chain has its own file, which requires that
chain's spoke pool and WETH:

| File                                        | Chain        | Spoke pool                                   | WETH                                         |
| ------------------------------------------- | ------------ | -------------------------------------------- | -------------------------------------------- |
| `calldata-Ethereum_SpokePoolPeriphery.json` | Ethereum     | `0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` |
| `calldata-Base_SpokePoolPeriphery.json`     | Base         | `0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64` | `0x4200000000000000000000000000000000000006` |
| `calldata-Arbitrum_SpokePoolPeriphery.json` | Arbitrum One | `0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A` | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` |

The spoke pools are the `SpokePool` of the same `deployed-addresses.json`, and
the WETH addresses are `WETH` in its `generated/constants.json`. The names
follow `calldata-Ethereum_SpokePool.json`, the registry's descriptor for the
Ethereum spoke pool, whose `deposit` screen these follow.

The periphery is not a proxy, and Sourcify has verified it on Ethereum, OP
Mainnet, Base and Arbitrum One with one source (`SpokePoolPeriphery`, Solidity
0.8.30, exact match).

Each spoke pool is a proxy (`ERC1967Proxy`, UUPS) whose admin can upgrade it.
Sourcify has verified the three proxies and their implementations:
`Ethereum_SpokePool` at `0x456Ac26E5ec083EE9889eBa0d1a0A582502B8e84` (exact
match), `OP_SpokePool` on Base at `0xf23C6C04A2B88e8651FE99bbDccbB5C9D306e6B0`
(match) and `Arbitrum_SpokePool` at
`0xcfCDA84333431BCC9155f2368B8362F0d1dfF8c9` (exact match), Solidity 0.8.30.
The three have the same `contracts/spoke-pools/SpokePool.sol`, and their
chain-specific contracts change no deposit or fill code. These files are the
ones in across-protocol/contracts at `d0725ea`, except Base's
`Ovm_SpokePool.sol`, which is that repository's version before `ef83a5e` and
defines the same functions. Each pool's `wrappedNativeToken()` returns the
WETH above. If the admin upgrades a spoke pool, the descriptor needs checking
again.

## Scope

Calls among the latest 1,000 transactions to the periphery on Ethereum, OP
Mainnet and Arbitrum One, and among all 443 on Base in the 23.5 hours to
2026-11-06 22:01 UTC, read on 2026-11-06 from the SQD Network portal
(Ethereum, Base, Arbitrum One) and from Blockscout (OP Mainnet), as calls
(distinct senders). The described function is in bold; OP Mainnet has no file
(Left out).

| Function                        | Ethereum    | OP Mainnet | Base      | Arbitrum One |
| ------------------------------- | ----------- | ---------- | --------- | ------------ |
| **`depositNative`**             | 343 (300)   | 323 (320)  | 248 (231) | 345 (224)    |
| `depositWithAuthorization`      | 334 (3)     | 573 (3)    | 1 (1)     | 388 (3)      |
| `depositWithPermit2`            | 211 (3)     |            |           |              |
| `swapAndBridge`                 | 106 (93)    | 102 (91)   | 194 (140) | 266 (221)    |
| `depositWithAuthorizationBytes` | 6 (3)       | 2 (1)      |           | 1 (1)        |
| Transactions a day              | about 1,800 | about 270  | about 450 | about 520    |

**Described:** 936 of the 2,443 transactions on Ethereum, Base and Arbitrum
One, the `depositNative` calls. Those that carry a message are refused
(below); Refused calls counts them.

**Left out:**

- `depositWithAuthorization`, `depositWithAuthorizationBytes` and
  `depositWithPermit2`, each sent by three senders or fewer on each chain.
  Each call carries a deposit that the owner of the tokens signed as typed
  data, an EIP-3009 authorization for the token or a Permit2 transfer, and
  anyone can submit it. That owner signs the typed data, not this
  transaction, so a calldata descriptor would not reach them.
- `swapAndBridge`, which swaps on an exchange the call names, with calldata
  for it, then deposits what the swap returned. The 8 `swapAndBridge`
  transactions decoded for this file (2 on each chain) all carry a message,
  which a screen could not show (below).
- OP Mainnet. The periphery is there too, but both OP Mainnet `depositNative`
  transactions decoded for this file carry a message, so there is no
  transaction yet to test an OP Mainnet file with.
- The functions no transaction in the sample called: `depositWithPermit`, the
  four `swapAndBridgeWith…` functions and `multicall`.

## What the screens say, and why

From the verified source of the periphery
(`contracts/periphery/SpokePoolPeriphery.sol`) and of the spoke pools
(`contracts/spoke-pools/SpokePool.sol`).

`depositNative` calls `deposit` of the spoke pool named in `spokePool` with
the ETH sent and its own arguments, `depositor` as the depositor. The screen
is that of `deposit` in `calldata-Ethereum_SpokePool.json`, which takes the
same arguments: "Bridge {inputAmount} to {recipient} on the destination chain;
the relayer must send {outputAmount}; depositor {depositor}", then Amount to
Bridge, Destination Chain, Recipient, Relayer Must Send, Output Token (dest.),
Depositor (gets refund, can change recipient and amount) and Fill Deadline,
with that file's formats, destination chain names and hidden fields. The
differences:

- `spokePool` must be the chain's spoke pool (`mustMatch`). The periphery
  sends the ETH to whatever address it is given, and with another address
  nothing on the screen would hold.
- `inputToken` must be the chain's WETH (`mustMatch`), and Amount to Bridge
  is `inputAmount` in ETH, where the SpokePool file has a token amount and
  Native Value Sent. The spoke pool takes ETH only when `inputToken` is its
  `wrappedNativeToken`, and then only exactly `inputAmount`
  (`MsgValueDoesNotMatchInputAmount`). Otherwise it takes the token from the
  caller, the periphery, which leaves it no allowance (`_deposit` approves
  exactly what each of its own deposits takes), so the call reverts. A call
  this screen shows sends Amount to Bridge in ETH, and nothing else.
  As in the SpokePool file, `depositor` is an argument, so it need not be the
  sender: the depositor is refunded if no relayer fills the deposit by the fill
  deadline, and can sign a speed-up that changes the recipient and the amount
  the relayer must send. In each test it is the sender.

As in the SpokePool file, `message` must be empty (`mustMatch` `0x`). A fill
passes the message to the recipient on the destination chain, when that is a
contract (`handleV3AcrossMessage`). All 12 deposits with a message decoded for
this file (4 `depositNative`, 8 `swapAndBridge`) decode as the instructions of
Across's MulticallHandler, a list of calls to run with the bridged tokens and
a fallback recipient, and 11 of them have the handler's address in
`deployed-addresses.json`, `0x0F7Ae28dE1C8532170AD4ee566B5801485c13a0E`, as
recipient. The screen's Recipient would not be who ends up with the tokens.

When `outputToken` is the destination spoke pool's wrapped native token and
the recipient is not a contract, that spoke pool unwraps it and sends ETH
(`_unwrapwrappedNativeTokenTo`), so a recipient account gets the WETH on the
screen as ETH.

## Refused calls

Measured by the `Registry submission batches` workflow (`must-match.mjs`) on
2026-11-10, from the SQD Network portal: the latest successful `depositNative`
calls sent to the periphery, up to 200 on each chain. The descriptor refuses
those that carry a message, and none for its spoke pool or input token:

| Chain        | Calls read (senders) | From (UTC)       | Refused  | Their senders |
| ------------ | -------------------- | ---------------- | -------- | ------------- |
| Ethereum     | 200 (166)            | 2026-11-10 00:11 | 76 (38%) | 69            |
| Base         | 72 (72)              | 2026-11-10 08:38 | 8 (11%)  | 8             |
| Arbitrum One | 200 (156)            | 2026-11-09 06:33 | 34 (17%) | 33            |

Each span ends at about 12:38 UTC on 2026-11-10. No sender sent more than 3 of
the refused calls, and 105 of their 118 messages are 2,048 bytes long. A
wallet shows these deposits an error instead of a screen, as the SpokePool
file does for a deposit with a message.

## Tests

4 cases from real transactions, copied as unsigned `rawTx` with their
`txHash`. Each `rawTx` was compared with its transaction on chain (chain,
sender nonce, target, value and calldata), and each transaction succeeded.
Each screen's Recipient and Depositor are the transaction's sender.

| Case                                         | Transaction                                                                                                 | Amount to Bridge         | Destination Chain | Relayer Must Send         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ | ----------------- | ------------------------- |
| Bridge ETH to Robinhood Chain - chain 1      | [`0x9e8b26f4…`](https://etherscan.io/tx/0x9e8b26f4cf8a0928def6146143e45461d889dd15f8ab8179bb6da5b7e3ae18d0) | 0.000045081927257443 ETH | Robinhood Chain   | 0.00004050818265893 WETH  |
| Bridge ETH to Ethereum - chain 8453          | [`0xf4a97a2b…`](https://basescan.org/tx/0xf4a97a2b4d20117e065808503c35ac870c55bcd6c612acc062689b9251eeb741) | 0.000029 ETH             | Ethereum Mainnet  | 0.000020634948333379 WETH |
| Bridge ETH to Ethereum, another - chain 8453 | [`0x965eba73…`](https://basescan.org/tx/0x965eba733f4f238e3a5559023879c1c263bcaaac75cb67f476c3b71920c3467c) | 0.001009596018 ETH       | Ethereum Mainnet  | 0.001001702141127569 WETH |
| Bridge ETH to Robinhood Chain - chain 42161  | [`0x3862e698…`](https://arbiscan.io/tx/0x3862e698c6e593531663267438f02035af025131e5b6e48c0f9090bc19e968ab)  | 0.03 ETH                 | Robinhood Chain   | 0.029981017148901755 WETH |

The output token of the two tests to Robinhood Chain (4663) is its WETH,
`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` (`WETH` for that chain in
Across's `generated/constants.json`), which no token list the tests use has.
Its `symbol()`, `name()` and `decimals()` on Robinhood Chain return WETH,
WETH and 18, as in the tests.

## Checks

On the registry at `8e484f1`, its latest commit on 2026-11-10, with the tools
its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify): no errors. Warnings:
  - "Missing display format" for the functions left out (Scope).
  - "Display label too long": the depositor's label, the SpokePool file's.
  - "Display intent too long": the interpolated intent, the SpokePool file's,
    is over Ledger's 30 characters, as are 495 of the 838 interpolated
    intents in the registry's v2 calldata descriptors.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 4 of 4 cases pass.
- `check-recommended-fields.js`: no suggestion.
