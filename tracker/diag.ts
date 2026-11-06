/**
 * Which public data sources answer from where the fetch step runs. Prints
 * one line per source: HTTP status, time and the start of the body. Used to
 * pick sources; reads only.
 */

const AAVE_BASE = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
const AAVE_L2 = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"

const PROBES: readonly { name: string; url: string; init?: RequestInit }[] = [
  {
    name: "hypersync base query",
    url: "https://8453.hypersync.xyz/query",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from_block: 54_000_000,
        to_block: 54_000_200,
        transactions: [{ to: [AAVE_BASE.toLowerCase()] }],
        field_selection: {
          transaction: ["hash", "input", "block_number"],
          block: ["number", "timestamp"],
        },
      }),
    },
  },
  {
    name: "hypersync arbitrum height",
    url: "https://42161.hypersync.xyz/height",
  },
  {
    name: "sqd portal base head",
    url: "https://portal.sqd.dev/datasets/base-mainnet/head",
  },
  {
    name: "sqd portal arbitrum head",
    url: "https://portal.sqd.dev/datasets/arbitrum-one/head",
  },
  {
    name: "sqd portal base stream",
    url: "https://portal.sqd.dev/datasets/base-mainnet/stream",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "evm",
        fromBlock: 38_000_000,
        toBlock: 38_000_100,
        fields: {
          block: { number: true, timestamp: true },
          transaction: { hash: true, input: true, to: true },
        },
        transactions: [{ to: [AAVE_BASE.toLowerCase()] }],
      }),
    },
  },
  {
    name: "arbitrum blockscout v2 transactions",
    url: `https://arbitrum.blockscout.com/api/v2/addresses/${AAVE_L2}/transactions?filter=to`,
  },
  {
    name: "base blockscout default user agent",
    url: `https://base.blockscout.com/api?module=account&action=txlist&address=${AAVE_BASE}&filter_by=to&sort=desc&page=1&offset=5`,
  },
]

export async function diagnose(log: (line: string) => void): Promise<void> {
  for (const probe of PROBES) {
    const started = Date.now()
    try {
      const response = await fetch(probe.url, {
        ...probe.init,
        signal: AbortSignal.timeout(20_000),
      })
      const body = (await response.text()).replace(/\s+/g, " ").slice(0, 160)
      log(
        `${probe.name}: HTTP ${response.status} in ${Date.now() - started} ms: ${body}`
      )
    } catch (error) {
      log(
        `${probe.name}: failed in ${Date.now() - started} ms: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
