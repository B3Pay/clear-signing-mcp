/**
 * Text that came from outside this server: descriptor labels and intents,
 * token symbols, ABI names, revert reasons. It reaches an agent's model and,
 * through it, a person, so every such string is made inert before it leaves:
 * characters a renderer acts on instead of showing are spelled out, and the
 * string is cut to a bounded length.
 */

/** Longest string, in code points, a result carries from an outside source. */
export const MAX_TEXT_LENGTH = 500

/**
 * Whether a character changes how text around it is shown rather than being
 * shown itself: a C0 or C1 control (line breaks and escape included), DEL, a
 * bidirectional formatting character, or an invisible joiner or mark.
 */
export function isUnsafeCodePoint(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x61c ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x2064) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  )
}

export interface CleanedText {
  readonly text: string
  /** True when a character was spelled out or the text was cut. */
  readonly changed: boolean
}

/**
 * `value` with each unsafe character spelled out as `\u{…}` and cut to
 * `max` code points, the cut marked with an ellipsis.
 */
export function cleanText(value: string, max = MAX_TEXT_LENGTH): CleanedText {
  let text = ""
  let count = 0
  let changed = false
  for (const char of value) {
    if (count >= max) {
      return { text: `${text}…`, changed: true }
    }
    const code = char.codePointAt(0) ?? 0
    if (isUnsafeCodePoint(code)) {
      text += `\\u{${code.toString(16)}}`
      changed = true
    } else {
      text += char
    }
    count += 1
  }
  return { text, changed }
}

/**
 * Walks a JSON-like value and cleans every string in it, keys included.
 * `onChange` is called once per string that had to be changed.
 */
export function cleanDeep<T>(
  value: T,
  onChange?: (before: string) => void,
  max = MAX_TEXT_LENGTH
): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") {
      const cleaned = cleanText(node, max)
      if (cleaned.changed) onChange?.(node)
      return cleaned.text
    }
    if (Array.isArray(node)) return node.map(visit)
    if (node !== null && typeof node === "object") {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(node)) {
        const cleanedKey = cleanText(key, max)
        if (cleanedKey.changed) onChange?.(key)
        out[cleanedKey.text] = visit(child)
      }
      return out
    }
    return node
  }
  return visit(value) as T
}

/**
 * A string quoted for a text result: JSON quoting, so quotes and backslashes
 * inside it cannot end the quote early, after the cleaning above.
 */
export function quote(value: string, max = MAX_TEXT_LENGTH): string {
  return JSON.stringify(cleanText(value, max).text)
}
