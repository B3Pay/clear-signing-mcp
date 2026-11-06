import { readFileSync } from "node:fs"
import { parseTransaction, type Hex } from "viem"
import { describe, expect, it } from "vitest"
import { loadConfig } from "../../src/config.js"
import { createContext } from "../../src/context.js"
import { explainCalls } from "../../src/explain.js"
import { clearSigningStatus } from "../../src/status.js"

/**
 * Against the real registry on GitHub: run with `pnpm test:live`. It catches
 * a change in the registry's index format or in a descriptor the offline
 * tests copy, which the fixtures cannot.
 */

const DISPERSE = "0xD152f549545093347A162Dce210e7293f1452150"

const context = createContext(loadConfig({ CLEAR_SIGNING_PUBLIC_RPC: "0" }))

describe("the live registry", () => {
  it("has an index this server reads whole", async () => {
    const index = await context.registry.index()
    expect(index.dropped).toBe(0)
    expect(Object.keys(index.calldataIndex).length).toBeGreaterThan(1_000)
    expect(Object.keys(index.typedDataIndex).length).toBeGreaterThan(100)
  })

  it("describes Disperse on Ethereum", async () => {
    const status = await clearSigningStatus(context, {
      chainId: 1,
      address: DISPERSE,
    })
    expect(status.clearSigned).toBe(true)
    expect(status.calldata.descriptorPath).toBe(
      "registry/disperse/calldata-Disperse.json"
    )
    expect(status.calldata.functions?.map((fn) => fn.selector)).toContain(
      "0xe63d38ed"
    )
  })

  it("still explains the registry's disperseEther vector as it expects", async () => {
    const vector = JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/registry/disperse/calldata-Disperse.tests.json",
          import.meta.url
        ),
        "utf8"
      )
    ) as {
      tests: {
        rawTx: Hex
        from: string
        expected: { interpolatedIntent: string }
      }[]
    }
    const test = vector.tests[0]
    if (!test) throw new Error("The Disperse vector has no tests")
    const tx = parseTransaction(test.rawTx)
    const result = await explainCalls(context, {
      chainId: 1,
      from: test.from,
      calls: [
        {
          to: tx.to ?? "",
          data: tx.data ?? "0x",
          ...(tx.value ? { value: tx.value } : {}),
        },
      ],
    })
    expect(result.calls[0]?.status).toBe("clear_signed")
    expect(result.calls[0]?.interpolatedIntent).toBe(
      test.expected.interpolatedIntent
    )
  })
})
