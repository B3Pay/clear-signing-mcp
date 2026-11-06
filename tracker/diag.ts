/**
 * Which public data sources answer from where the fetch step runs. Prints
 * one line per source: HTTP status, time and the start of the body. Used to
 * pick sources; reads only.
 */

const AAVE_BASE = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
const AAVE_L2 = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"

const UNUSED = "0x000000000000000000000000000000000000b3b3"

const PROBES: readonly { name: string; url: string; init?: RequestInit }[] = [
  {
    // Does a long range with no match come back empty, or end with the
    // last block scanned? The SQD source treats an empty answer as "none".
    name: "sqd portal base empty range",
    url: "https://portal.sqd.dev/datasets/base-mainnet/finalized-stream",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "evm",
        fromBlock: 50_000_000,
        toBlock: 51_000_000,
        fields: { block: { number: true, timestamp: true } },
        transactions: [{ to: [UNUSED] }],
      }),
    },
  },
  {
    name: "sqd portal arbitrum finalized head",
    url: "https://portal.sqd.dev/datasets/arbitrum-one/finalized-head",
  },
  {
    name: "sqd portal arbitrum stream",
    url: "https://portal.sqd.dev/datasets/arbitrum-one/finalized-stream",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "evm",
        fromBlock: 400_000_000,
        toBlock: 400_010_000,
        fields: {
          block: { number: true, timestamp: true },
          transaction: { hash: true, sighash: true, status: true },
        },
        transactions: [{ to: [AAVE_L2.toLowerCase()] }],
      }),
    },
  },
  {
    name: "base blockscout txlist",
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
      const text = await response.text()
      const lines = text.split("\n").filter((line) => line.trim()).length
      const body = text.replace(/\s+/g, " ")
      log(
        `${probe.name}: HTTP ${response.status} in ${Date.now() - started} ms, ${text.length} bytes, ${lines} lines: ${body.slice(0, 160)}${body.length > 320 ? ` ... ${body.slice(-160)}` : ""}`
      )
    } catch (error) {
      log(
        `${probe.name}: failed in ${Date.now() - started} ms: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
