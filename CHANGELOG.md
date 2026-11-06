# Changelog

## Unreleased

### Added

- `draftDescriptor`: an ERC-7730 v2 calldata descriptor drafted from an ABI
  and real transactions, with a `testsv2` file whose expected text
  `@ethereum-sourcify/clear-signing` renders, and the points a person must
  review. Deterministic; no network.
- The coverage tracker (`tracker/`): a curated list of 575 contracts of 97
  protocols on Ethereum, Base, Arbitrum One and OP Mainnet, read by the
  `Tracker fetch` workflow (Sourcify, Blockscout, the SQD portal, public
  RPCs, DefiLlama; read-only), scored against the registry by the share of
  recent senders whose calls it formats, with the registry's descriptor for
  another deployment that already formats a contract's calls, and drafts
  for the biggest gaps, checked with the registry's schema, pinned linter
  and test runner.

## 0.1.0 (unreleased)

First version: an MCP server over stdio with four read-only tools.

### Added

- `clear_signing_status`: whether the ERC-7730 registry describes a contract,
  the functions and EIP-712 messages it covers, ERC-8176 attestation status,
  and Sourcify verification, with proxy implementations.
- `explain_transaction`: one call or an EIP-5792 batch, formatted with the
  registry descriptor by `@ethereum-sourcify/clear-signing`, or decoded with
  the verified ABI from Sourcify and marked NOT CLEAR-SIGNED.
- `explain_signature`: an EIP-712 request formatted the same way, or returned
  as sent and marked NOT CLEAR-SIGNED.
- `simulate_transaction`: `eth_simulateV1` with `traceTransfers`; success or
  revert reason per call, the account's balance and NFT changes from the
  transfer events, and approvals with unlimited ones flagged.
- Attestations are reported as attested only after offline verification and
  a not-revoked answer from the EAS contract on Ethereum mainnet.
- Every string from a descriptor, contract or calldata is cleaned of control,
  bidirectional and invisible characters, bounded, and quoted.
- Configuration by environment variables; RPC URLs are kept out of results
  and errors.
