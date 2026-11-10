<!-- Pull request to ethereum/clear-signing-erc7730-registry, from the files
under submissions/registry/weth/. Title on the first line, body below it. -->

# weth: add WETH on OP Mainnet, Base and Arbitrum One

> **Not from the contract owner.** Written by B3Pay, which is not affiliated
> with the WETH contracts, Optimism, Base or Offchain Labs. No one from those
> teams has reviewed it.

Adds the WETH contracts of three more chains, with the existing Wrap and
Unwrap screens. None of them is in the calldata index today.

| Chain                | Contract                                     | Code                                        | File                                   |
| -------------------- | -------------------------------------------- | ------------------------------------------- | -------------------------------------- |
| OP Mainnet (10)      | `0x4200000000000000000000000000000000000006` | WETH9, the OP Stack predeploy               | `calldata-weth.json`, deployment added |
| Base (8453)          | `0x4200000000000000000000000000000000000006` | WETH9, the OP Stack predeploy               | `calldata-weth.json`, deployment added |
| Arbitrum One (42161) | `0x82aF49447D8a07e3bd95BD0d56f35241523fBab1` | aeWETH behind a TransparentUpgradeableProxy | `calldata-aeWETH.json`, new            |

Wrap and unwrap calls among the latest 1,000 transactions to each contract,
read on 2026-11-06 from the SQD Network portal:

| Chain        | `deposit()`           | `withdraw(uint256)`   | Transactions a day |
| ------------ | --------------------- | --------------------- | ------------------ |
| OP Mainnet   | 55 calls, 17 senders  | 153 calls, 84 senders | about 1,600        |
| Base         | 54 calls, 40 senders  | 412 calls, 75 senders | about 15,000       |
| Arbitrum One | 320 calls, 43 senders | 383 calls, 81 senders | about 6,600        |

The rest are the ERC-20 `approve` and `transfer`, which `calldata-weth.json`
leaves out on mainnet as well.

## OP Mainnet and Base

`0x4200…0006` is the OP Stack's WETH9 predeploy. Sourcify has its source
(exact match on OP Mainnet, match on Base) and does not resolve it as a proxy.
Its `deposit()` and `withdraw(uint256 wad)` are the functions
`calldata-weth.json` formats, so the two deployments are added to that file
and its formats are unchanged. The file's hash changes, but `registry/weth/`
has no attestation (#2943 was closed), so none is invalidated.

## Arbitrum One

Arbitrum One's WETH is `aeWETH`, the bridged WETH of Arbitrum's token
bridge, behind a TransparentUpgradeableProxy whose implementation Sourcify
resolves to `0x8b194bEae1d3e0788A1a35173978001ACDFba668`. Its `withdraw`
names the parameter `amount`, not `wad`, so adding the deployment to
`calldata-weth.json` fails the linter (`A display field is defined for #.wad,
but it does not exist in function 0x2e1a7d4d ABI`). `calldata-aeWETH.json`
has the same two screens with that name, and the owner "WETH", as in
`calldata-weth.json` and in `permit/eip712-permit-arbitrum-weth.json`, which
already lists this address.

The proxy's admin can upgrade the implementation, so an attestation should
pin it.

Left out: aeWETH's `depositTo(address)` and `withdrawTo(address,uint256)`,
which wrap or unwrap to another account. Neither appeared in the 1,000
transactions, so there is no real transaction to test them with, and a wallet
keeps showing them as it does today.

## Tests

Six new cases, a Wrap and an Unwrap on each chain, all real transactions
copied as unsigned `rawTx` with their `txHash`. The two mainnet cases are
unchanged. Each `rawTx` was compared with its transaction on chain (chain,
sender nonce, target, value and calldata), and each transaction succeeded.

| Case                 | Transaction                                                                                                            | Screen                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Wrap - chain 10      | [`0xdee1f648…`](https://optimistic.etherscan.io/tx/0xdee1f6483281b1f3f557f5d436540314b47dad89f8a7cd81788612934a252e51) | Wrap, Amount 10.901539610897273 ETH      |
| Unwrap - chain 10    | [`0x1735e161…`](https://optimistic.etherscan.io/tx/0x1735e161f3b3931fda40e4287291982ea38f9ff80f7955427764607081ea55ae) | Unwrap, Amount 10.901540370069017 WETH   |
| Wrap - chain 8453    | [`0xf6f6493f…`](https://basescan.org/tx/0xf6f6493f3c60f7a625619bbb156e51a36dceed06239dab853acee2cd79ad1f00)            | Wrap, Amount 0.211124606128971106 ETH    |
| Unwrap - chain 8453  | [`0x6a546525…`](https://basescan.org/tx/0x6a5465258132db4e9f26318a8656b92480e9247754af76ae7be8da8e5991dc1e)            | Unwrap, Amount 0.000042632758011713 WETH |
| Wrap - chain 42161   | [`0x71b16b4e…`](https://arbiscan.io/tx/0x71b16b4e348e15dada346e4521624edbecc8a07b0dafebc6360722b6cc7a0be4)             | Wrap, Amount 0.115928 ETH                |
| Unwrap - chain 42161 | [`0x7186a91a…`](https://arbiscan.io/tx/0x7186a91afd69d2fbe0976cd214c449fc34c76b3135984a9e3c2234758348dd1c)             | Unwrap, Amount 0.115794594026661844 WETH |

## Checks

On the registry at `ef582c2`, with the tools its CI pins:

- Schemas (check-jsonschema 0.38.0): pass.
- `generate-index.js --validate`: no deployment is claimed twice.
- `erc7730 lint --require-verified` (python-erc7730 `ccd51ad`, ABIs from
  Sourcify): no errors, so Sourcify has verified source for every
  deployment, and the three WETH9 deployments expose the same functions.
  The warnings are all "Missing display format", for the functions left
  out: `approve`, `transfer` and `transferFrom` in `calldata-weth.json`, as
  on mainnet today, and in `calldata-aeWETH.json` those three and 14 more:
  `depositTo` and `withdrawTo` (above), `permit`, `increaseAllowance`,
  `decreaseAllowance`, `transferAndCall`, the bridge's `bridgeMint` and
  `bridgeBurn`, `initialize`, and the proxy's five admin functions.
- `check-selector-coverage.js`: every format has a test case.
- Sourcify runner `277965d` and Rust runner `8bfe6b4`: 8 of 8 cases pass.
- `check-recommended-fields.js` suggests an `interpolatedIntent` for the
  four Wrap and Unwrap formats. They are kept as `calldata-weth.json` has
  them on mainnet, so the screens are the same on every chain.
