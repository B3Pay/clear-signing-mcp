# Changelog

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
