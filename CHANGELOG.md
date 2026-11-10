# Changelog

## Unreleased

### Added

- `draftDescriptor`: an ERC-7730 v2 calldata descriptor drafted from an ABI
  and real transactions, with a `testsv2` file whose expected text
  `@ethereum-sourcify/clear-signing` renders, and the points a person must
  review. Deterministic; no network.
- The coverage tracker (`tracker/`): a curated list of 564 contracts of 96
  protocols on Ethereum, Base, Arbitrum One and OP Mainnet, read by the
  `Tracker fetch` workflow (Sourcify, Blockscout, the SQD portal, public
  RPCs, DefiLlama; read-only), scored against the registry by the share of
  recent senders whose calls it formats, with the registry's descriptor for
  another deployment that already formats a contract's calls (one the
  protocol's entry names counts, such as OKX's for its older routers), and drafts
  for the biggest gaps, checked with the registry's schema, pinned linter
  and test runner, with the share of each contract's calls they would
  format. Contracts found shut down, sunset or not signed to on review are
  left out, and their protocol's notes say why.

- Registry submissions (`submissions/`): WETH on OP Mainnet, Base and Arbitrum
  One, Permit2 on Ethereum, OP Mainnet, Base and Arbitrum One, Aero's Slipstream
  SwapRouter and NonfungiblePositionManager on the same four chains,
  PancakeSwap's Smart Router on Ethereum, Base and Arbitrum One, the OpenOcean
  Exchange on Ethereum, OP Mainnet, Base and Arbitrum One, the ETH deposits of
  Across's SpokePoolPeriphery on Ethereum, Base and Arbitrum One, deBridge's
  DlnSource orders on Ethereum and Base, and the swaps of deBridge's router on
  Ethereum, OP Mainnet, Base and Arbitrum One, and its swaps that create a
  DlnSource order on Ethereum and Base, finished by hand from the tracker's
  drafts, with 84 new test cases made from real transactions (4 of them a
  batch's action sent alone) and the text of each registry pull request. `check.sh` runs the registry's
  pull-request checks on them with the tools it pins, and lets through only the
  "not verified" errors of the deployments that `UNVERIFIED` lists as waiting
  for their owner to verify them on Sourcify (`lint-verdict.mjs`),
  `verify-txs.mjs` reads every test transaction back from its chain,
  `multicall-actions.mjs` counts the actions in each contract's latest batch
  calls, `must-match.mjs` counts the latest calls that a descriptor's
  `mustMatch` fields refuse and who sent them, `dln-orders.mjs` reads what
  deBridge's latest DLN orders carry and picks real ones to test with,
  `verified-sources.mjs` compares the source Sourcify has verified at each
  deployment of a descriptor, through its proxy, and the
  `Registry submission checks` and `Registry submission batches` workflows run
  all six, with the Rust test runner and the linter against live Sourcify, then
  require that a deliberate fault is caught.

- The tracker's report names a real call for each of a contract's
  most-called functions (`exampleTx`): the newest transaction in its kept
  sample that sent that function to the contract and succeeded, so the
  coverage pages can open it in the playground.

### Fixed

- The tracker's draft previews: a draft that lists the same contract on
  several chains, or several deployments, showed the call it was tested on
  under every one of them, so 29 deployments showed a call sent on another
  chain or to another contract, linked to the wrong explorer. Each
  deployment now shows only a call made to it.

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
