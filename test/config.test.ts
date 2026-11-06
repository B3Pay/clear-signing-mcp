import { describe, expect, it } from "vitest"
import { DEFAULT_ATTESTERS } from "../src/attestation.js"
import { ChainAccess } from "../src/chains.js"
import { loadConfig } from "../src/config.js"
import {
  createContext,
  revocationClient,
  SERVICE_LINK,
} from "../src/context.js"
import { easReader } from "./helpers.js"

describe("loadConfig", () => {
  it("has safe defaults", () => {
    expect(loadConfig({})).toEqual({
      registry: {
        repo: "ethereum/clear-signing-erc7730-registry",
        ref: "master",
      },
      rpcUrls: {},
      publicRpcFallback: true,
      sourcifyUrl: "https://sourcify.dev/server",
      fetchTimeoutMs: 10_000,
      serviceLink: true,
    })
  })

  it("reads an RPC URL per chain and ignores other names", () => {
    const config = loadConfig({
      RPC_URL_1: "https://eth.example.test/v2/key",
      RPC_URL_8453: " https://base.example.test ",
      RPC_URL_0: "https://zero.example.test",
      RPC_URL_abc: "https://abc.example.test",
      RPC_URL_10: "",
    })
    expect(config.rpcUrls).toEqual({
      1: "https://eth.example.test/v2/key",
      8453: "https://base.example.test/",
    })
  })

  it("refuses an RPC URL that is not http(s), without echoing it", () => {
    expect(() =>
      loadConfig({ RPC_URL_1: "ftp://example.test/secret" })
    ).toThrow("RPC_URL_1 must be an http or https URL")
    let message = ""
    try {
      loadConfig({ RPC_URL_1: "not a url SECRET" })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toBe("RPC_URL_1 is not a URL")
  })

  it("reads trusted attesters, naming the ones the registry lists", () => {
    const config = loadConfig({
      CLEAR_SIGNING_TRUSTED_ATTESTERS:
        "0x3846c3a30e62075fa916216b35ef04b8f53931f6, 0x000000000022d473030f116ddee9f6b43ac78ba3",
    })
    expect(config.trustedAttesters).toEqual([
      DEFAULT_ATTESTERS[0],
      { address: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
    ])
    expect(() =>
      loadConfig({ CLEAR_SIGNING_TRUSTED_ATTESTERS: "0x1234" })
    ).toThrow("not an address")
  })

  it("reads the flags, the time limit and the registry source", () => {
    const config = loadConfig({
      CLEAR_SIGNING_PUBLIC_RPC: "0",
      CLEAR_SIGNING_SERVICE_LINK: "false",
      CLEAR_SIGNING_TIMEOUT_MS: "2500",
      CLEAR_SIGNING_REGISTRY_REPO: "b3pay/registry-fork",
      CLEAR_SIGNING_REGISTRY_REF: "v1.2",
      SOURCIFY_SERVER_URL: "http://localhost:5555",
    })
    expect(config).toMatchObject({
      publicRpcFallback: false,
      serviceLink: false,
      fetchTimeoutMs: 2_500,
      registry: { repo: "b3pay/registry-fork", ref: "v1.2" },
      sourcifyUrl: "http://localhost:5555/",
    })
  })

  it.each([
    [
      { CLEAR_SIGNING_PUBLIC_RPC: "maybe" },
      "CLEAR_SIGNING_PUBLIC_RPC must be 1 or 0",
    ],
    [{ CLEAR_SIGNING_TIMEOUT_MS: "50" }, "from 100 to 120000"],
    [{ CLEAR_SIGNING_TIMEOUT_MS: "ten" }, "from 100 to 120000"],
    [
      { SOURCIFY_SERVER_URL: "file:///etc/passwd" },
      "must be an http or https URL",
    ],
  ])("refuses %o", (env, message) => {
    expect(() => loadConfig(env)).toThrow(message)
  })
})

describe("createContext", () => {
  it("trusts the registry's auditors and links the descriptor service by default", () => {
    const context = createContext(loadConfig({}))
    expect(context.attesters).toBe(DEFAULT_ATTESTERS)
    expect(context.serviceLink).toBe(SERVICE_LINK)
    expect(context.registry.label).toBe(
      "ethereum/clear-signing-erc7730-registry@master"
    )
  })

  it("leaves the link out when it is turned off", () => {
    expect(
      createContext(loadConfig({ CLEAR_SIGNING_SERVICE_LINK: "0" })).serviceLink
    ).toBeNull()
  })

  it("checks revocations through Ethereum mainnet unless told otherwise", () => {
    expect(
      revocationClient(
        createContext(loadConfig({ CLEAR_SIGNING_PUBLIC_RPC: "0" }))
      )
    ).toBeUndefined()
    expect(revocationClient(createContext(loadConfig({})))).toBeDefined()
    expect(
      revocationClient(
        createContext(loadConfig({}), { attestationChainClient: null })
      )
    ).toBeUndefined()
    const reader = easReader(false)
    expect(
      revocationClient(
        createContext(loadConfig({}), { attestationChainClient: reader })
      )
    ).toBe(reader)
  })
})

describe("ChainAccess", () => {
  const chains = new ChainAccess({
    urls: {
      1: "https://eth.example.test/v2/SECRET/",
      777: "http://127.0.0.1:8545",
    },
    publicFallback: false,
    timeoutMs: 1_000,
  })

  it("describes an RPC by its host only", () => {
    expect(chains.describe(1)).toEqual({
      chainId: 1,
      chain: "Ethereum",
      rpc: "configured",
      host: "eth.example.test",
    })
    expect(chains.describe(8453)).toEqual({
      chainId: 8453,
      chain: "Base",
      rpc: "none",
    })
    expect(chains.describe(777)).toEqual({
      chainId: 777,
      rpc: "configured",
      host: "127.0.0.1:8545",
    })
  })

  it("falls back to a public RPC only for the chains it knows", () => {
    const fallback = new ChainAccess({
      urls: {},
      publicFallback: true,
      timeoutMs: 1_000,
    })
    expect(fallback.describe(8453).rpc).toBe("public")
    expect(fallback.describe(777).rpc).toBe("none")
    expect(fallback.client(777)).toBeUndefined()
  })

  it("makes a client for a configured chain it does not know", () => {
    expect(chains.client(777)?.chain?.id).toBe(777)
    expect(chains.client(8453)).toBeUndefined()
  })

  it("takes configured RPC URLs out of text, with or without the trailing slash", () => {
    expect(
      chains.redact(
        "failed: https://eth.example.test/v2/SECRET/ and https://eth.example.test/v2/SECRET"
      )
    ).toBe("failed: <RPC_URL_1> and <RPC_URL_1>")
  })

  it("names the native currency only on chains it knows", () => {
    expect(chains.nativeSymbol(8453)).toBe("ETH")
    expect(chains.nativeSymbol(777)).toBe("native token")
    expect(chains.chainInfo(10)).toEqual({
      name: "OP Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    })
    expect(chains.chainInfo(777)).toBeNull()
  })

  it("reports no token details without an RPC", async () => {
    expect(
      await chains.token(8453, "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")
    ).toBeNull()
  })
})
