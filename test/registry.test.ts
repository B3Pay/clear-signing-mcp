import { describe, expect, it } from "vitest"
import {
  caip10,
  isRegistryPath,
  parseCalldataIndex,
  parseTypedDataIndex,
  RegistryClient,
} from "../src/registry.js"
import {
  attestationUrl,
  FakeWeb,
  PERMIT_ENCODE_TYPE_HASH,
  RAW,
  registryWeb,
  TOKEN,
  TOKEN_DESCRIPTOR_PATH,
  tokenDescriptor,
} from "./helpers.js"

describe("isRegistryPath", () => {
  it.each([
    "registry/uniswap/calldata-UniswapV3Router02.json",
    "registry/1inch/eip712-1inch-aggregation-router-v6.json",
    "ercs/calldata-erc20-tokens.json",
    "registry/morpho/calldata-mev_capital-USUALUSDC+.json",
    "registry/lido/sigs/calldata-stETH.eip155-1-0x3846c3A30E62075Fa916216b35EF04B8F53931f6.json",
  ])("accepts %s", (path) => {
    expect(isRegistryPath(path)).toBe(true)
  })

  it.each([
    "../../etc/passwd",
    "registry/../index.calldata.json",
    "registry/./calldata-x.json",
    "/registry/calldata-x.json",
    "registry//calldata-x.json",
    "registry/.hidden.json",
    "registry/x/calldata-x.txt",
    "specs/erc7730-v2.schema.json",
    "registry/x%2F..%2Fy.json",
    "registry/x y.json",
    "registry/x.json?raw=1",
    "registry\\calldata-x.json",
    "calldata-x.json",
    `registry/${"a".repeat(600)}.json`,
  ])("refuses %s", (path) => {
    expect(isRegistryPath(path)).toBe(false)
  })
})

describe("index parsing", () => {
  it("keeps well-formed calldata entries and counts the rest", () => {
    const { index, dropped } = parseCalldataIndex({
      [`eip155:1:${"ab".repeat(20)}`]: "registry/a/calldata-a.json",
      [`eip155:1:0x${"AB".repeat(20)}`]: "registry/a/calldata-a.json",
      "eip155:0:0x0000000000000000000000000000000000000001":
        "registry/a/calldata-a.json",
      "eip155:1:0x0000000000000000000000000000000000000002": "../x.json",
      "eip155:1:0x0000000000000000000000000000000000000003": 42,
      "eip155:1:0x0000000000000000000000000000000000000004":
        "registry/a/calldata-a.json",
    })
    expect(index).toEqual({
      "eip155:1:0x0000000000000000000000000000000000000004":
        "registry/a/calldata-a.json",
    })
    expect(dropped).toBe(5)
  })

  it("refuses an index that is not an object", () => {
    expect(() => parseCalldataIndex([])).toThrow("not a JSON object")
    expect(() => parseTypedDataIndex("x")).toThrow("not a JSON object")
  })

  it("keeps well-formed EIP-712 entries and counts the rest", () => {
    const key = "eip155:1:0x0000000000000000000000000000000000000001"
    const { index, dropped } = parseTypedDataIndex({
      [key]: {
        Permit: [
          {
            path: "registry/a/eip712-a.json",
            encodeTypeHashes: [PERMIT_ENCODE_TYPE_HASH],
          },
          {
            path: "../eip712-a.json",
            encodeTypeHashes: [PERMIT_ENCODE_TYPE_HASH],
          },
          { path: "registry/a/eip712-b.json", encodeTypeHashes: ["0x1234"] },
        ],
        Order: "not a list",
      },
      "eip155:1:not-an-address": { Permit: [] },
    })
    expect(index).toEqual({
      [key]: {
        Permit: [
          {
            path: "registry/a/eip712-a.json",
            encodeTypeHashes: [PERMIT_ENCODE_TYPE_HASH],
          },
        ],
      },
    })
    expect(dropped).toBe(4)
  })

  it("writes CAIP-10 keys in lowercase, as the index does", () => {
    expect(caip10(8453, TOKEN)).toBe(`eip155:8453:${TOKEN.toLowerCase()}`)
  })
})

describe("RegistryClient", () => {
  it("refuses a malformed repository or ref", () => {
    expect(
      () =>
        new RegistryClient({ source: { repo: "not a repo", ref: "master" } })
    ).toThrow("owner/name")
    expect(
      () => new RegistryClient({ source: { repo: "a/b", ref: "../../x" } })
    ).toThrow("not a valid")
    expect(
      () => new RegistryClient({ source: { repo: "a/b", ref: "main?x=1" } })
    ).toThrow("not a valid")
  })

  it("names its source and links files for people", () => {
    const registry = new RegistryClient({
      source: { repo: "b3pay/registry-fork", ref: "v1.2" },
    })
    expect(registry.label).toBe("b3pay/registry-fork@v1.2")
    expect(registry.webUrl(TOKEN_DESCRIPTOR_PATH)).toBe(
      `https://github.com/b3pay/registry-fork/blob/v1.2/${TOKEN_DESCRIPTOR_PATH}`
    )
  })

  it("reads both index files once, drops malformed entries, and reuses them", async () => {
    const web = registryWeb()
    const registry = new RegistryClient({ fetch: web.fetch })
    const [first, second] = await Promise.all([
      registry.index(),
      registry.index(),
    ])
    expect(first).toBe(second)
    expect(Object.keys(first.calldataIndex)).toHaveLength(3)
    expect(first.dropped).toBe(2)
    expect(web.count("index.calldata.json")).toBe(1)
    expect(web.count("index.eip712.json")).toBe(1)
  })

  it("reads the index again after its time limit", async () => {
    let now = 0
    const web = registryWeb()
    const registry = new RegistryClient({
      fetch: web.fetch,
      now: () => now,
      indexTtlMs: 1_000,
    })
    await registry.index()
    now = 1_000
    await registry.index()
    expect(web.count("index.calldata.json")).toBe(2)
  })

  it("reads from the configured repository and ref", async () => {
    const web = new FakeWeb()
    const registry = new RegistryClient({
      fetch: web.fetch,
      source: { repo: "b3pay/registry-fork", ref: "v1.2" },
    })
    await expect(registry.index()).rejects.toThrow("HTTP 404")
    expect(web.requests).toContain(
      "https://raw.githubusercontent.com/b3pay/registry-fork/v1.2/index.calldata.json"
    )
  })

  it("fails when the index cannot be read, and tries again next time", async () => {
    const web = new FakeWeb()
    const registry = new RegistryClient({ fetch: web.fetch })
    await expect(registry.index()).rejects.toThrow("HTTP 404")
    registryWeb(web)
    expect((await registry.index()).dropped).toBe(2)
  })

  it("reads a descriptor once and reuses it", async () => {
    const web = registryWeb()
    const registry = new RegistryClient({ fetch: web.fetch })
    expect(await registry.descriptor(TOKEN_DESCRIPTOR_PATH)).toEqual(
      tokenDescriptor()
    )
    await registry.descriptor(TOKEN_DESCRIPTOR_PATH)
    expect(web.count(TOKEN_DESCRIPTOR_PATH)).toBe(1)
  })

  it("encodes a file name's plus sign in the URLs it builds", async () => {
    const path = "registry/morpho/calldata-mev_capital-USUALUSDC+.json"
    const web = new FakeWeb().json(
      `${RAW}registry/morpho/calldata-mev_capital-USUALUSDC%2B.json`,
      tokenDescriptor()
    )
    const registry = new RegistryClient({ fetch: web.fetch })
    expect(await registry.descriptor(path)).toEqual(tokenDescriptor())
    expect(registry.webUrl(path)).toBe(
      "https://github.com/ethereum/clear-signing-erc7730-registry/blob/master/registry/morpho/calldata-mev_capital-USUALUSDC%2B.json"
    )
  })

  it("refuses a path outside the registry without making a request", async () => {
    const web = registryWeb()
    const registry = new RegistryClient({ fetch: web.fetch })
    await expect(registry.descriptor("../../etc/passwd")).rejects.toThrow(
      "Refusing to read"
    )
    await expect(
      registry.descriptor("registry/../index.calldata.json")
    ).rejects.toThrow("Refusing to read")
    expect(web.requests).toEqual([])
  })

  it("refuses a descriptor that is not a JSON object", async () => {
    const web = new FakeWeb().json(`${RAW}registry/x/calldata-x.json`, [
      "not",
      "an",
      "object",
    ])
    const registry = new RegistryClient({ fetch: web.fetch })
    await expect(
      registry.descriptor("registry/x/calldata-x.json")
    ).rejects.toThrow("not a JSON object")
  })

  it("answers null when an auditor published no attestation, at the registry's path for it", async () => {
    const web = registryWeb()
    const registry = new RegistryClient({ fetch: web.fetch })
    const attester = "0x3846c3a30e62075fa916216b35ef04b8f53931f6"
    expect(
      await registry.attestation(TOKEN_DESCRIPTOR_PATH, attester)
    ).toBeNull()
    expect(web.requests).toEqual([
      attestationUrl(TOKEN_DESCRIPTOR_PATH, attester),
    ])
    expect(web.requests[0]).toBe(
      `${RAW}registry/testtoken/sigs/calldata-TestToken.eip155-1-0x3846c3A30E62075Fa916216b35EF04B8F53931f6.json`
    )
  })

  it("refuses an attester that is not an address", async () => {
    const registry = new RegistryClient({ fetch: registryWeb().fetch })
    await expect(
      registry.attestation(TOKEN_DESCRIPTOR_PATH, "0x1234")
    ).rejects.toThrow("Invalid attester")
  })
})
