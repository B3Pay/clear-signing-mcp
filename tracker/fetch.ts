import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  fallback,
  getAddress,
  http,
  isAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem"
import { arbitrum, base, mainnet, optimism } from "viem/chains"
import {
  dataPaths,
  readJson,
  writeJson,
  type AbiFile,
  type BlockscoutFacts,
  type OnchainRecord,
  type SampleSummary,
  type SampleTx,
  type SamplesFile,
  type SourcifyFacts,
  type TokenInfo,
  type TokensFile,
} from "./data.js"
import { errorText, getJson, isRecord, Limiter } from "./net.js"
import {
  TRACKED_CHAINS,
  type TrackedChainId,
  type UniverseContract,
  type UniverseProtocol,
} from "./universe.js"

/**
 * The tracker's only networked step. For each contract it reads, all
 * read-only and from public services:
 *
 * - its bytecode size (RPC), so a wrong address shows up as "no code";
 * - its Sourcify verification, name, proxy implementations and ABI;
 * - Blockscout's view of the same, and its ABI when Sourcify has none;
 * - the latest transactions sent to it (Blockscout), counted per selector;
 * - for up to two recent successful transactions per selector, the full
 *   transaction (RPC), to build test vectors from real calldata;
 * - symbol and decimals of every address in those calls that answers like
 *   an ERC-20 token (RPC, multicall).
 *
 * Nothing is signed or sent.
 */

const CHAINS = {
  1: mainnet,
  8453: base,
  42161: arbitrum,
  10: optimism,
} as const

export const BLOCKSCOUT: Readonly<Record<TrackedChainId, string>> = {
  1: "https://eth.blockscout.com",
  8453: "https://base.blockscout.com",
  42161: "https://arbitrum.blockscout.com",
  10: "https://optimism.blockscout.com",
}

const PUBLIC_RPC: Readonly<Record<TrackedChainId, readonly string[]>> = {
  1: ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: [
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
  ],
  10: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io"],
}

export const SOURCIFY = "https://sourcify.dev/server"

export interface FetchOptions {
  readonly dataDir: string
  /** Re-read contracts fetched less than this long ago; default: skip them. */
  readonly maxAgeMs: number
  /** Transactions to ask Blockscout for, per contract. */
  readonly sampleSize: number
  /** Full transactions to keep per selector. */
  readonly perSelector: number
  readonly selectorsKept: number
  readonly only?: (
    protocol: UniverseProtocol,
    contract: UniverseContract
  ) => boolean
  readonly log?: (line: string) => void
}

const limits = {
  sourcify: new Limiter(4),
  blockscout: Object.fromEntries(
    Object.keys(TRACKED_CHAINS).map((id) => [id, new Limiter(3)])
  ) as Record<string, Limiter>,
  defillama: new Limiter(1),
}

function rpcClient(chainId: TrackedChainId): PublicClient {
  const configured = process.env[`RPC_URL_${chainId}`]
  const urls = configured ? [configured] : [...PUBLIC_RPC[chainId]]
  return createPublicClient({
    chain: CHAINS[chainId],
    transport: fallback(
      urls.map((url) =>
        http(url, {
          batch: { batchSize: 20, wait: 20 },
          retryCount: 3,
          retryDelay: 1_000,
          timeout: 30_000,
        })
      )
    ),
  }) as PublicClient
}

export async function fetchAll(
  universe: readonly UniverseProtocol[],
  options: FetchOptions
): Promise<{ fetched: number; skipped: number; problems: string[] }> {
  const log = options.log ?? (() => undefined)
  const paths = dataPaths(options.dataDir)
  const clients = new Map<TrackedChainId, PublicClient>()
  const client = (chainId: TrackedChainId) => {
    let found = clients.get(chainId)
    if (!found) {
      found = rpcClient(chainId)
      clients.set(chainId, found)
    }
    return found
  }
  const tokenCandidates = new Map<TrackedChainId, Set<Address>>()
  const problems: string[] = []
  let fetched = 0
  let skipped = 0

  const jobs: { protocol: UniverseProtocol; contract: UniverseContract }[] = []
  for (const protocol of universe)
    for (const contract of protocol.contracts) {
      if (options.only && !options.only(protocol, contract)) continue
      const existing = readJson<OnchainRecord>(
        paths.onchain(contract.chainId, contract.address)
      )
      if (
        existing &&
        Date.now() - Date.parse(existing.fetchedAt) < options.maxAgeMs
      ) {
        skipped += 1
        continue
      }
      jobs.push({ protocol, contract })
    }
  log(`fetching ${jobs.length} contracts (${skipped} fresh enough to skip)`)

  const contractLimiter = new Limiter(6)
  await Promise.all(
    jobs.map(({ protocol, contract }) =>
      contractLimiter.run(async () => {
        try {
          const record = await fetchContract(
            contract,
            client(contract.chainId),
            options
          )
          fetched += 1
          const candidates =
            tokenCandidates.get(contract.chainId) ?? new Set<Address>()
          for (const address of record.tokenCandidates) candidates.add(address)
          tokenCandidates.set(contract.chainId, candidates)
          const sample = record.onchain.sample
          log(
            `${protocol.protocol} ${TRACKED_CHAINS[contract.chainId]} ${contract.name} ${contract.address}: code ${record.onchain.codeBytes ?? "?"} B, sourcify ${record.onchain.sourcify.status}, abi ${record.onchain.abi?.source ?? "none"}, ` +
              ("error" in sample
                ? `sample error: ${sample.error}`
                : `${sample.count} txs, ${sample.perDay === null ? "?" : sample.perDay.toFixed(1)}/day, ${Object.keys(sample.selectors).length} selectors, ${record.samples.txs.length} kept`)
          )
        } catch (error) {
          problems.push(
            `${protocol.protocol} ${contract.chainId}:${contract.address}: ${errorText(error)}`
          )
          log(
            `FAILED ${protocol.protocol} ${contract.chainId}:${contract.address}: ${errorText(error)}`
          )
        }
      })
    )
  )

  for (const [chainId, candidates] of tokenCandidates) {
    try {
      await fetchTokens([...candidates], client(chainId), paths.tokens(chainId))
    } catch (error) {
      problems.push(`tokens on ${chainId}: ${errorText(error)}`)
    }
  }
  return { fetched, skipped, problems }
}

async function fetchContract(
  contract: UniverseContract,
  client: PublicClient,
  options: FetchOptions
): Promise<{
  onchain: OnchainRecord
  samples: SamplesFile
  tokenCandidates: Address[]
}> {
  const paths = dataPaths(options.dataDir)
  const { chainId, address } = contract

  let codeBytes: number | null = null
  let codeError: string | undefined
  try {
    const code = await client.getCode({ address })
    codeBytes = code ? (code.length - 2) / 2 : 0
  } catch (error) {
    codeError = errorText(error)
  }

  const [sourcify, blockscout] = await Promise.all([
    sourcifyFacts(chainId, address),
    blockscoutFacts(chainId, address),
  ])

  // The ABI users call through: the implementation's, behind a proxy.
  const abiFile = await resolveAbi(
    chainId,
    address,
    sourcify.facts,
    sourcify.abi,
    blockscout
  )
  if (abiFile) writeJson(paths.abi(chainId, address), abiFile)

  let sample: SampleSummary | { error: string }
  let kept: SampleTx[] = []
  const tokenCandidates = new Set<Address>()
  try {
    const listed = await latestTransactions(
      chainId,
      address,
      options.sampleSize
    )
    sample = listed.summary
    const picked = pickPerSelector(
      listed.txs,
      options.perSelector,
      options.selectorsKept
    )
    kept = await fullTransactions(client, chainId, picked)
    if (abiFile) {
      for (const tx of kept)
        for (const found of addressesInCall(abiFile.abi, tx.input))
          tokenCandidates.add(found)
    }
    tokenCandidates.add(address)
  } catch (error) {
    sample = { error: errorText(error) }
  }

  const onchain: OnchainRecord = {
    chainId,
    address,
    fetchedAt: new Date().toISOString(),
    codeBytes,
    ...(codeError ? { codeError } : {}),
    sourcify: sourcify.facts,
    blockscout: blockscout.facts,
    abi: abiFile
      ? {
          source: abiFile.source,
          address: abiFile.address,
          ...(abiFile.name ? { name: abiFile.name } : {}),
          functions: abiFile.abi.filter((item) => item.type === "function")
            .length,
        }
      : null,
    sample,
  }
  const samples: SamplesFile = { chainId, address, txs: kept }
  writeJson(paths.samples(chainId, address), samples)
  writeJson(paths.onchain(chainId, address), onchain)
  return { onchain, samples, tokenCandidates: [...tokenCandidates] }
}

async function sourcifyFacts(
  chainId: number,
  address: Address
): Promise<{ facts: SourcifyFacts; abi?: Abi }> {
  try {
    const body = await getJson(
      `${SOURCIFY}/v2/contract/${chainId}/${address}?fields=abi,compilation,proxyResolution`,
      limits.sourcify,
      { allowNotFound: true }
    )
    if (body === null || !isRecord(body))
      return { facts: { status: "not_verified" } }
    const match = body.match
    if (match !== "exact_match" && match !== "match")
      return { facts: { status: "not_verified" } }
    const compilation = isRecord(body.compilation) ? body.compilation : {}
    const resolution = isRecord(body.proxyResolution)
      ? body.proxyResolution
      : {}
    const implementations = Array.isArray(resolution.implementations)
      ? resolution.implementations.flatMap((item) =>
          isRecord(item) &&
          typeof item.address === "string" &&
          isAddress(item.address, { strict: false })
            ? [
                {
                  address: getAddress(item.address),
                  ...(typeof item.name === "string" ? { name: item.name } : {}),
                },
              ]
            : []
        )
      : []
    const facts: SourcifyFacts = {
      status: "verified",
      match,
      ...(typeof compilation.name === "string"
        ? { name: compilation.name }
        : {}),
      ...(resolution.isProxy === true
        ? {
            proxy: {
              type:
                typeof resolution.proxyType === "string"
                  ? resolution.proxyType
                  : null,
              implementations,
            },
          }
        : {}),
    }
    return {
      facts,
      ...(Array.isArray(body.abi) ? { abi: body.abi as Abi } : {}),
    }
  } catch (error) {
    return { facts: { status: "error", reason: errorText(error) } }
  }
}

async function blockscoutFacts(
  chainId: TrackedChainId,
  address: Address
): Promise<{ facts: BlockscoutFacts }> {
  try {
    const body = await getJson(
      `${BLOCKSCOUT[chainId]}/api/v2/addresses/${address}`,
      limits.blockscout[String(chainId)]!,
      { allowNotFound: true }
    )
    if (!isRecord(body))
      return { facts: { status: "error", reason: "address not found" } }
    const implementations = Array.isArray(body.implementations)
      ? body.implementations.flatMap((item) => {
          if (!isRecord(item)) return []
          const raw =
            typeof item.address === "string" ? item.address : item.address_hash
          return typeof raw === "string" && isAddress(raw, { strict: false })
            ? [
                {
                  address: getAddress(raw),
                  ...(typeof item.name === "string" ? { name: item.name } : {}),
                },
              ]
            : []
        })
      : []
    return {
      facts: {
        status: "ok",
        isContract: body.is_contract === true,
        verified: body.is_verified === true,
        ...(typeof body.name === "string" ? { name: body.name } : {}),
        implementations,
      },
    }
  } catch (error) {
    return { facts: { status: "error", reason: errorText(error) } }
  }
}

async function blockscoutAbi(
  chainId: TrackedChainId,
  address: Address
): Promise<{ abi: Abi; name?: string } | undefined> {
  const body = await getJson(
    `${BLOCKSCOUT[chainId]}/api/v2/smart-contracts/${address}`,
    limits.blockscout[String(chainId)]!,
    { allowNotFound: true }
  )
  if (!isRecord(body) || !Array.isArray(body.abi)) return undefined
  return {
    abi: body.abi as Abi,
    ...(typeof body.name === "string" ? { name: body.name } : {}),
  }
}

async function resolveAbi(
  chainId: TrackedChainId,
  address: Address,
  sourcify: SourcifyFacts,
  sourcifyAbi: Abi | undefined,
  blockscout: { facts: BlockscoutFacts }
): Promise<AbiFile | undefined> {
  // Behind a proxy, users call the implementation's functions.
  const sourcifyImpl =
    sourcify.status === "verified"
      ? sourcify.proxy?.implementations[0]
      : undefined
  const blockscoutImpl =
    blockscout.facts.status === "ok"
      ? blockscout.facts.implementations[0]
      : undefined
  const implementation = sourcifyImpl ?? blockscoutImpl
  const target = implementation?.address ?? address

  if (target !== address) {
    const impl = await sourcifyFacts(chainId, target)
    if (impl.abi && impl.facts.status === "verified")
      return {
        source: "sourcify",
        address: target,
        ...(impl.facts.name ? { name: impl.facts.name } : {}),
        abi: impl.abi,
      }
    try {
      const fromBlockscout = await blockscoutAbi(chainId, target)
      if (fromBlockscout)
        return {
          source: "blockscout",
          address: target,
          ...(fromBlockscout.name ? { name: fromBlockscout.name } : {}),
          abi: fromBlockscout.abi,
        }
    } catch {
      // fall through to the contract's own ABI
    }
  }
  if (sourcifyAbi && sourcify.status === "verified")
    return {
      source: "sourcify",
      address,
      ...(sourcify.name ? { name: sourcify.name } : {}),
      abi: sourcifyAbi,
    }
  try {
    const fromBlockscout = await blockscoutAbi(chainId, address)
    if (fromBlockscout)
      return {
        source: "blockscout",
        address,
        ...(fromBlockscout.name ? { name: fromBlockscout.name } : {}),
        abi: fromBlockscout.abi,
      }
  } catch {
    // no ABI
  }
  return undefined
}

interface ListedTx {
  readonly hash: Hex
  readonly timestamp: number
  readonly input: Hex
  readonly failed: boolean
}

function selectorOf(input: string): string {
  return input.length >= 10 ? input.slice(0, 10).toLowerCase() : "0x"
}

/**
 * The latest transactions sent to `address`, newest first, from Blockscout's
 * Etherscan-style `txlist` with `filter_by=to`. Only top-level transactions
 * count: a call made from inside another contract is not a signature
 * request.
 */
async function latestTransactions(
  chainId: TrackedChainId,
  address: Address,
  size: number
): Promise<{ summary: SampleSummary; txs: ListedTx[] }> {
  const url =
    `${BLOCKSCOUT[chainId]}/api?module=account&action=txlist&address=${address}` +
    `&filter_by=to&sort=desc&page=1&offset=${size}`
  const body = await getJson(url, limits.blockscout[String(chainId)]!, {
    timeoutMs: 90_000,
    maxBytes: 64 * 1024 * 1024,
  })
  if (!isRecord(body) || !Array.isArray(body.result)) {
    throw new Error(
      `txlist answered ${isRecord(body) ? String(body.message) : "a non-object"}`
    )
  }
  const txs: ListedTx[] = []
  for (const item of body.result) {
    if (!isRecord(item)) continue
    if (
      typeof item.to !== "string" ||
      item.to.toLowerCase() !== address.toLowerCase()
    )
      continue
    if (typeof item.hash !== "string" || typeof item.input !== "string")
      continue
    txs.push({
      hash: item.hash as Hex,
      timestamp: Number(item.timeStamp),
      input: item.input as Hex,
      failed: item.isError === "1" || item.txreceipt_status === "0",
    })
  }
  const selectors: Record<string, number> = {}
  for (const tx of txs) {
    const selector = selectorOf(tx.input)
    selectors[selector] = (selectors[selector] ?? 0) + 1
  }
  const times = txs.map((tx) => tx.timestamp).filter(Number.isFinite)
  const oldest = times.length ? Math.min(...times) : null
  const newest = times.length ? Math.max(...times) : null
  const spanDays =
    oldest !== null && newest !== null ? (newest - oldest) / 86_400 : 0
  return {
    summary: {
      source: "blockscout-txlist",
      requested: size,
      count: txs.length,
      failed: txs.filter((tx) => tx.failed).length,
      oldest,
      newest,
      perDay: txs.length >= 2 && spanDays > 0 ? txs.length / spanDays : null,
      selectors,
    },
    txs,
  }
}

function pickPerSelector(
  txs: readonly ListedTx[],
  perSelector: number,
  selectorsKept: number
): ListedTx[] {
  const bySelector = new Map<string, ListedTx[]>()
  for (const tx of txs) {
    if (tx.failed) continue
    const selector = selectorOf(tx.input)
    const list = bySelector.get(selector) ?? []
    if (list.length < perSelector) list.push(tx)
    bySelector.set(selector, list)
  }
  const counts = new Map<string, number>()
  for (const tx of txs)
    counts.set(
      selectorOf(tx.input),
      (counts.get(selectorOf(tx.input)) ?? 0) + 1
    )
  return [...bySelector.entries()]
    .sort(([a], [b]) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    .slice(0, selectorsKept)
    .flatMap(([, list]) => list)
}

async function fullTransactions(
  client: PublicClient,
  chainId: number,
  picked: readonly ListedTx[]
): Promise<SampleTx[]> {
  const out: SampleTx[] = []
  const results = await Promise.allSettled(
    picked.map((tx) => client.getTransaction({ hash: tx.hash }))
  )
  results.forEach((result, i) => {
    const listed = picked[i]!
    if (result.status !== "fulfilled") return
    const tx = result.value
    if (!tx.to) return
    out.push({
      hash: tx.hash,
      chainId,
      blockNumber: Number(tx.blockNumber),
      timestamp: listed.timestamp,
      from: getAddress(tx.from),
      to: getAddress(tx.to),
      value: tx.value.toString(),
      input: tx.input,
      nonce: tx.nonce,
      gas: tx.gas.toString(),
      type: tx.type,
      ...(tx.gasPrice !== undefined
        ? { gasPrice: tx.gasPrice.toString() }
        : {}),
      ...(tx.maxFeePerGas !== undefined
        ? { maxFeePerGas: tx.maxFeePerGas.toString() }
        : {}),
      ...(tx.maxPriorityFeePerGas !== undefined
        ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas.toString() }
        : {}),
      ...(tx.accessList && tx.accessList.length > 0
        ? {
            accessList: tx.accessList.map((entry) => ({
              address: getAddress(entry.address),
              storageKeys: entry.storageKeys,
            })),
          }
        : {}),
      status: "success",
    })
  })
  return out
}

/** Every address argument in a call, nested ones included. */
export function addressesInCall(abi: Abi, input: Hex): Address[] {
  let decoded: { functionName: string; args?: readonly unknown[] }
  try {
    decoded = decodeFunctionData({ abi, data: input })
  } catch {
    return []
  }
  const found = new Set<Address>()
  const walk = (value: unknown) => {
    if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) {
      found.add(getAddress(value))
    } else if (Array.isArray(value)) {
      value.forEach(walk)
    } else if (isRecord(value)) {
      Object.values(value).forEach(walk)
    }
  }
  walk(decoded.args ?? [])
  return [...found]
}

async function fetchTokens(
  candidates: readonly Address[],
  client: PublicClient,
  path: string
): Promise<void> {
  const known: Record<string, TokenInfo> = {
    ...(readJson<TokensFile>(path) ?? {}),
  }
  const missing = candidates.filter((address) => !known[address.toLowerCase()])
  const batch = 150
  for (let i = 0; i < missing.length; i += batch) {
    const slice = missing.slice(i, i + batch)
    const calls = slice.flatMap((address) => [
      { address, abi: erc20Abi, functionName: "symbol" as const },
      { address, abi: erc20Abi, functionName: "decimals" as const },
      { address, abi: erc20Abi, functionName: "name" as const },
    ])
    const results = await client.multicall({
      contracts: calls,
      allowFailure: true,
    })
    slice.forEach((address, j) => {
      const symbol = results[j * 3]
      const decimals = results[j * 3 + 1]
      const name = results[j * 3 + 2]
      if (
        symbol?.status === "success" &&
        typeof symbol.result === "string" &&
        decimals?.status === "success" &&
        typeof decimals.result === "number"
      ) {
        known[address.toLowerCase()] = {
          symbol: symbol.result,
          decimals: decimals.result,
          ...(name?.status === "success" && typeof name.result === "string"
            ? { name: name.result }
            : {}),
        }
      }
    })
  }
  writeJson(path, known)
}

/** The protocols DefiLlama tracks on the four chains, with their TVL there. */
export async function fetchDefiLlama(path: string): Promise<number> {
  const body = await getJson(
    "https://api.llama.fi/protocols",
    limits.defillama,
    {
      timeoutMs: 120_000,
      maxBytes: 256 * 1024 * 1024,
    }
  )
  if (!Array.isArray(body)) throw new Error("DefiLlama protocols is not a list")
  const keys: Record<string, string> = {
    Ethereum: "1",
    Base: "8453",
    Arbitrum: "42161",
    "OP Mainnet": "10",
    Optimism: "10",
  }
  const out: Record<string, unknown>[] = []
  for (const item of body) {
    if (!isRecord(item) || typeof item.slug !== "string") continue
    const chainTvls = isRecord(item.chainTvls) ? item.chainTvls : {}
    const tvl: Record<string, number> = {}
    for (const [chain, value] of Object.entries(chainTvls)) {
      const id = keys[chain]
      if (id && typeof value === "number" && value > 0)
        tvl[id] = (tvl[id] ?? 0) + value
    }
    if (Object.keys(tvl).length === 0) continue
    out.push({
      slug: item.slug,
      name: typeof item.name === "string" ? item.name : item.slug,
      category: typeof item.category === "string" ? item.category : null,
      parent:
        typeof item.parentProtocol === "string" ? item.parentProtocol : null,
      url: typeof item.url === "string" ? item.url : null,
      tvl,
    })
  }
  out.sort((a, b) => sum(b.tvl) - sum(a.tvl))
  writeJson(path, { fetchedAt: new Date().toISOString(), protocols: out })
  return out.length
}

function sum(value: unknown): number {
  return isRecord(value)
    ? Object.values(value).reduce<number>(
        (acc, v) => acc + (typeof v === "number" ? v : 0),
        0
      )
    : 0
}
