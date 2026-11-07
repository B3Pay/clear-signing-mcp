import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  format,
  isFieldGroup,
  type DescriptorResolver,
  type DisplayField,
  type DisplayFieldGroup,
  type DisplayModel,
  type ExternalDataProvider,
  type RegistryIndex,
  type Transaction,
} from "@ethereum-sourcify/clear-signing"
import { createFilesystemResolver } from "@ethereum-sourcify/clear-signing/filesystem"
import type {
  DraftChain,
  DraftDescriptor,
  DraftRegistry,
  RenderedDisplay,
  RenderedField,
} from "./types.js"

/**
 * Rendering a draft the way the registry's test runner does: the library's
 * `format()` over a filesystem resolver, a data provider that answers from
 * the tests file's tokens, and the runner's mapping of the display model
 * onto `{intent, interpolatedIntent, owner, fields}`.
 */

export type Render = (
  descriptor: DraftDescriptor,
  tx: Transaction,
  provider: ExternalDataProvider
) => Promise<DisplayModel>

/**
 * Runs `work` with a resolver over a temporary directory that holds the
 * draft, then removes it. The draft answers for its own deployments; with a
 * registry, every other deployment is read from it, as the test runner reads
 * the descriptor of a contract that a `calldata` field calls.
 */
export async function withDraftResolver<T>(
  fileName: string,
  deployments: readonly {
    readonly chainId: number
    readonly address: string
  }[],
  registry: DraftRegistry | undefined,
  work: (render: Render) => Promise<T>
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "erc7730-draft-"))
  try {
    // Outside registry/ and ercs/, where a registry's index points.
    const relative = `draft/${fileName}`
    mkdirSync(join(root, "draft"), { recursive: true })
    const index: RegistryIndex = {
      calldataIndex: {
        ...registry?.index.calldataIndex,
        ...Object.fromEntries(
          deployments.map((d) => [
            `eip155:${d.chainId}:${d.address.toLowerCase()}`,
            relative,
          ])
        ),
      },
      typedDataIndex: registry?.index.typedDataIndex ?? {},
    }
    const draft = createFilesystemResolver({
      index,
      descriptorDirectory: root,
    })
    const clone =
      registry &&
      createFilesystemResolver({
        index,
        descriptorDirectory: registry.descriptorDirectory,
      })
    const resolver: DescriptorResolver = clone
      ? {
          index,
          // A registry descriptor, and each file it includes, from the clone.
          fetchDescriptor: (path) =>
            path === relative
              ? draft.fetchDescriptor(path)
              : clone.fetchDescriptor(path),
        }
      : draft
    const render: Render = (descriptor, tx, provider) => {
      // Written before every render: a format can change between two renders.
      writeFileSync(join(root, relative), JSON.stringify(descriptor))
      return format(tx, {
        descriptorResolverOptions: { type: "custom", resolver },
        externalDataProvider: provider,
      })
    }
    return await work(render)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

export interface ProviderToken {
  readonly name: string
  readonly symbol: string
  readonly decimals: number
}

/**
 * The test runner's data provider: tokens by address alone, whatever chain
 * a field asks on, and chain names and native currencies by chain id.
 * `chainId` limits token answers to one chain; `onLookup` sees every token
 * lookup that found an answer.
 */
export function tokenProvider(
  tokens: Readonly<Record<string, ProviderToken>>,
  chains: Readonly<Record<string, DraftChain>>,
  options: {
    readonly chainId?: number
    readonly onLookup?: (chainId: number, address: string) => void
  } = {}
): ExternalDataProvider {
  return {
    resolveToken: (chainId, address) => {
      const token = tokens[address.toLowerCase()]
      if (!token) return Promise.resolve(null)
      if (options.chainId !== undefined && chainId !== options.chainId)
        return Promise.resolve(null)
      options.onLookup?.(chainId, address.toLowerCase())
      return Promise.resolve({
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      })
    },
    resolveChainInfo: (chainId) => {
      const chain = chains[String(chainId)]
      return Promise.resolve(
        chain
          ? {
              name: chain.name,
              nativeCurrency: { ...chain.nativeCurrency },
            }
          : null
      )
    },
  }
}

/** The display model as the runner records it, and as a test expects it. */
export function toRendered(model: DisplayModel): RenderedDisplay {
  return {
    intent: intentText(model.intent),
    ...(model.interpolatedIntent !== undefined
      ? { interpolatedIntent: model.interpolatedIntent }
      : {}),
    ...(model.metadata?.owner !== undefined
      ? { owner: model.metadata.owner }
      : {}),
    fields: flatten(model.fields ?? []),
  }
}

function intentText(intent: DisplayModel["intent"]): string {
  if (intent == null) return ""
  if (typeof intent === "string") return intent
  return Object.entries(intent)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ")
}

/** Groups flatten in place; a resolved embedded call nests as a display of its own. */
function flatten(
  fields: readonly (DisplayField | DisplayFieldGroup)[]
): RenderedField[] {
  const out: RenderedField[] = []
  for (const field of fields) {
    if (isFieldGroup(field)) {
      out.push(...flatten(field.fields))
      continue
    }
    const display = field.embeddedCalldata?.display
    out.push({
      label: field.label,
      value:
        display && !display.warnings?.length
          ? toRendered(display)
          : field.value,
    })
  }
  return out
}

export interface Inspection {
  /** Top-level warnings: the runner fails a case that has any. */
  readonly failures: readonly string[]
  /** Renders that look wrong: a raw amount where a token amount belongs, a date in 1970. */
  readonly problems: readonly string[]
}

export function inspect(model: DisplayModel): Inspection {
  const failures = (model.warnings ?? []).map((w) => `${w.code}: ${w.message}`)
  const problems: string[] = []
  visit(model.fields ?? [], problems)
  return { failures, problems }
}

function visit(
  fields: readonly (DisplayField | DisplayFieldGroup)[],
  problems: string[]
): void {
  for (const field of fields) {
    if (isFieldGroup(field)) {
      visit(field.fields, problems)
      continue
    }
    const problem = problemOf(field)
    if (problem)
      problems.push(
        `"${field.label}" shows ${JSON.stringify(field.value)}: ${problem}`
      )
  }
}

function problemOf(field: DisplayField): string | undefined {
  const warning = field.warning
  switch (field.format) {
    case "tokenAmount":
      if (warning)
        return `a raw number where a token amount belongs (${warning.code}${field.tokenAddress ? ` for token ${field.tokenAddress}` : ""})`
      if (!/\s\S+$/.test(field.value)) return "a token amount without a symbol"
      return undefined
    case "tokenTicker":
      return warning
        ? `an address where a token symbol belongs (${warning.code})`
        : undefined
    case "amount":
      return warning
        ? `a raw number where a native amount belongs (${warning.code})`
        : undefined
    case "chainId":
      return warning
        ? `a number where a chain name belongs (${warning.code})`
        : undefined
    case "date":
      return /^1970-|NaN/.test(field.value)
        ? "a date that is not one (zero, or out of range)"
        : undefined
    case "calldata": {
      const inner = field.embeddedCalldata?.display.warnings
      return inner?.length
        ? `raw call data: the call it carries did not render (${inner.map((w) => w.code).join(", ")})`
        : undefined
    }
  }
  if (warning && warning.code !== "UNKNOWN_ADDRESS")
    return `${warning.code}: ${warning.message}`
  return undefined
}
