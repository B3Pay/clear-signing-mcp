<!-- Pull request to ethereum/clear-signing-erc7730-registry, from the files
under submissions/registry/uniswap/. Title on the first line, body below it. -->

# uniswap: add Permit2 calldata descriptor (Ethereum, OP Mainnet, Base, Arbitrum One)

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with Uniswap Labs. Uniswap Labs has not reviewed it.

Adds a calldata descriptor for Permit2,
`0x000000000022D473030F116dDEE9F6B43aC78BA3`, on Ethereum, OP Mainnet, Base
and Arbitrum One, next to `eip712-uniswap-permit2.json`, which shows the
Permit2 messages people sign. The transactions people send to Permit2
themselves are in no descriptor, so wallets blind-sign them; most of them are
`approve`. Permit2 is not upgradeable, and Sourcify has its source on all four
chains.

## Scope

Calls among the latest 1,000 transactions to Permit2 on each chain (on OP
Mainnet, all 119 of the last 30 days), read on 2026-11-06 from the SQD Network
portal, as calls (distinct senders). The described functions are in bold.

| Function                        | Ethereum  | OP Mainnet | Base      | Arbitrum One |
| ------------------------------- | --------- | ---------- | --------- | ------------ |
| **`approve`**                   | 713 (223) | 27 (18)    | 958 (161) | 511 (350)    |
| **`lockdown`**                  | 35 (17)   | 14 (9)     | 2 (2)     | 141 (83)     |
| **`invalidateUnorderedNonces`** | 41 (24)   |            |           |              |
| **`invalidateNonces`**          | 2 (1)     |            |           | 8 (1)        |
| `permit`, single                | 117 (3)   | 37 (3)     | 6 (2)     | 228 (3)      |
| `permit`, batch                 |           | 2 (1)      |           |              |
| `transferFrom`, single          | 13 (2)    | 8 (3)      | 6 (1)     | 4 (1)        |
| `transferFrom`, batch           | 40 (3)    | 19 (3)     | 12 (2)    | 27 (5)       |
| `permitTransferFrom`, single    | 39 (1)    | 9 (1)      | 14 (1)    | 62 (2)       |
| `permitTransferFrom`, batch     |           | 3 (1)      | 1 (1)     | 3 (1)        |
| `permitWitnessTransferFrom`     |           |            | 1 (1)     | 16 (3)       |

**Described:** the four functions an account sends to manage its own Permit2
allowances and signatures, 2,452 of the 3,119 transactions.

**Left out:** `permit`, `transferFrom`, `permitTransferFrom` and
`permitWitnessTransferFrom`. They submit a signature that an owner already
signed as an EIP-712 message, which `eip712-uniswap-permit2.json` shows, or
spend an allowance an owner already granted, and they are sent by routers,
relayers and solvers: 1 to 5 senders per chain in the sample.

## What the screens say, and why

From the Permit2 source (`AllowanceTransfer.sol`, `SignatureTransfer.sol`,
`libraries/Allowance.sol`):

- `approve(token, spender, amount, expiration)`: "Authorize {spender} to
  spend {amount}", then Spender, Amount allowance, Token and Approval
  expires. The intent, "Authorize spending of token", and the labels
  Spender, Amount allowance and Approval expires are those of the
  `PermitSingle` screen in `eip712-uniswap-permit2.json`, which sets the same
  allowance by signature; Token is shown because the call names it.
  The call replaces the caller's allowance for `token` and `spender` with
  `amount` and `expiration`. `transferFrom` never decrements an allowance of
  `type(uint160).max`, so that amount shows as "Unlimited" (the 40-digit
  threshold of #2891).
  - An `expiration` of 0 is stored as the block's timestamp, so the
    allowance works only within that block. The `date` format shows 0 as
    `1970-01-01 00:00:00Z`, as the `PermitSingle` screen does for the same
    value. One test case has it.
- `lockdown(approvals)`: "Revoke token approvals", each pair shown as Token
  and Spender under "Approval {index}". The call sets the caller's allowance
  for each pair to 0.
- `invalidateNonces(token, spender, newNonce)`: "Cancel signed approvals",
  with Token, Spender and New nonce. The call raises the caller's nonce for
  that pair, which voids every unused `PermitSingle` or `PermitBatch`
  signature for it with a lower nonce.
- `invalidateUnorderedNonces(wordPos, mask)`: "Cancel signed transfers". The
  call marks the masked nonces of the caller as used, which voids the
  `PermitTransferFrom` signatures that carry them. Both values are hidden:
  they are positions in a bitmap of nonces, and the call can only void the
  caller's own signatures.

## Tests

13 cases, one for each described function on each chain where the sample had
one, plus a zero amount on Ethereum and OP Mainnet and a zero amount and
expiration on Arbitrum One. All are real transactions copied as unsigned
`rawTx` with their `txHash`. Each `rawTx` was compared with its transaction on
chain (chain, sender nonce, target, value and calldata), and each transaction
succeeded.

| Case                                       | Transaction                                                                                                            | Screen                                                                                  |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Authorize spending of token - chain 1      | [`0xc218c367…`](https://etherscan.io/tx/0xc218c3679bcf7d61bd48acae54537cf7bff9b0443410c6d3cc762ed71c0c8a5a)            | Authorize 0x66a9…A8Af to spend 1382.84796954699448089 CEM, expires 2026-11-13 22:00:14Z |
| … zero amount - chain 1                    | [`0xe5a67a95…`](https://etherscan.io/tx/0xe5a67a95f39987d7e8a989513462f80ed1f02abc3ea478d007b887db9e9baf29)            | Authorize 0x2361…De85 to spend 0 USDC                                                   |
| … zero amount - chain 10                   | [`0x92dee42f…`](https://optimistic.etherscan.io/tx/0x92dee42f1baf39ae3671e5163ee6ea113fd404e49bcf3720be1b455ff3190c23) | Authorize 0xC092…11B4 to spend 0 USDT                                                   |
| Authorize spending of token - chain 8453   | [`0xe6b4c333…`](https://basescan.org/tx/0xe6b4c333f2807f913e0907af065cb77d77cc21c418647656c0f8528254cb8583)            | Authorize 0xd614…9c40 to spend 0.951414927516681485 DXTR                                |
| Authorize spending of token - chain 42161  | [`0x7c51f3de…`](https://arbiscan.io/tx/0x7c51f3de45b9d931335666c6a425fa9af71404d8df030d7ae7f0fe04fcac4115)             | Authorize 0x2d01…Fe65 to spend 0.285901948432601286 ARB                                 |
| … zero amount and expiration - chain 42161 | [`0x532b0f80…`](https://arbiscan.io/tx/0x532b0f8048b598ea12c1270ae1797644f06bdfc4a471eec51e696e16d5cbca10)             | Authorize 0x2d01…Fe65 to spend 0 USDC, expires 1970-01-01 00:00:00Z                     |
| Revoke token approvals - chain 1           | [`0xb81024eb…`](https://etherscan.io/tx/0xb81024eb18735392cf3012115d2d875d2d164de97e4f3ce9f16dc0d08008c18d)            | Token 0xA0b8…eB48 (USDC), Spender 0x2361…De85                                           |
| Revoke token approvals - chain 10          | [`0x781ef545…`](https://optimistic.etherscan.io/tx/0x781ef545f146d8903984d3faed3ca26d9daa6604abf0664fc995eb878e864833) | Token 0x0b2C…Ff85 (USDC), Spender 0xC092…11B4                                           |
| Revoke token approvals - chain 8453        | [`0x37bbab42…`](https://basescan.org/tx/0x37bbab42773baa3db5500f08e809f330b47a6c3863d532e78fb314d532cbe829)            | Token 0xe3CF…934d (PIGGY), Spender 0x7C5f…9bDc                                          |
| Revoke token approvals - chain 42161       | [`0x90da01fb…`](https://arbiscan.io/tx/0x90da01fbc07f356421f13e592db46963622fe28aa8553f8c951803a8a93038d6)             | Token 0xaf88…5831 (USDC), Spender 0x2d01…Fe65                                           |
| Cancel signed approvals - chain 1          | [`0x113b3e20…`](https://etherscan.io/tx/0x113b3e203878d29daadaac3d19eb1253953f95ac1a10691f3f21f082af4e2a4d)            | Token 0xA0b8…eB48 (USDC), Spender 0xbD21…ee9e, New nonce 13                             |
| Cancel signed approvals - chain 42161      | [`0x6412532a…`](https://arbiscan.io/tx/0x6412532a9b5544cf537a7f4bf3b30835522ffa43d226becb2179f57369db9633)             | Token 0xaf88…5831 (USDC), Spender 0xd88F…d869, New nonce 40                             |
| Cancel signed transfers - chain 1          | [`0xc27cf478…`](https://etherscan.io/tx/0xc27cf4787d7f1eee15780b574ed54c0e7e6b14f727f6c459f984f8527738ea8a)            | Cancel signed transfers                                                                 |

## Checks

On the registry at `ef582c2`, with the tools its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify): no errors, so Sourcify has verified source for all four
  deployments. Ten warnings:
  - "Missing display format" for the eight functions left out (Scope).
  - "Display intent too long": `Authorize {spender} to spend {amount}` is
    over Ledger's 30 characters, as are 441 of the 775 interpolated intents
    in the registry's v2 calldata descriptors.
  - "Missing display field" for `#.approvals.[]` in `lockdown`. The linter
    counts an array of tuples as a path of its own, so a screen that shows
    each member, here Token and Spender of each pair, still gets it. Run on
    the format signatures of the files already in the registry, its path
    check finds the same in 86 formats of 25 files, Safe's
    `calldata-BatchExecutor.json` and Seaport 1.6 among them.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 13 of 13 cases pass.
- `check-recommended-fields.js` suggests an `interpolatedIntent` for
  `lockdown`, `invalidateNonces` and `invalidateUnorderedNonces`, which have
  none: `lockdown` shows a list of pairs, and `invalidateUnorderedNonces`
  hides its two values. `invalidateNonces` could have one, and shows its
  token, spender and nonce as fields instead.
