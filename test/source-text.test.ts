import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { isUnsafeCodePoint } from "../src/text.js"

/**
 * This repository's own files hold no character that changes how the text
 * around it is shown (a bidirectional override, an invisible joiner, a stray
 * control): a reviewer must see the code that runs. Tests that need such a
 * character write it as an escape, like "\u202e".
 */

const root = fileURLToPath(new URL("..", import.meta.url))
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", "fixtures"])
const TEXT =
  /\.(ts|js|mjs|json|md|sol|ya?ml)$|^\.[a-z]+rc$|^\.(gitignore|prettierignore)$|^LICENSE$/

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return files(path)
    return TEXT.test(entry.name) ? [path] : []
  })
}

describe("the repository's own text", () => {
  it("has files to check", () => {
    expect(files(root).map((path) => relative(root, path))).toEqual(
      expect.arrayContaining([
        "src/server.ts",
        "test/helpers.ts",
        "package.json",
      ])
    )
  })

  it("holds no bidirectional, invisible or control character", () => {
    const found: string[] = []
    for (const path of files(root)) {
      const lines = readFileSync(path, "utf8").split("\n")
      lines.forEach((line, i) => {
        for (const char of line) {
          const code = char.codePointAt(0) ?? 0
          if (code !== 0x09 && code !== 0x0d && isUnsafeCodePoint(code)) {
            found.push(
              `${relative(root, path)}:${i + 1} U+${code.toString(16).padStart(4, "0")}`
            )
          }
        }
      })
    }
    expect(found).toEqual([])
  })
})
