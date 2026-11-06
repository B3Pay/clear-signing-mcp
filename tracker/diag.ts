/**
 * Which public data sources answer from where the fetch step runs. Prints
 * one line per source: HTTP status, time and the start of the body. Used to
 * pick sources; reads only.
 */

const AAVE_BASE = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
const AAVE_L2 = "0x794a61358D6845594F94dc1DB02A252b5b4814aD"

const PROBES: readonly { name: string; url: string; init?: RequestInit }[] = [
  {
    name: "base blockscout txlist",
    url: `https://base.blockscout.com/api?module=account&action=txlist&address=${AAVE_BASE}&filter_by=to&sort=desc&page=1&offset=5`,
  },
  {
    name: "base blockscout v2 address",
    url: `https://base.blockscout.com/api/v2/addresses/${AAVE_BASE}`,
  },
  {
    name: "base routescan txlist",
    url: `https://api.routescan.io/v2/network/mainnet/evm/8453/etherscan/api?module=account&action=txlist&address=${AAVE_BASE}&sort=desc&page=1&offset=5`,
  },
  {
    name: "arbitrum blockscout txlist",
    url: `https://arbitrum.blockscout.com/api?module=account&action=txlist&address=${AAVE_L2}&filter_by=to&sort=desc&page=1&offset=5`,
  },
  {
    name: "optimism blockscout txlist",
    url: `https://optimism.blockscout.com/api?module=account&action=txlist&address=${AAVE_L2}&filter_by=to&sort=desc&page=1&offset=5`,
  },
  {
    name: "arbitrum routescan txlist",
    url: `https://api.routescan.io/v2/network/mainnet/evm/42161/etherscan/api?module=account&action=txlist&address=${AAVE_L2}&sort=desc&page=1&offset=5`,
  },
  {
    name: "optimism routescan txlist",
    url: `https://api.routescan.io/v2/network/mainnet/evm/10/etherscan/api?module=account&action=txlist&address=${AAVE_L2}&sort=desc&page=1&offset=5`,
  },
  {
    name: "subsquid base archive height",
    url: "https://v2.archive.subsquid.io/network/base-mainnet/height",
  },
  {
    name: "hypersync base height",
    url: "https://8453.hypersync.xyz/height",
  },
  {
    name: "sourcify base lookup",
    url: `https://sourcify.dev/server/v2/contract/8453/${AAVE_BASE}`,
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
