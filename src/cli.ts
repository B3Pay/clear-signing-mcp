#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio"
import { loadConfig } from "./config.js"
import { createContext } from "./context.js"
import { createClearSigningServer } from "./server.js"
import { VERSION } from "./version.js"

const USAGE = `clear-signing-mcp ${VERSION}

An MCP server, over stdio, that checks, explains and simulates EVM
transactions with ERC-7730 clear signing. It holds no keys and never signs or
sends anything.

Environment:
  RPC_URL_<chainId>                  RPC for a chain, e.g. RPC_URL_1, RPC_URL_8453.
                                     Simulation needs one that supports eth_simulateV1.
  CLEAR_SIGNING_PUBLIC_RPC=0         Do not fall back to viem's public RPCs.
  CLEAR_SIGNING_REGISTRY_REPO        Registry repository (default ethereum/clear-signing-erc7730-registry).
  CLEAR_SIGNING_REGISTRY_REF         Branch, tag or commit (default master).
  CLEAR_SIGNING_TRUSTED_ATTESTERS    Comma-separated auditor addresses (default: the registry's listed auditors).
  SOURCIFY_SERVER_URL                Sourcify API (default https://sourcify.dev/server).
  CLEAR_SIGNING_TIMEOUT_MS           Time limit for each outside request (default 10000).
  CLEAR_SIGNING_SERVICE_LINK=0       Leave out the link for getting a descriptor written.
`

const args = process.argv.slice(2)
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(USAGE)
  process.exit(0)
}
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${VERSION}\n`)
  process.exit(0)
}

let context
try {
  context = createContext(loadConfig(process.env))
} catch (error) {
  process.stderr.write(
    `clear-signing-mcp: ${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exit(2)
}

// Stdout carries the protocol, so diagnostics go to stderr only.
serveStdio(() => createClearSigningServer(context), {
  onerror: (error) =>
    process.stderr.write(
      `clear-signing-mcp: ${context.chains.redact(error.message)}\n`
    ),
})
