import type { Abi, Address, Hex } from "viem"

/**
 * The draft engine's input and output. A draft is an ERC-7730 v2 calldata
 * descriptor, a testsv2 file of real transactions rendered through it, and
 * the notes a person must read before submitting either.
 */

/** One real transaction to the contract, with every field needed to rebuild it unsigned. */
export interface DraftSample {
  readonly hash: Hex
  readonly chainId: number
  readonly to: Address
  /** Wei, in decimal. */
  readonly value: string
  readonly input: Hex
  readonly nonce: number
  /** Gas limit, in decimal. */
  readonly gas: string
  readonly type: string
  readonly gasPrice?: string
  readonly maxFeePerGas?: string
  readonly maxPriorityFeePerGas?: string
  readonly accessList?: readonly {
    readonly address: Address
    readonly storageKeys: readonly Hex[]
  }[]
  readonly status?: "success" | "reverted"
}

export interface DraftToken {
  readonly symbol: string
  readonly decimals: number
  readonly name?: string
}

export interface DraftChain {
  readonly name: string
  readonly nativeCurrency: {
    readonly name: string
    readonly symbol: string
    readonly decimals: number
  }
}

export interface DraftInput {
  readonly chainId: number
  readonly address: string
  /** Other deployments of the same code the descriptor also binds to. */
  readonly extraDeployments?: readonly {
    readonly chainId: number
    readonly address: string
  }[]
  readonly abi: Abi
  /** The contract's name: the file is calldata-<contractName>.json. */
  readonly contractName?: string
  readonly owner: string
  /** ERC-7730 v2 has no field for it; a draft notes that it was left out. */
  readonly legalName?: string
  readonly url?: string
  /** 4-byte selectors to describe, in priority order. Default: every function that is not view or pure. */
  readonly selectors?: readonly string[]
  /** Real transactions: one per described function becomes a test. */
  readonly samples?: readonly DraftSample[]
  /** Tokens on `chainId` by address, for the tests' data provider. */
  readonly tokens?: Readonly<Record<string, DraftToken>>
  /**
   * Chain names and native currencies by chain id, as the registry's test
   * runner reads them from chainid.network. Native amounts and chain ids
   * render raw without them.
   */
  readonly chains?: Readonly<Record<string, DraftChain>>
}

export type FieldFormat =
  | "raw"
  | "amount"
  | "tokenAmount"
  | "date"
  | "duration"
  | "chainId"
  | "addressName"
  | "tokenTicker"
  | "calldata"

export interface DescriptorField {
  readonly path: string
  readonly label: string
  readonly format?: FieldFormat
  readonly params?: Readonly<Record<string, unknown>>
  readonly visible?: "never"
}

export interface DescriptorFormat {
  readonly intent: string
  readonly interpolatedIntent?: string
  readonly fields: readonly DescriptorField[]
}

export interface DraftDescriptor {
  readonly $schema: string
  readonly context: {
    readonly contract: {
      readonly deployments: readonly {
        readonly chainId: number
        readonly address: string
      }[]
    }
  }
  readonly metadata: {
    readonly owner: string
    readonly contractName?: string
    readonly info?: { readonly url: string }
  }
  readonly display: {
    readonly formats: Readonly<Record<string, DescriptorFormat>>
  }
}

/** What the registry's test runner compares: the rendered intent, owner and fields. */
export interface RenderedDisplay {
  readonly intent: string
  readonly interpolatedIntent?: string
  readonly owner?: string
  readonly fields: readonly RenderedField[]
}

export interface RenderedField {
  readonly label: string
  readonly value: string | RenderedDisplay
}

export interface DraftTestCase {
  readonly description: string
  /** The sample rebuilt as an unsigned serialized transaction. */
  readonly rawTx: Hex
  readonly txHash: Hex
  readonly expected: RenderedDisplay
}

export interface DraftTests {
  readonly $schema: string
  /** The descriptor, relative to the tests file. */
  readonly descriptor: string
  readonly dataProvider?: {
    readonly tokens: Readonly<
      Record<
        string,
        {
          readonly name: string
          readonly symbol: string
          readonly decimals: number
        }
      >
    >
  }
  readonly tests: readonly DraftTestCase[]
}

export interface DraftResult {
  /** calldata-<contractName>.json; the tests file is testsv2/calldata-<contractName>.tests.json. */
  readonly fileName: string
  readonly descriptor: DraftDescriptor
  readonly tests: DraftTests
  /** What a person must check before submitting the draft. */
  readonly review: string[]
}
