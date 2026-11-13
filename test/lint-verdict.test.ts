import { spawnSync } from "node:child_process"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// submissions/tools/lint-verdict.mjs reads what the registry's linter printed
// with --gha and lets through only the "not verified" errors of the
// deployments listed in submissions/UNVERIFIED.
const script = join(
  import.meta.dirname,
  "..",
  "submissions",
  "tools",
  "lint-verdict.mjs"
)
const router = "debridge/calldata-DeBridgeRouter.json"
const address = "0x663DC15D3C1aC63ff12E45Ab68FeA3F0a883C251"
const dir = mkdtempSync(join(tmpdir(), "lint-verdict-"))

function file(name: string, text: string): string {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

const list = file(
  "UNVERIFIED",
  [
    "# deployments that wait",
    `1:${address} ${router}`,
    `8453:${address} ${router}   # a comment`,
    `42161:${address} ${router}`,
    "",
  ].join("\n")
)

const unverified = (chainId: number, descriptor = router, addr = address) =>
  `::error file=registry/${descriptor},title=Proxy implementation not verified::contract ${addr} on chain ${chainId} is a proxy, and its implementation 0xCe56012E880851baa234cD092aF516A0fcA9CFe3 is not verified on Sourcify, display fields will not be validated against ABI`
const finished = "checked 12 v2 descriptor files, some errors found ❌"

interface Verdict {
  pass: boolean
  errors: string[]
  waiting: string[]
  verified: string[]
}

function verdict(lines: string[], status = "1", listFile = list): Verdict {
  const log = file(
    `log-${Math.random().toString(36).slice(2)}`,
    lines.join("\n") + "\n"
  )
  const run = spawnSync(
    process.execPath,
    [script, log, status, "--unverified", listFile],
    {
      encoding: "utf8",
    }
  )
  expect(run.status, run.stderr).toBe(0)
  return JSON.parse(run.stdout) as Verdict
}

function refused(listText: string): string {
  const log = file("refused.log", `${finished}\n`)
  const run = spawnSync(
    process.execPath,
    [
      script,
      log,
      "1",
      "--unverified",
      file(`list-${Math.random().toString(36).slice(2)}`, listText),
    ],
    { encoding: "utf8" }
  )
  expect(run.status).not.toBe(0)
  return run.stderr
}

const listed = (chainId: number) => `${chainId}:${address} ${router}`

describe("lint-verdict", () => {
  it("lets the listed deployments' not-verified errors through, as waiting", () => {
    const v = verdict([
      "🔍 checking 12 v2 descriptor files…",
      unverified(1),
      unverified(8453),
      unverified(42161),
      "::warning file=registry/aero/calldata-SwapRouter.json,title=Display intent too long::Display intent(s) exceed 30 characters",
      finished,
    ])
    expect(v).toEqual({
      pass: true,
      errors: [],
      waiting: [listed(1), listed(8453), listed(42161)],
      verified: [],
    })
  })

  it("reports a listed deployment without its error as verified", () => {
    const v = verdict([unverified(1), unverified(42161), finished])
    expect(v.pass).toBe(true)
    expect(v.waiting).toEqual([listed(1), listed(42161)])
    expect(v.verified).toEqual([listed(8453)])
  })

  it("reports every listed deployment as verified on a clean run", () => {
    const v = verdict(
      ["checked 12 v2 descriptor files, no errors found ✅"],
      "0"
    )
    expect(v).toEqual({
      pass: true,
      errors: [],
      waiting: [],
      verified: [listed(1), listed(8453), listed(42161)],
    })
  })

  it("matches the linter's lowercase address and a ./registry/ path", () => {
    const v = verdict([
      `::error file=./registry/${router},title=Contract not verified::contract ${address.toLowerCase()} on chain 1 is not verified on Sourcify, display fields will not be validated against ABI`,
      unverified(8453),
      unverified(42161),
      finished,
    ])
    expect(v.pass).toBe(true)
    expect(v.waiting).toEqual([listed(1), listed(8453), listed(42161)])
  })

  it("fails a deployment that is not listed", () => {
    const v = verdict([
      unverified(1),
      unverified(8453),
      unverified(42161),
      unverified(137),
      finished,
    ])
    expect(v.pass).toBe(false)
    expect(v.errors).toHaveLength(1)
    expect(v.errors[0]).toContain("on chain 137 ")
    expect(v.verified).toEqual([])
  })

  it("fails the same deployment in another descriptor", () => {
    const v = verdict([
      unverified(1),
      unverified(8453),
      unverified(42161, "debridge/calldata-DlnSource.json"),
      finished,
    ])
    expect(v.pass).toBe(false)
    expect(v.errors).toEqual([
      expect.stringContaining(
        "registry/debridge/calldata-DlnSource.json: Proxy implementation not verified"
      ),
    ])
  })

  it("fails any other error, in the listed descriptor too", () => {
    const v = verdict([
      unverified(1),
      unverified(8453),
      unverified(42161),
      `::error file=registry/${router},title=Invalid display field::field _foo is not in the ABI`,
      finished,
    ])
    expect(v.pass).toBe(false)
    expect(v.errors).toEqual([
      `registry/${router}: Invalid display field: field _foo is not in the ABI`,
    ])
  })

  it("does not take a listed deployment Sourcify did not answer for as verified", () => {
    const v = verdict([
      `::error file=registry/${router},title=Could not fetch ABI::Fetching reference ABI for chain id 1 failed, display fields will not be validated against ABI: Sourcify rate limit exceeded, please retry`,
      unverified(8453),
      unverified(42161),
      finished,
    ])
    expect(v.pass).toBe(false)
    expect(v.errors).toEqual([expect.stringContaining("Could not fetch ABI")])
    expect(v.verified).toEqual([])
  })

  it("fails a run that did not finish", () => {
    const v = verdict([unverified(1), "Traceback (most recent call last):"])
    expect(v.pass).toBe(false)
    expect(v.errors).toEqual([
      expect.stringContaining("the linter did not finish"),
    ])
    expect(v.verified).toEqual([])
  })

  it("fails a failing exit status with no error reported", () => {
    const v = verdict(
      ["checked 12 v2 descriptor files, some warnings found ⚠️"],
      "1"
    )
    expect(v.pass).toBe(false)
    expect(v.errors).toEqual([
      "the linter exited with status 1 and reported no error",
    ])
  })

  it("refuses a list it cannot hold to", () => {
    expect(refused(`1:0x663D ${router}\n`)).toContain(
      'not "<chainId>:<address> <descriptor>"'
    )
    expect(refused(`1:${address} debridge/calldata-Nope.json\n`)).toContain(
      "is not under submissions/registry/"
    )
    expect(refused(`137:${address} ${router}\n`)).toContain(
      `137:${address} is not a deployment of ${router}`
    )
  })
})
