/**
 * Bounded HTTP reads. Every outside document this server reads goes through
 * `fetchJson`, which stops at a time limit and a byte limit and fails closed:
 * a slow, oversized or malformed answer is an error, never a partial value.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class FetchError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number
  ) {
    super(message)
    this.name = "FetchError"
  }
}

export interface FetchJsonOptions {
  readonly fetch: FetchLike
  readonly timeoutMs: number
  readonly maxBytes: number
  /** Answer `null` for a 404 instead of failing. */
  readonly allowNotFound?: boolean
  readonly headers?: Record<string, string>
}

export async function fetchJson(
  url: string,
  options: FetchJsonOptions
): Promise<unknown> {
  let response: Response
  try {
    response = await options.fetch(url, {
      headers: { accept: "application/json", ...options.headers },
      redirect: "follow",
      signal: AbortSignal.timeout(options.timeoutMs),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new FetchError(`Request to ${url} failed: ${reason}`, url)
  }

  if (response.status === 404 && options.allowNotFound) {
    await response.body?.cancel()
    return null
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new FetchError(
      `HTTP ${response.status} from ${url}`,
      url,
      response.status
    )
  }

  const declared = Number(response.headers.get("content-length") ?? "NaN")
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    await response.body?.cancel()
    throw new FetchError(
      `Response from ${url} is ${declared} bytes, over the ${options.maxBytes}-byte limit`,
      url
    )
  }

  const bytes = await readBounded(response, url, options.maxBytes)
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new FetchError(`Response from ${url} is not valid UTF-8`, url)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new FetchError(`Response from ${url} is not valid JSON`, url)
  }
}

async function readBounded(
  response: Response,
  url: string,
  maxBytes: number
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    let result: Awaited<ReturnType<typeof reader.read>>
    try {
      result = await reader.read()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new FetchError(`Reading ${url} failed: ${reason}`, url)
    }
    if (result.done) break
    const chunk: unknown = result.value
    if (!(chunk instanceof Uint8Array)) {
      await reader.cancel()
      throw new FetchError(`Reading ${url} failed: the body is not bytes`, url)
    }
    total += chunk.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new FetchError(
        `Response from ${url} is over the ${maxBytes}-byte limit`,
        url
      )
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * A small time-limited cache of promises. A pending load is shared by every
 * caller that asks for the same key, and a failed load is not kept.
 */
export class TtlCache<V> {
  private readonly entries = new Map<
    string,
    { expires: number; value: Promise<V> }
  >()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now
  ) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const time = this.now()
    const hit = this.entries.get(key)
    if (hit && hit.expires > time) {
      // Re-insert so the map's order is least recently used first.
      this.entries.delete(key)
      this.entries.set(key, hit)
      return hit.value
    }
    const value = load()
    const entry = { expires: time + this.ttlMs, value }
    this.entries.set(key, entry)
    value.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    })
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next()
      if (oldest.done) break
      this.entries.delete(oldest.value)
    }
    return value
  }

  clear(): void {
    this.entries.clear()
  }
}
