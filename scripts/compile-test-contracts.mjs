// Compiles test/contracts/TestToken.sol with solc-js and writes
// test/contracts/TestToken.json, the artifact the simulation tests deploy.
// The artifact is generated, never edited by hand: run this script again after
// changing the contract, then review the diff.
//
//   node scripts/compile-test-contracts.mjs
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const SOLC = "solc@0.8.37"
const root = fileURLToPath(new URL("..", import.meta.url))
const out = mkdtempSync(join(tmpdir(), "solc-"))
try {
  execFileSync(
    "pnpm",
    [
      "dlx",
      SOLC,
      "--bin",
      "--abi",
      "--optimize",
      "--base-path",
      root,
      "-o",
      out,
      join(root, "test/contracts/TestToken.sol"),
    ],
    { stdio: "inherit" }
  )
  const base = join(out, "test_contracts_TestToken_sol_TestToken")
  const artifact = {
    compiler: SOLC,
    optimize: true,
    abi: JSON.parse(readFileSync(`${base}.abi`, "utf8")),
    bytecode: `0x${readFileSync(`${base}.bin`, "utf8").trim()}`,
  }
  writeFileSync(
    join(root, "test/contracts/TestToken.json"),
    `${JSON.stringify(artifact, null, 2)}\n`
  )
  console.log("wrote test/contracts/TestToken.json")
} finally {
  rmSync(out, { recursive: true, force: true })
}
