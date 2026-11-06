import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The live suite reaches GitHub and RPCs; it runs only through `pnpm test:live`.
    exclude: process.env.LIVE ? [] : ["test/live/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
