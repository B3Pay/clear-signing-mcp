import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { beforeAll, describe, expect, it } from "vitest"
import { VERSION } from "../src/version.js"

/**
 * The published entry point, built and run as a person's MCP client runs it:
 * `node dist/cli.js` over stdio. Nothing here reaches the network.
 */

const root = fileURLToPath(new URL("..", import.meta.url))
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url))

beforeAll(() => {
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc")
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json"], {
    cwd: root,
    stdio: "pipe",
  })
}, 120_000)

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
    timeout: 20_000,
  })
}

describe("the clear-signing-mcp command", () => {
  it("has the package's version", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { version: string }
    expect(VERSION).toBe(pkg.version)
    const result = run(["--version"])
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(`${VERSION}\n`)
  })

  it("prints its environment variables with --help", () => {
    const result = run(["--help"])
    expect(result.status).toBe(0)
    for (const name of [
      "RPC_URL_<chainId>",
      "CLEAR_SIGNING_REGISTRY_REPO",
      "CLEAR_SIGNING_TRUSTED_ATTESTERS",
    ]) {
      expect(result.stdout).toContain(name)
    }
  })

  it("exits with status 2 and a reason on stderr when its configuration is wrong", () => {
    const result = run([], { CLEAR_SIGNING_TIMEOUT_MS: "5" })
    expect(result.status).toBe(2)
    expect(result.stdout).toBe("")
    expect(result.stderr).toContain(
      "CLEAR_SIGNING_TIMEOUT_MS must be a whole number"
    )
  })

  it("serves its tools over stdio", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli],
      env: { PATH: process.env.PATH ?? "", CLEAR_SIGNING_PUBLIC_RPC: "0" },
      stderr: "pipe",
    })
    const client = new Client({ name: "stdio-test", version: "0.0.0" })
    await client.connect(transport)
    try {
      const { tools } = await client.listTools()
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "clear_signing_status",
        "explain_signature",
        "explain_transaction",
        "simulate_transaction",
      ])
      const result = await client.callTool({
        name: "simulate_transaction",
        arguments: {
          chainId: 1,
          from: "0x00000000000000000000000000000000000b0b00",
          calls: [{ to: "0x00000000000000000000000000000000000b0b00" }],
        },
      })
      expect(result.isError).toBe(true)
    } finally {
      await client.close()
    }
  })
})
