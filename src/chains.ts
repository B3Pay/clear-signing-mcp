import type {
  ChainClient,
  ChainInfoResult,
  ExternalDataProvider,
  TokenResult,
} from "@ethereum-sourcify/clear-signing"
import {
  createPublicClient,
  defineChain,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem"
import {
  arbitrum,
  base,
  baseSepolia,
  mainnet,
  optimism,
  sepolia,
} from "viem/chains"
import { TtlCache } from "./fetch.js"
import { cleanText } from "./text.js"

/**
 * Chain access through viem. Ethereum, Base, Arbitrum and Optimism are read
 * from; Sepolia and Base Sepolia are there for testing. Any other chain works
 * when an RPC URL is configured for it.
 */

export const KNOWN_CHAINS: Readonly<Record<number, Chain>> = {
  [mainnet.id]: mainnet,
  [base.id]: base,
  [arbitrum.id]: arbitrum,
  [optimism.id]: optimism,
  [sepolia.id]: sepolia,
  [baseSepolia.id]: baseSepolia,
}

export interface RpcConfig {
  /** RPC URL per chain ID, from `RPC_URL_<chainId>`. */
  readonly urls: Readonly<Record<number, string>>
  /** Fall back to viem's public RPC for the known chains when none is configured. */
  readonly publicFallback: boolean
  readonly timeoutMs: number
}

export interface RpcDescription {
  readonly chainId: number
  readonly chain?: string
  /** `configured`: an operator's RPC; `public`: viem's default public RPC; `none`: no chain access. */
  readonly rpc: "configured" | "public" | "none"
  readonly host?: string
}

export class ChainAccess {
  private readonly clients = new Map<number, PublicClient>()
  private readonly tokens: TtlCache<TokenResult | null>
  private readonly collections: TtlCache<string | null>

  constructor(private readonly config: RpcConfig) {
    this.tokens = new TtlCache(60 * 60_000, 2048)
    this.collections = new TtlCache(60 * 60_000, 1024)
  }

  private url(
    chainId: number
  ): { url: string; kind: "configured" | "public" } | undefined {
    const configured = this.config.urls[chainId]
    if (configured) return { url: configured, kind: "configured" }
    const known = KNOWN_CHAINS[chainId]
    const fallback = known?.rpcUrls.default.http[0]
    if (this.config.publicFallback && fallback)
      return { url: fallback, kind: "public" }
    return undefined
  }

  /** The viem client for `chainId`, or `undefined` when there is no RPC for it. */
  client(chainId: number): PublicClient | undefined {
    const existing = this.clients.get(chainId)
    if (existing) return existing
    const endpoint = this.url(chainId)
    if (!endpoint) return undefined
    const chain =
      KNOWN_CHAINS[chainId] ??
      defineChain({
        id: chainId,
        name: `Chain ${chainId}`,
        nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 },
        rpcUrls: { default: { http: [endpoint.url] } },
      })
    const client = createPublicClient({
      chain,
      transport: http(endpoint.url, {
        timeout: this.config.timeoutMs,
        retryCount: 1,
      }),
    })
    this.clients.set(chainId, client)
    return client
  }

  describe(chainId: number): RpcDescription {
    const endpoint = this.url(chainId)
    const name = KNOWN_CHAINS[chainId]?.name
    if (!endpoint)
      return { chainId, ...(name ? { chain: name } : {}), rpc: "none" }
    let host: string | undefined
    try {
      host = new URL(endpoint.url).host
    } catch {
      host = undefined
    }
    return {
      chainId,
      ...(name ? { chain: name } : {}),
      rpc: endpoint.kind,
      ...(host ? { host } : {}),
    }
  }

  chainInfo(chainId: number): ChainInfoResult | null {
    const chain = KNOWN_CHAINS[chainId]
    if (!chain) return null
    return { name: chain.name, nativeCurrency: { ...chain.nativeCurrency } }
  }

  /** Raw `eth_call` access, the shape the library's attestation check needs. */
  chainClient(): ChainClient | undefined {
    if (!this.client(mainnet.id)) return undefined
    return {
      call: async (chainId, request) => {
        const client = this.client(chainId)
        if (!client)
          throw new Error(`No RPC is configured for chain ${chainId}`)
        try {
          const result = await client.call({
            to: getAddress(request.to),
            data: request.data as Hex,
          })
          return result.data ?? "0x"
        } catch (error) {
          // The original error stays behind: its text and request carry the RPC URL, which can hold an API key.
          // eslint-disable-next-line preserve-caught-error
          throw new Error(
            this.redact(error instanceof Error ? error.message : String(error))
          )
        }
      },
    }
  }

  /**
   * Token metadata read from the token contract itself. It is what the token
   * says about itself, so results show the token's address beside its symbol.
   */
  token(chainId: number, address: string): Promise<TokenResult | null> {
    const client = this.client(chainId)
    if (!client) return Promise.resolve(null)
    const token = getAddress(address)
    return this.tokens
      .get(`${chainId}:${token}`, async () => {
        const [decimals, symbol, name] = await Promise.all([
          client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "decimals",
          }),
          client.readContract({
            address: token,
            abi: erc20Abi,
            functionName: "symbol",
          }),
          client
            .readContract({
              address: token,
              abi: erc20Abi,
              functionName: "name",
            })
            .catch(() => ""),
        ])
        if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77)
          return null
        return {
          decimals,
          symbol: cleanText(symbol, 32).text,
          name: cleanText(name, 64).text,
        }
      })
      .catch(() => null)
  }

  nftCollectionName(chainId: number, address: string): Promise<string | null> {
    const client = this.client(chainId)
    if (!client) return Promise.resolve(null)
    const collection = getAddress(address)
    return this.collections
      .get(`${chainId}:${collection}`, async () => {
        const name = await client.readContract({
          address: collection,
          abi: parseAbi(["function name() view returns (string)"]),
          functionName: "name",
        })
        return cleanText(name, 64).text
      })
      .catch(() => null)
  }

  async blockTimestamp(
    chainId: number,
    blockHeight: bigint
  ): Promise<number | null> {
    const client = this.client(chainId)
    if (!client) return null
    try {
      const block = await client.getBlock({ blockNumber: blockHeight })
      return Number(block.timestamp)
    } catch {
      return null
    }
  }

  /**
   * The data source the library asks for token, chain and NFT details. Names
   * from ENS or an address book are left out: an agent has no address book,
   * and the library then shows the address itself.
   */
  externalDataProvider(): ExternalDataProvider {
    const chainClient = this.chainClient()
    return {
      ...(chainClient ? { chainClient } : {}),
      resolveToken: (chainId, tokenAddress) =>
        this.token(chainId, tokenAddress),
      resolveChainInfo: (chainId) => Promise.resolve(this.chainInfo(chainId)),
      resolveNftCollectionName: async (chainId, collectionAddress) => {
        const name = await this.nftCollectionName(chainId, collectionAddress)
        return name ? { name } : null
      },
      resolveBlockTimestamp: async (chainId, blockHeight) => {
        const timestamp = await this.blockTimestamp(chainId, blockHeight)
        return timestamp === null ? null : { timestamp }
      },
    }
  }

  /** `text` with every configured RPC URL replaced, since a URL can carry an API key. */
  redact(text: string): string {
    let out = text
    for (const [chainId, url] of Object.entries(this.config.urls)) {
      for (const variant of new Set([url, url.replace(/\/+$/, "")])) {
        if (variant) out = out.split(variant).join(`<RPC_URL_${chainId}>`)
      }
    }
    return out
  }

  nativeSymbol(chainId: number): string {
    return KNOWN_CHAINS[chainId]?.nativeCurrency.symbol ?? "native token"
  }

  nativeDecimals(chainId: number): number {
    return KNOWN_CHAINS[chainId]?.nativeCurrency.decimals ?? 18
  }
}

export type { Address }
