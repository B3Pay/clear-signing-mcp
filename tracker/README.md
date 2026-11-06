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
| Latest 1,000 transactions              | Blockscout `txlist` on Ethereum and OP Mainnet; the SQD Network portal on Base and Arbitrum One                    |
| Two full transactions per top function | RPC, to build test vectors from real calldata                                                                      |
| Token symbol and decimals              | RPC multicall, for every address in those calls                                                                    |
| TVL                                    | DefiLlama, summed over the four chains                                                                             |

Base's and Arbitrum's Blockscout answer GitHub's runners with a Cloudflare
challenge, so those chains are sampled through the
[SQD portal](https://docs.sqd.dev/en/api/evm/stream), which needs no key: the
same sample, the latest 1,000 top-level transactions whose `to` is the
contract, scanned back from the finalized head for at most 30 days. One scan
per chain asks about 50 contracts per request, in windows each three times
longer than the last; a contract leaves the scan once it has its 1,000, so a
busy one costs one short window and the quiet ones share the long ones. The
scan stops reading 10 minutes before a run's time limit and drops the window
it was in; a contract still short of 1,000 then keeps every transaction of
the span the whole windows read, and that span is recorded (`covered`).

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
node tracker/dist/tracker/cli.js draft-top --limit 25    # from coverage.json
node tracker/dist/tracker/cli.js draft --chain <id> --address <0x...> --owner <name>
node tracker/dist/tracker/cli.js check-drafts --registry <clone> \
  --runner <clear-signing-test-runner> --python <venv>/bin/python
```

- `draft-top` drafts the contracts with no registry descriptor, busiest
  first by distinct senders a day. A protocol's contract deployed under one
  name on several chains is drafted once, from its busiest deployment's
  transactions, with the others in its `deployments` when their ABI has
  every function it describes.
- `draft` writes `drafts/<protocol>/calldata-<Name>.json`, its
  `testsv2/` file (one test per format, from real transactions rebuilt
  unsigned, the expected text rendered by `@ethereum-sourcify/clear-signing`)
  and a review note listing what a person must check. The engine
  (`draftDescriptor` in `src/draft/`) is deterministic: no network, no model.
- `check-drafts` checks each draft the way the registry's CI does: the v2
  schema, the registry's pinned `erc7730` linter (`lint_descriptor.py`, with
  the ABI read from `data/` rather than fetched), and the Sourcify test
  runner. Drafts that pass every check are listed in `drafts/summary.json`,
  which `report` reads for the public preview.
