# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for a security vulnerability.**

Report it privately through GitHub's private vulnerability reporting:

1. Go to <https://github.com/B3Pay/clear-signing-mcp/security/advisories/new>
2. Describe the issue, the version, and how to reproduce it.

If private reporting is unavailable, open a public issue containing only
"security report — please provide a private contact" and no technical detail,
and a maintainer will follow up with a private channel.

## Threat model

The server reads three kinds of outside data, and an attacker may control any
of them:

- **Registry content.** Anyone can propose a descriptor, so labels and intents
  may be written to steer an agent ("ignore previous instructions"), to hide
  text from a person (bidirectional overrides, invisible characters), or to
  break the text result's layout (line breaks, quotes).
- **Contract data.** Token symbols and names, ABI names from Sourcify, revert
  reasons and event data come from contracts anyone can deploy.
- **Network answers.** GitHub, Sourcify and RPC endpoints can be slow, huge,
  malformed or wrong.

What the server guarantees:

- It never signs, sends or asks for a key; no tool writes to a chain.
- Every outside string reaches the agent cleaned (control, bidirectional and
  invisible characters spelled out), bounded, and JSON-quoted in text results.
- Only paths under `registry/` or `ercs/` of the configured registry are read.
- "Attested" is reported only after an ERC-8176 attestation from a trusted
  auditor verifies and the EAS contract on Ethereum mainnet says it was not
  revoked.
- Outside reads are bounded in time and size and fail closed.
- Configured RPC URLs never appear in results or error text.

What it does not guarantee: that a descriptor in the registry is honest. The
registry's review and the attestations are what vouch for a descriptor; the
server reports which of them apply. A simulation runs against the state the
RPC reports, and its result can differ from what happens when the transaction
is later sent.
