import { readFileSync } from "node:fs"
import type {
  DisplayField,
  DisplayFieldGroup,
  TokenResult,
} from "@ethereum-sourcify/clear-signing"
import { getAddress, parseTransaction, type Hex } from "viem"
import { describe, expect, it } from "vitest"
import { ChainAccess } from "../src/chains.js"
import { explainCalls } from "../src/explain.js"
import { RegistryClient } from "../src/registry.js"
import { SourcifyClient } from "../src/sourcify.js"
import { FakeWeb, RAW } from "./helpers.js"

/**
 * The registry's own test vectors: real mainnet transactions and the text the
 * registry expects a wallet to show for each. Token details come from the
 * vector's data provider, as in the registry's test runner.
 */

interface Vector {
  readonly dataProvider: {
    readonly tokens: Record<
      string,
      { name: string; symbol: string; decimals: number }
    >
  }
  readonly tests: readonly {
    readonly description: string
    readonly rawTx: Hex
    readonly from: string
    readonly expected: {
      readonly intent: string
      readonly interpolatedIntent: string
      readonly owner: string
      readonly fields: readonly {
        readonly label: string
        readonly value: string
      }[]
    }
  }[]
}

const DESCRIPTOR_PATH = "registry/disperse/calldata-Disperse.json"
const DISPERSE = "0xd152f549545093347a162dce210e7293f1452150"

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`./fixtures/registry/disperse/${name}`, import.meta.url),
      "utf8"
    )
  )
}

const vector = fixture("calldata-Disperse.tests.json") as Vector

/** Chain access whose token lookups answer from the vector, with no RPC at all. */
class VectorChains extends ChainAccess {
  constructor(private readonly known: Vector["dataProvider"]["tokens"]) {
    super({ urls: {}, publicFallback: false, timeoutMs: 1_000 })
  }

  override token(
    _chainId: number,
    address: string
  ): Promise<TokenResult | null> {
    return Promise.resolve(this.known[address.toLowerCase()] ?? null)
  }
}

function context() {
  const web = new FakeWeb()
    .json(`${RAW}index.calldata.json`, {
      [`eip155:1:${DISPERSE}`]: DESCRIPTOR_PATH,
    })
    .json(`${RAW}index.eip712.json`, {})
    .json(`${RAW}${DESCRIPTOR_PATH}`, fixture("calldata-Disperse.json"))
  return {
    registry: new RegistryClient({ fetch: web.fetch }),
    sourcify: new SourcifyClient({ fetch: web.fetch }),
    chains: new VectorChains(vector.dataProvider.tokens),
    attesters: [],
    attestationChainClient: null,
    serviceLink: null,
  }
}

function flatten(
  fields: readonly (DisplayField | DisplayFieldGroup)[]
): { label: string; value: string }[] {
  return fields.flatMap((field) =>
    "fields" in field && Array.isArray(field.fields)
      ? flatten(field.fields)
      : [
          {
            label: (field as DisplayField).label,
            value: (field as DisplayField).value,
          },
        ]
  )
}

describe("the registry's Disperse test vectors", () => {
  it("has the vectors this suite expects", () => {
    expect(vector.tests.map((test) => test.description)).toEqual([
      "disperseEther - chain 1",
      "disperseToken - chain 1",
      "disperseTokenSimple - chain 1",
    ])
  })

  it.each(vector.tests.map((test) => [test.description, test] as const))(
    "%s",
    async (_name, test) => {
      const tx = parseTransaction(test.rawTx)
      expect(tx.chainId).toBe(1)
      expect(tx.to?.toLowerCase()).toBe(DISPERSE)

      const result = await explainCalls(context(), {
        chainId: 1,
        from: test.from,
        calls: [
          {
            to: getAddress(tx.to ?? ""),
            data: tx.data ?? "0x",
            ...(tx.value ? { value: tx.value } : {}),
          },
        ],
      })

      expect(result.clearSigned).toBe(true)
      const [call] = result.calls
      expect(call?.status).toBe("clear_signed")
      expect(call?.intent).toBe(test.expected.intent)
      expect(call?.interpolatedIntent).toBe(test.expected.interpolatedIntent)
      expect(call?.metadata?.owner).toBe(test.expected.owner)
      expect(flatten(call?.fields ?? [])).toEqual(test.expected.fields)
    }
  )
})
