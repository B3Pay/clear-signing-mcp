import { spawn, type ChildProcess } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem"
import { foundry } from "viem/chains"

/**
 * A local anvil chain for the simulation tests, started on a free port and
 * stopped after the suite. Anvil's accounts are unlocked, so the test token
 * is deployed with `eth_sendTransaction` and no key appears in this code.
 */

/** The first account anvil unlocks: it deploys the token and holds its supply. */
export const DEPLOYER: Address = getAddress(
  "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"
)

export interface Anvil {
  readonly url: string
  readonly token: Address
  stop(): Promise<void>
}

const ARTIFACT = JSON.parse(
  readFileSync(new URL("./contracts/TestToken.json", import.meta.url), "utf8")
) as {
  abi: Abi
  bytecode: Hex
}

export const TEST_TOKEN_ABI = ARTIFACT.abi

export async function startAnvil(): Promise<Anvil> {
  const require = createRequire(import.meta.url)
  const bin = require.resolve("@foundry-rs/anvil/bin.mjs")
  const child = spawn(
    process.execPath,
    [bin, "--port", "0", "--chain-id", String(foundry.id)],
    {
      stdio: ["ignore", "pipe", "pipe"],
    }
  )
  let url: string
  try {
    url = await listeningUrl(child)
  } catch (error) {
    child.kill("SIGKILL")
    throw error
  }
  const stop = () => stopProcess(child)

  try {
    const transport = http(url)
    const wallet = createWalletClient({ chain: foundry, transport })
    const reader = createPublicClient({ chain: foundry, transport })
    const hash = await wallet.deployContract({
      abi: ARTIFACT.abi,
      bytecode: ARTIFACT.bytecode,
      account: DEPLOYER,
    })
    const receipt = await reader.waitForTransactionReceipt({ hash })
    if (receipt.status !== "success" || !receipt.contractAddress)
      throw new Error("The test token did not deploy")
    return { url, token: getAddress(receipt.contractAddress), stop }
  } catch (error) {
    await stop()
    throw error
  }
}

function listeningUrl(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ""
    const timer = setTimeout(
      () => reject(new Error("anvil did not start within 30 seconds")),
      30_000
    )
    // Anvil's banner lists its well-known development keys; it is scanned for
    // the port and never printed.
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      const match = /Listening on (\d{1,3}(?:\.\d{1,3}){3}:\d+)/.exec(output)
      if (match?.[1]) {
        clearTimeout(timer)
        resolve(`http://${match[1]}`)
      }
    })
    child.stderr?.resume()
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code) => {
      clearTimeout(timer)
      reject(
        new Error(`anvil exited with code ${String(code)} before it listened`)
      )
    })
  })
}

function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill("SIGTERM")
  })
}
