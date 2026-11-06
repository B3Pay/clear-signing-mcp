# Clear Signing coverage tracker

The tracker answers one question for the contracts people sign to most on
Ethereum, Base, Arbitrum One and OP Mainnet: when a wallet that implements
ERC-7730 shows the transaction, does the
[Ethereum Foundation registry](https://github.com/ethereum/clear-signing-erc7730-registry)
have a descriptor that turns it into readable text, and for how much of what
people actually call? Its output, `coverage.json`, is published at
[b3pay.net/clear-signing/coverage](https://b3pay.net/clear-signing/coverage/).

Every number in it is measured from a named source at a stated time, and
reads only: nothing is signed, sent or submitted anywhere.

## The contract list

`contracts/*.json` lists the protocols and their user-facing entry points,
one file per research group. Each address comes from the protocol's own
deployment file, documentation or the registry, and the entry names that
source (`source`, `sourceKind`, `sourceNote`). `cli.js validate` checks the
list: EIP-55 addresses, known chains, https sources, no protocol or
deployment listed twice.

A contract taken out after review is named in its protocol's `notes`, with
the reason. Odos is out entirely: its app went read-only on 2026-07-27 and
its API was retired on 2026-07-30 (the team's announcement, reported by
Cointelegraph on 2026-07-24), so nothing generates calls to its router.

## The steps

```sh
pnpm tracker:build                             # tracker/ -> tracker/dist/
node tracker/dist/tracker/cli.js validate      # the contract list
node tracker/dist/tracker/cli.js fetch         # network: on-chain facts
node tracker/dist/tracker/cli.js report --registry <clone of the registry>
```

`fetch` reads, for each contract, from public services:

| Fact                                   | Source                                                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Bytecode size                          | Public RPC (publicnode, the chains' own), or `RPC_URL_<chainId>`                                                   |
| Verification, proxy, ABI               | Sourcify v2; Blockscout where Sourcify has none. Behind a proxy, the implementations' ABIs merged with the proxy's |
| Latest 1,000 transactions              | The SQD Network portal, for at most 30 days back; Blockscout `txlist` on Ethereum and OP Mainnet where it fails    |
| Two full transactions per top function | RPC, to build test vectors from real calldata                                                                      |
| Token symbol and decimals              | RPC multicall, for every address in those calls                                                                    |
| TVL                                    | DefiLlama, summed over the four chains                                                                             |

Transactions come from the
[SQD Network portal](https://docs.sqd.dev/en/api/evm/stream), which needs no
key: the latest 1,000 top-level transactions whose `to` is the contract,
scanned back from the finalized head for at most 30 days. Blockscout's
keyless `txlist` gives the same sample one contract per request, but it
rate-limited the runner within seconds on Ethereum and OP Mainnet (HTTP 429
for more than nine in ten of their contracts in one run), and answers it with a Cloudflare
challenge on Base and Arbitrum One; it is kept as the fallback on Ethereum and
OP Mainnet. One scan per chain asks about 50 contracts per request, in
windows each three times longer than the last; a contract leaves the scan once
it has its 1,000, so a busy one costs one short window and the quiet ones
share the long ones. The scan stops reading 10 minutes before a run's time
limit. A request the portal still refuses after eight tries (it answers 529
"overloaded" at times), or one the time limit cuts short, stops only its own
50 contracts, and keeps nothing of that window: each keeps every transaction
of the whole windows read before, and that span is recorded (`covered`).

`report` resolves each deployment's descriptor from a local clone of the
registry with Sourcify's `@ethereum-sourcify/clear-signing` library,
`includes` and all, as a wallet using the library resolves it, and checks
any ERC-8176 attestation the way the MCP server does (`--attestations`
adds the revocation check on Ethereum mainnet).

## What the numbers mean

- **Transactions per day**: the sample's transactions from the last 30 days
  over 30 when the sample reaches back that far (or holds every transaction
  of those 30 days); else, when the sample holds every transaction of a
  shorter span, its count over that span; else its count over the time
  between its oldest and newest transaction.
- **Share of recent transactions formatted**: of the sample's transactions
  with calldata, those whose 4-byte selector the descriptor formats. Plain
  transfers without calldata are left out.
- **Share of recent senders formatted**: the same, with each sender counted
  once per function it called. A relayer or keeper bot that sends hundreds
  of the same call counts once, so this is closer to what people see.
- **Status**: `covered` when the descriptor formats at least 95% of what
  recent senders called (by transactions when senders are unknown, by the
  ABI's state-changing functions when there were no recent calls);
  `partial` when it formats less, or its reach cannot be measured;
  `uncovered` when the registry has no descriptor for the deployment.
- **Described elsewhere**: for a deployment the registry does not list, its
  descriptor for another deployment (the same address on another chain, or
  another contract of the same protocol) whose every formatted function is
  in this contract's ABI, with the share of this contract's recent calls it
  formats, measured as above. The descriptor does not list this deployment,
  and whether it fits it is for the protocol to check; the totals count the
  contracts it would make `covered` if it did.
- **Totals** weight each contract's share by its transactions per day.
- **Attestation**: `verified` only when an ERC-8176 attestation by a trusted
  auditor verifies and is not revoked; never claimed otherwise.

## Where it runs

The sandbox this was built in cannot reach the services above, so the
`Tracker fetch` workflow (`.github/workflows/tracker-fetch.yml`) runs
`fetch` and `report` and commits `tracker/data/` to the branch it ran on.
A run starts no new contract after 80 minutes and skips contracts read in
the last 20 hours, so a long list is read over several runs.

## Data

`tracker/data/` is written by the workflow and kept byte for byte (sorted
keys, so a run that learns nothing changes nothing):

- `onchain/<chain>/<address>.json`: code size, Sourcify and Blockscout
  facts, the ABI's origin, the sample summary (counts per selector,
  distinct senders per selector, rate)
- `abis/<chain>/<address>.json`: the ABI users call through
- `samples/<chain>/<address>.json`: full recent transactions, unsigned
  fields only, for test vectors
- `tokens/<chain>.json`, `defillama.json`
- `coverage.json`: the report (`report-schema.ts`)

## Drafts

For the biggest gaps, B3Pay drafts a descriptor and tests it on the real
transactions in `samples/`. Drafts stay in this private repository; the
public report says only that a tested draft exists and shows one rendered
call. Nothing is submitted to the registry and no protocol is contacted
from here.

```sh
node tracker/dist/tracker/cli.js draft-top --limit 25 --registry <clone>  # from coverage.json
node tracker/dist/tracker/cli.js draft --chain <id> --address <0x...> --owner <name> \
  --registry <clone>
node tracker/dist/tracker/cli.js check-drafts --registry <clone> \
  --runner <clear-signing-test-runner> --python <venv>/bin/python
```

- `draft-top` drafts the contracts with no registry descriptor, busiest
  first by distinct senders a day, leaving out those whose calls a
  descriptor elsewhere already mostly formats (half or more): adding the
  deployment to it is the better change. A protocol's contract deployed under one
  name on several chains is drafted once, from its busiest deployment's
  transactions, with the others in its `deployments` when their ABI has
  every function it describes.
- `draft` writes `drafts/<protocol>/calldata-<Name>.json`, its
  `testsv2/` file (one test per format, from real transactions rebuilt
  unsigned, the expected text rendered by `@ethereum-sourcify/clear-signing`)
  and a review note listing what a person must check. The engine
  (`draftDescriptor` in `src/draft/`) is deterministic: no network, no model.
- With `--registry <clone>` (else `REGISTRY_DIR`), `draft` and `draft-top`
  render the tests against the clone `check-drafts` uses: a call that a
  `calldata` field carries, such as a multicall's inner call, is expected
  as the registry's descriptor for the contract it calls renders it, which
  is how the test runner renders it. The clone is indexed from its
  descriptor files, as the runner indexes them, rather than from
  `index.calldata.json`, which can lag them; it is read, never written or
  fetched. Without it, the tests index the draft alone: such a call is
  expected as raw bytes, the review note says so, and `check-drafts` fails
  that test when the registry describes the contract it calls.
- `check-drafts` checks each draft the way the registry's CI does: the v2
  schema, the registry's pinned `erc7730` linter (`lint_descriptor.py`, with
  the ABI read from `data/` rather than fetched), and the Sourcify test
  runner. Drafts that pass every check are listed in `drafts/summary.json`,
  which `report` reads for the public preview, with the share of the
  contract's recent calls each draft formats. A change to `drafts/` runs
  the `Tracker fetch` workflow again, so its report includes them.
