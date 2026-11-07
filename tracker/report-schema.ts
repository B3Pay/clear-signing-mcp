/**
 * coverage.json: the public data of the Clear Signing coverage tracker.
 * Produced by clear-signing-mcp's tracker (`cli.js report`), copied into
 * b3pay.net as src/data/clear-signing-coverage.json, rendered at
 * /clear-signing/coverage/ and served as /clear-signing/coverage.json.
 *
 * Every number is measured from a named source at a stated time. Nothing in
 * it says "attested" unless an ERC-8176 attestation verified.
 */

export type ChainId = 1 | 8453 | 42161 | 10

/** covered: the registry has a descriptor for this deployment and it formats
 *  at least 95% of what recent senders called (each sender counted once per
 *  function; by transactions when senders are unknown, by the ABI's
 *  state-changing functions when there were no recent calls);
 *  partial: a descriptor exists but formats less than that, or its reach
 *  could not be measured;
 *  uncovered: no descriptor for this deployment in the registry. */
export type CoverageStatus = "covered" | "partial" | "uncovered"

export interface CoverageReport {
  readonly version: 1
  /** ISO time the report was built. */
  readonly generatedAt: string
  readonly registry: {
    readonly repo: "ethereum/clear-signing-erc7730-registry"
    readonly commit: string // full SHA
    readonly committedAt: string // ISO
    /** Deployments (chain, address) the registry's calldata index lists on the four chains. */
    readonly deploymentsOnTrackedChains: number
  }
  readonly sources: {
    /** Oldest and newest time a contract's on-chain facts were read. */
    readonly onchain: { readonly oldest: string; readonly newest: string }
    /** When DefiLlama's TVL figures were read, if used. */
    readonly defillama?: string
  }
  readonly totals: Totals & { readonly protocols: number }
  readonly chains: Readonly<
    Record<`${ChainId}`, Totals & { readonly name: string }>
  >
  readonly categories: Readonly<
    Record<string, Totals & { readonly label: string }>
  >
  /** Sorted by recent transactions per day, most first. */
  readonly protocols: readonly Protocol[]
}

export interface Totals {
  readonly contracts: number
  readonly covered: number
  readonly partial: number
  readonly uncovered: number
  /** Contracts with a B3Pay draft descriptor tested on real transactions. */
  readonly drafts: number
  /** Uncovered contracts whose recent calls the registry's descriptor for
   *  another deployment (Contract.elsewhere) formats as fully as "covered"
   *  asks: they would count as covered if that descriptor listed them. */
  readonly describedElsewhere: number
  /** Share (0..1) of recent transactions, weighted by each contract's
   *  transactions per day, whose function the registry formats. Plain
   *  transfers with no calldata are left out. Null when no sample. */
  readonly txShareCovered: number | null
  /** The same weighting over each contract's signer share: of the distinct
   *  senders per function in its sample, the share whose function the
   *  registry formats. A relayer bot that sends many calls counts once. */
  readonly signerShareCovered: number | null
  /** Sum of the contracts' recent transactions per day. */
  readonly perDay: number
}

export interface Protocol {
  readonly id: string // kebab-case
  readonly name: string
  readonly category: string
  readonly categoryLabel: string
  readonly website: string
  /** TVL in USD on the four chains, from DefiLlama, when matched. */
  readonly tvlUsd: number | null
  readonly status: CoverageStatus // all contracts covered / some / none
  readonly totals: Totals
  readonly contracts: readonly Contract[]
}

export interface Contract {
  readonly chainId: ChainId
  readonly address: string // EIP-55
  readonly name: string // contract name as verified
  readonly label: string // human label, e.g. "Universal Router (v4)"
  readonly role: string // one line: what users do with it
  readonly version?: string
  readonly status: CoverageStatus
  /** Where the address was taken from (official docs or repository). */
  readonly addressSource: string
  readonly explorerUrl: string // e.g. https://etherscan.io/address/0x...
  readonly sourcify: "exact_match" | "match" | "not_verified" | "unknown"
  readonly descriptor: null | {
    readonly path: string // registry/<entity>/calldata-X.json
    readonly url: string // https://github.com/ethereum/clear-signing-erc7730-registry/blob/<commit>/<path>
    readonly owner: string | null // metadata.owner
    readonly formats: number // number of functions it formats
    /** "verified": an ERC-8176 attestation verified offline and EAS says not
     *  revoked; "unverified": an attestation file exists but was not (or could
     *  not be) verified; "none": no attestation file. */
    readonly attestation: "verified" | "unverified" | "none"
  }
  /** State-changing functions in the verified ABI, and how many the descriptor formats. */
  readonly functions: null | {
    readonly writable: number
    readonly formatted: number
  }
  /** Recent transactions; null when they could not be read. */
  readonly sample: null | {
    readonly count: number // transactions in the sample; 0 when there were none
    readonly perDay: number | null
    /** The oldest and newest transaction in the sample; for an empty one, the
     *  span read (or, when that is not known, the time it was read). */
    readonly oldest: string // ISO
    readonly newest: string // ISO
    readonly txShareCovered: number | null // 0..1, null when no calldata txs
    /** 0..1: distinct senders per function whose function is formatted. */
    readonly signerShareCovered: number | null
  }
  /** The most-called functions in the sample, up to 5. */
  readonly topFunctions: readonly {
    readonly selector: string // 0x12345678
    readonly signature: string | null // e.g. "execute(bytes,bytes[],uint256)"
    readonly share: number // 0..1 of the sample's calls with calldata
    readonly senders: number | null // distinct senders of this function in the sample
    readonly formatted: boolean // the registry descriptor formats it
  }[]
  /** For a deployment the registry does not list: the registry's descriptor
   *  for another deployment (the same address on another chain, or another
   *  contract of the same protocol) that formats the most of this contract's
   *  recent calls. Every function it formats is in this contract's ABI (with
   *  no ABI, it is the same address). It does not list this deployment, and
   *  whether it fits this one is for the protocol to check. Null when none
   *  formats any recent call. */
  readonly elsewhere: null | {
    readonly chainId: number
    readonly chainName: string
    readonly address: string // EIP-55
    /** The described deployment's label when it is tracked, else this contract's. */
    readonly label: string
    readonly sameAddress: boolean
    readonly path: string
    readonly url: string
    /** 0..1 of this contract's recent calls with calldata it formats. */
    readonly txShareCovered: number | null
    /** 0..1 of this contract's distinct senders per function it formats. */
    readonly signerShareCovered: number | null
  }
  readonly draft: null | {
    /** Functions the draft formats; each has a test built from a real transaction. */
    readonly functions: number
    readonly testedTxs: number
    readonly lint: "pass" | "warnings"
    /** 0..1 of this contract's recent calls with calldata whose function the
     *  draft formats; null without such calls. */
    readonly txShareCovered: number | null
    /** 0..1 of its distinct senders per function whose function the draft
     *  formats; null when senders are unknown. */
    readonly signerShareCovered: number | null
    /** How one real transaction reads with the draft (present only if the page shows previews). */
    readonly preview?: {
      readonly txHash: string
      readonly intent: string
      readonly fields: readonly {
        readonly label: string
        readonly value: string
      }[]
    }
  }
}
