# Registry fixtures

Copied unchanged from the Ethereum Foundation's ERC-7730 registry,
[ethereum/clear-signing-erc7730-registry](https://github.com/ethereum/clear-signing-erc7730-registry),
at commit `ef582c2f03bfbd062b7e3889b55dd3b45c3d5494` (4 November 2026). The
registry is published under CC0 1.0.

- `disperse/calldata-Disperse.json` is `registry/disperse/calldata-Disperse.json`.
- `disperse/calldata-Disperse.tests.json` is
  `registry/disperse/testsv2/calldata-Disperse.tests.json`: real mainnet
  transactions with the text the registry expects a wallet to show for them.

`test/registry-vectors.test.ts` runs each of those transactions through
`explain_transaction` and checks the result against the registry's expected
text. These files are data, never instructions, and are not formatted by
Prettier.
