import { fetchJson, FetchError } from "../src/fetch.js"

/**
 * Network helpers for the tracker's fetch step, which runs where public
 * APIs are reachable (the tracker-fetch workflow): a concurrency limit per
 * service, and retries with backoff for rate limits and server errors.
 */

export class Limiter {
  private active = 0
  private readonly queue: (() => void)[] = []

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.queue.shift()?.()
    }
  }
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface GetJsonOptions {
  readonly timeoutMs?: number
  readonly maxBytes?: number
  readonly allowNotFound?: boolean
  readonly attempts?: number
}

/**
 * A bounded JSON read that retries a 429, a 5xx or a network failure, with
 * exponential backoff: from 2 seconds after a 5xx or a network failure, and
 * from 5 seconds to a minute after a 429 (Blockscout's keyless limit), each
 * wait shifted by up to a quarter so that parallel reads spread out. A 4xx
 * other than 404 and 429 fails at once; a 404 is `null` when
 * `allowNotFound` is set.
 */
export async function getJson(
  url: string,
  limiter: Limiter,
  options: GetJsonOptions = {}
): Promise<unknown> {
  const attempts = options.attempts ?? 6
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await limiter.run(() =>
        fetchJson(url, {
          fetch: (input, init) => globalThis.fetch(input, init),
          timeoutMs: options.timeoutMs ?? 30_000,
          maxBytes: options.maxBytes ?? 16 * 1024 * 1024,
          ...(options.allowNotFound ? { allowNotFound: true } : {}),
          headers: { "user-agent": "b3pay-clear-signing-tracker" },
        })
      )
    } catch (error) {
      last = error
      const status = error instanceof FetchError ? error.status : undefined
      const retry =
        status === undefined ||
        status === 429 ||
        (status >= 500 && status < 600)
      if (!retry || attempt === attempts - 1) break
      const base = status === 429 ? 5_000 : 2_000
      await sleep(
        Math.min(60_000, base * 2 ** attempt) * (0.75 + Math.random() / 2)
      )
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
