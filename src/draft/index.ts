import type { Transaction } from "@ethereum-sourcify/clear-signing"
import { getAddress, parseTransaction, type Hex } from "viem"
import {
  isTokenContract,
  isVault,
  pickFunctions,
  type DescribedFunction,
} from "./abi.js"
import { draftFormat } from "./heuristics.js"
import { unsignedRawTx } from "./rawtx.js"
import {
  inspect,
  toRendered,
  tokenProvider,
  withDraftResolver,
  type ProviderToken,
  type Render,
} from "./render.js"
import type {
  DescriptorFormat,
  DraftChain,
  DraftDescriptor,
  DraftInput,
  DraftResult,
  DraftSample,
  DraftTestCase,
  DraftTests,
} from "./types.js"

export type * from "./types.js"

/**
 * Drafts an ERC-7730 v2 calldata descriptor from a contract's ABI, and tests
 * it against real transactions.
 *
 * Every function gets one display format, built from the names and types of
 * its parameters alone: amounts paired with the tokens they are counted in,
 * recipients and spenders named, deadlines as dates, a payable function's
 * value as a native amount. Each function with a sample transaction gets one
 * test case, its expected output rendered by `@ethereum-sourcify/clear-signing`
 * the way the registry's test runner renders it. Deterministic: no network,
 * no model; the same input gives the same draft.
 *
 * A draft is a starting point. `review` lists what a person must check:
 * every hidden parameter, every amount shown raw, every render that looks
 * wrong.
 */
export async function draftDescriptor(input: DraftInput): Promise<DraftResult> {
  const review: string[] = []
  const contractName = input.contractName?.trim() || "Contract"
  const fileName = `calldata-${contractName.replace(/[^A-Za-z0-9_-]+/g, "_")}.json`
  const deployments = deploymentsOf(input)

  const functions = pickFunctions(input.abi, input.selectors, review)
  if (functions.length === 0)
    throw new Error(
      "There is no function to describe: the ABI has none that changes state."
    )
  const nativeSymbols = new Set(
    deployments.map(
      (d) => input.chains?.[String(d.chainId)]?.nativeCurrency.symbol
    )
  )
  const [nativeSymbol] = nativeSymbols
  const traits = {
    token: isTokenContract(input.abi),
    vault: isVault(input.abi),
    ...(nativeSymbols.size === 1 && nativeSymbol ? { nativeSymbol } : {}),
  }
  const formats = new Map<string, DescriptorFormat>()
  for (const described of functions)
    formats.set(described.key, draftFormat(described, traits, review))

  if (input.legalName)
    review.push(
      `The legal name ${JSON.stringify(input.legalName)} is left out: ERC-7730 v2 has no field for it (metadata.info takes url and deploymentDate only).`
    )
  if (!input.url)
    review.push(
      "metadata.info is left out: it needs the owner's url, and none was given."
    )

  const descriptor = (): DraftDescriptor => ({
    $schema: "../../specs/erc7730-v2.schema.json",
    context: { contract: { deployments } },
    metadata: {
      owner: input.owner,
      contractName: contractName.replace(/_+/g, " ").trim(),
      ...(input.url ? { info: { url: input.url } } : {}),
    },
    display: { formats: Object.fromEntries(formats) },
  })

  const context: TestContext = {
    input,
    tokens: providerTokens(input, review),
    chains: input.chains ?? {},
    review,
  }
  const carriesCalls = [...formats.values()].some((f) =>
    f.fields.some((field) => field.format === "calldata")
  )
  if (carriesCalls && !input.registry)
    review.push(
      "The tests index this draft alone, since no registry was given: a call that a calldata field carries is expected as raw bytes, which the registry's test runner fails when the registry describes the contract it calls."
    )

  const cases = await withDraftResolver(
    fileName,
    deployments,
    input.registry,
    async (render) => {
      const chosen = await chooseSamples(
        context,
        functions,
        formats,
        descriptor,
        render
      )
      return renderTests(context, chosen, descriptor(), render)
    }
  )
  if (cases.tests.length === 0)
    review.push(
      "No function has a sample transaction that could be rebuilt, so the tests file has no case; the registry requires at least one."
    )
  const tests: DraftTests = {
    $schema: "../../../specs/erc7730-tests-v2.schema.json",
    descriptor: `../${fileName}`,
    ...(Object.keys(cases.tokens).length > 0
      ? { dataProvider: { tokens: cases.tokens } }
      : {}),
    tests: cases.tests,
  }
  return { fileName, descriptor: descriptor(), tests, review }
}

interface TestContext {
  readonly input: DraftInput
  readonly tokens: ReadonlyMap<string, ProviderToken>
  readonly chains: Readonly<Record<string, DraftChain>>
  readonly review: string[]
}

function deploymentsOf(
  input: DraftInput
): { chainId: number; address: string }[] {
  const out: { chainId: number; address: string }[] = []
  const seen = new Set<string>()
  const all = [
    { chainId: input.chainId, address: input.address },
    ...(input.extraDeployments ?? []),
  ]
  for (const d of all) {
    const address = getAddress(d.address)
    const key = `${d.chainId}:${address.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ chainId: d.chainId, address })
  }
  return out
}

/** The tokens of `input.chainId` a test may name: lowercase addresses, a name for each. */
function providerTokens(
  input: DraftInput,
  review: string[]
): Map<string, ProviderToken> {
  const out = new Map<string, ProviderToken>()
  const given = Object.entries(input.tokens ?? {})
  for (const [address, token] of given) {
    if (
      !token.symbol ||
      !Number.isInteger(token.decimals) ||
      token.decimals < 0
    )
      continue
    out.set(address.toLowerCase(), {
      name: token.name || token.symbol,
      symbol: token.symbol,
      decimals: token.decimals,
    })
  }
  if (out.size < given.length)
    review.push(
      `${given.length - out.size} token(s) of the token list have no symbol or decimals; the tests leave them out.`
    )
  return out
}

interface Chosen {
  readonly described: DescribedFunction
  readonly sample: DraftSample
  readonly rawTx: Hex
  readonly tx: Transaction
}

/** The transaction the runner reads back from a rawTx, decoded as it decodes it. */
function decodeRawTx(rawTx: Hex): Transaction {
  const tx = parseTransaction(rawTx)
  if (!tx.to || tx.chainId === undefined)
    throw new Error(
      `The rebuilt transaction ${rawTx} has no recipient or no chain id.`
    )
  return {
    chainId: Number(tx.chainId),
    to: tx.to,
    data: tx.data ?? "0x",
    value: tx.value ?? 0n,
  }
}

/**
 * One sample per function: the first that renders cleanly, else the one with
 * the fewest problems, a successful transaction before a reverted one.
 */
async function chooseSamples(
  context: TestContext,
  functions: readonly DescribedFunction[],
  formats: Map<string, DescriptorFormat>,
  descriptor: () => DraftDescriptor,
  render: Render
): Promise<Chosen[]> {
  const { input, review } = context
  const deployed = new Set(
    deploymentsOf(input).map((d) => `${d.chainId}:${d.address.toLowerCase()}`)
  )
  const samples = (input.samples ?? []).filter((s) =>
    deployed.has(`${s.chainId}:${s.to.toLowerCase()}`)
  )
  // This pass answers only for tokens of the contract's own chain.
  const provider = tokenProvider(
    Object.fromEntries(context.tokens),
    context.chains,
    {
      chainId: input.chainId,
    }
  )
  const chosen: Chosen[] = []
  for (const described of functions) {
    const candidates = samples
      .filter((s) => s.input.slice(0, 10).toLowerCase() === described.selector)
      .sort(
        (a, b) =>
          Number(a.status === "reverted") - Number(b.status === "reverted")
      )
    if (candidates.length === 0) {
      review.push(
        `${described.title}: no sample transaction calls it, so it has no test.`
      )
      continue
    }
    let best: (Chosen & { readonly score: number }) | undefined
    for (const sample of candidates.slice(0, 8)) {
      const rebuilt = unsignedRawTx(sample)
      if ("skip" in rebuilt) {
        review.push(
          `${described.title}: sample ${sample.hash} is ${rebuilt.skip}.`
        )
        continue
      }
      const tx = decodeRawTx(rebuilt.rawTx)
      const { failures, problems } = inspect(
        await render(descriptor(), tx, provider)
      )
      const score = failures.length * 100 + problems.length
      if (!best || score < best.score)
        best = { described, sample, rawTx: rebuilt.rawTx, tx, score }
      if (score === 0) break
    }
    if (!best) {
      review.push(
        `${described.title}: no sample could be rebuilt, so it has no test.`
      )
      continue
    }
    chosen.push(best)
  }
  // A format whose sentence cannot be filled in loses the sentence, not its test.
  for (const c of chosen) {
    const format = formats.get(c.described.key)
    if (!format?.interpolatedIntent) continue
    const model = await render(descriptor(), c.tx, provider)
    if (model.warnings?.some((w) => w.code === "INTERPOLATION_ERROR")) {
      const { interpolatedIntent, ...rest } = format
      formats.set(c.described.key, rest)
      review.push(
        `${c.described.title}: its interpolatedIntent ${JSON.stringify(interpolatedIntent)} could not be filled in for ${c.sample.hash}; the draft leaves it out.`
      )
    }
  }
  return chosen
}

/**
 * The test cases, rendered as the runner renders them: its data provider
 * holds only the tokens the samples name, and looks them up by address.
 */
async function renderTests(
  context: TestContext,
  chosen: readonly Chosen[],
  descriptor: DraftDescriptor,
  render: Render
): Promise<{ tokens: Record<string, ProviderToken>; tests: DraftTestCase[] }> {
  const { input, review } = context
  const named = new Set<string>()
  const ownChain = tokenProvider(
    Object.fromEntries(context.tokens),
    context.chains,
    {
      chainId: input.chainId,
      onLookup: (_chainId, address) => named.add(address),
    }
  )
  for (const c of chosen) await render(descriptor, c.tx, ownChain)
  const tokens: Record<string, ProviderToken> = {}
  for (const address of [...named].sort()) {
    const token = context.tokens.get(address)
    if (token) tokens[address] = token
  }

  const tests: DraftTestCase[] = []
  for (const c of chosen) {
    const foreign = new Set<string>()
    const model = await render(
      descriptor,
      c.tx,
      tokenProvider(tokens, context.chains, {
        onLookup: (chainId, address) => {
          if (chainId !== input.chainId)
            foreign.add(`${address} on chain ${chainId}`)
        },
      })
    )
    const where = `${c.described.title}, tx ${c.sample.hash}`
    for (const token of foreign)
      review.push(
        `${where}: the runner looks tokens up by address alone, so ${token} renders as the token at that address on chain ${input.chainId}.`
      )
    const { failures, problems } = inspect(model)
    for (const problem of problems) review.push(`${where}: ${problem}.`)
    for (const failure of failures)
      review.push(
        `${where}: the registry's test runner fails this case (${failure}).`
      )
    tests.push({
      description: `${c.described.fn.name} ${c.described.selector} ${c.sample.hash.slice(0, 10)}`,
      rawTx: c.rawTx,
      txHash: c.sample.hash,
      expected: toRendered(model),
    })
  }
  return { tokens, tests }
}
