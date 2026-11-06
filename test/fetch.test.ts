import { describe, expect, it } from "vitest"
import {
  FetchError,
  fetchJson,
  TtlCache,
  type FetchLike,
} from "../src/fetch.js"

const URL = "https://example.test/file.json"

type Body = ConstructorParameters<typeof Response>[0]

function answer(body: Body, init?: ResponseInit): FetchLike {
  return () => Promise.resolve(new Response(body, init))
}

function options(
  fetch: FetchLike,
  extra: { allowNotFound?: boolean; timeoutMs?: number } = {}
) {
  return { fetch, timeoutMs: extra.timeoutMs ?? 1_000, maxBytes: 64, ...extra }
}

async function failure(promise: Promise<unknown>): Promise<FetchError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason
  )
  expect(error).toBeInstanceOf(FetchError)
  return error as FetchError
}

describe("fetchJson", () => {
  it("reads a JSON document", async () => {
    expect(await fetchJson(URL, options(answer('{"a":[1,2]}')))).toEqual({
      a: [1, 2],
    })
  })

  it("asks for JSON", async () => {
    let accept: string | null = null
    const fetch: FetchLike = (_input, init) => {
      accept = new Headers(init?.headers).get("accept")
      return Promise.resolve(new Response("{}"))
    }
    await fetchJson(URL, options(fetch))
    expect(accept).toBe("application/json")
  })

  it("answers null for a 404 when that is allowed", async () => {
    expect(
      await fetchJson(
        URL,
        options(answer("Not Found", { status: 404 }), { allowNotFound: true })
      )
    ).toBeNull()
  })

  it("fails on a 404 otherwise, with the status", async () => {
    const error = await failure(
      fetchJson(URL, options(answer("Not Found", { status: 404 })))
    )
    expect(error.status).toBe(404)
    expect(error.url).toBe(URL)
  })

  it("fails on a server error", async () => {
    const error = await failure(
      fetchJson(
        URL,
        options(answer("oops", { status: 503 }), { allowNotFound: true })
      )
    )
    expect(error.message).toContain("HTTP 503")
  })

  it("refuses a declared length over the limit before reading the body", async () => {
    const error = await failure(
      fetchJson(
        URL,
        options(answer("{}", { headers: { "content-length": "1000" } }))
      )
    )
    expect(error.message).toContain("over the 64-byte limit")
  })

  it("stops reading a body that grows past the limit", async () => {
    let pulls = 0
    // 3,200 bytes of JSON whitespace with no declared length.
    const long = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls > 100) controller.close()
        else controller.enqueue(new Uint8Array(32).fill(0x20))
      },
    })
    const error = await failure(fetchJson(URL, options(answer(long))))
    expect(error.message).toContain("over the 64-byte limit")
    expect(pulls).toBeLessThan(10)
  })

  it("refuses a body that is not UTF-8", async () => {
    const error = await failure(
      fetchJson(URL, options(answer(new Uint8Array([0x22, 0xff, 0xfe, 0x22]))))
    )
    expect(error.message).toContain("not valid UTF-8")
  })

  it("refuses a body that is not JSON", async () => {
    const error = await failure(fetchJson(URL, options(answer("{ not json"))))
    expect(error.message).toContain("not valid JSON")
  })

  it("gives up at the time limit", async () => {
    const hang: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason as Error)
        )
      })
    const started = Date.now()
    const error = await failure(
      fetchJson(URL, options(hang, { timeoutMs: 50 }))
    )
    expect(error.message).toMatch(/timeout|aborted/i)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it("reports a network failure as a FetchError", async () => {
    const down: FetchLike = () => Promise.reject(new TypeError("fetch failed"))
    const error = await failure(fetchJson(URL, options(down)))
    expect(error.message).toBe(`Request to ${URL} failed: fetch failed`)
  })
})

describe("TtlCache", () => {
  it("shares one pending load among callers", async () => {
    const cache = new TtlCache<number>(1_000, 10, () => 0)
    let loads = 0
    const load = () => {
      loads += 1
      return Promise.resolve(loads)
    }
    expect(
      await Promise.all([cache.get("k", load), cache.get("k", load)])
    ).toEqual([1, 1])
    expect(loads).toBe(1)
  })

  it("loads again once the time limit passes", async () => {
    let now = 0
    const cache = new TtlCache<number>(1_000, 10, () => now)
    let loads = 0
    const load = () => Promise.resolve(++loads)
    await cache.get("k", load)
    now = 999
    expect(await cache.get("k", load)).toBe(1)
    now = 1_000
    expect(await cache.get("k", load)).toBe(2)
  })

  it("does not keep a failed load", async () => {
    const cache = new TtlCache<number>(1_000, 10, () => 0)
    await expect(
      cache.get("k", () => Promise.reject(new Error("down")))
    ).rejects.toThrow("down")
    expect(await cache.get("k", () => Promise.resolve(7))).toBe(7)
  })

  it("evicts the least recently used entry when full", async () => {
    const cache = new TtlCache<string>(1_000, 2, () => 0)
    const loaded: string[] = []
    const load = (key: string) => () => {
      loaded.push(key)
      return Promise.resolve(key)
    }
    await cache.get("a", load("a"))
    await cache.get("b", load("b"))
    await cache.get("a", load("a"))
    await cache.get("c", load("c"))
    await cache.get("a", load("a"))
    await cache.get("b", load("b"))
    expect(loaded).toEqual(["a", "b", "c", "b"])
  })
})
