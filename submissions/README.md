# Registry submissions

Descriptors B3Pay proposes to the Ethereum Foundation's
[ERC-7730 registry](https://github.com/ethereum/clear-signing-erc7730-registry),
finished by hand from the tracker's drafts (`tracker/drafts/`), each with tests
made from real transactions. Nothing here has been submitted: a pull request to
the registry is opened only after Behrad approves that pull request. None of
these descriptors is attested. Merging does not attest a descriptor, and the
registry's auditors attest one only when its submitter is plausibly affiliated
with the protocol, which B3Pay is not for these.

| Path            | What it holds                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `registry/`     | The files as they would be submitted, at their paths under the registry's `registry/` folder, in its format (`erc7730 format`) |
| `cases/`        | For each test file, the real transactions its tests are made from                                                              |
| `pr/`           | The title and text of each registry pull request                                                                               |
| `REGISTRY_BASE` | The registry commit that copies of files the registry already has were made from                                               |
| `tools/`        | The scripts below                                                                                                              |

## Status

| Registry pull request                                                         | Files                                                                                | New deployments | Tests    | State              |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------- | -------- | ------------------ |
| [weth: WETH on OP Mainnet, Base and Arbitrum One](pr/weth.md)                 | `weth/calldata-weth.json` (two deployments added), `weth/calldata-aeWETH.json` (new) | 3               | 8, 6 new | Waiting for review |
| [uniswap: Permit2 on Ethereum, OP Mainnet, Base, Arbitrum One](pr/uniswap.md) | `uniswap/calldata-Permit2.json` (new)                                                | 4               | 13       | Waiting for review |

## The registry's process

Checked on 2026-11-10 in the registry's README, `docs/REVIEWING.md`,
`auditors/README.md` and workflows at `ef582c2`:

- A pull request from a fork changes one entity folder, `registry/<entity>/`.
  Each descriptor has a `testsv2/<name>.tests.json` with a case for every
  function it formats, and `$schema` is the relative path
  `../../specs/erc7730-v2.schema.json`.
- CI validates the schemas (check-jsonschema 0.38.0), builds the index (no
  deployment claimed by two descriptors), checks file names and that no
  attested descriptor changed, lints with `erc7730 lint --require-verified`
  (python-erc7730 at `ccd51ad`, which reads ABIs from Sourcify, so a deployment
  Sourcify has not verified fails), checks that every function has a test case,
  and runs the cases through the Sourcify and Rust test runners at pinned
  commits. An advisory AI review follows, then a maintainer's review in a merge
  queue.
- Reviewers read intents and hidden fields: an intent says what the function
  does in the person's terms, and amounts, spenders, recipients and deadlines
  are never hidden.

## Making tests

```sh
pnpm tracker:build
node submissions/tools/build-tests.mjs submissions/cases/weth/calldata-weth.cases.json \
  --registry <registry clone> --runner <built Sourcify test runner> [--chains <chains_mini.json>]
```

For each case, `build-tests.mjs` takes the transaction from the tracker's
samples (`tracker/data/samples/`), checks that it went to a deployment of the
descriptor on that chain and succeeded, rebuilds it unsigned, and writes the
test with the text the Sourcify test runner renders for it, which it prints.
It records what the runner shows, not what is right: read each rendering
before keeping it. `--chains` serves the runner's chain list from a file, for a
machine that cannot reach chainid.network.

## Checking

`tools/check.sh` runs the registry's pull-request checks on `registry/` laid
over a scratch clone of the registry, with the tools the registry pins.
`tools/verify-txs.mjs` reads every test's transaction back from its chain over
public RPCs and compares it with the test's `rawTx`: chain, sender nonce,
target, value and calldata, and that it succeeded. Public endpoints are full
nodes that prune old receipts, so for an older transaction the status comes
from the chain's Blockscout, and the result says so.

The `Registry submission checks` workflow runs both on every change here,
against the registry's latest commit: the linter against live Sourcify, both
test runners, and then a deliberate fault (a wrong expected value, two swapped
transaction hashes) that both runners and the transaction check must report.

Where Sourcify, chainid.network and public RPCs are out of reach, `check.sh
--offline` lints with the tracker's ABIs (`tracker/data/abis/`) instead and
says that Sourcify verification was not checked; `--rust` is optional, and
without it the result says the Rust runner did not run.

A file the registry already has, like `weth/calldata-weth.json`, is submitted
as a whole copy made from the registry at `REGISTRY_BASE`. `check.sh` fails
when the registry has changed that file since, so the copy is rebased first
instead of reverting someone else's change.
