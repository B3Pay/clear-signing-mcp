import { execFileSync, spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import {
  defaultChainListFile,
  loadChainList,
  sha256File,
  writeSummary,
  type ChainList,
} from "./draft.js"

/**
 * Checks a draft the way the registry's CI checks a pull request, before
 * anyone opens one. The draft's entity folder is copied into a temporary copy
 * of a registry clone, and these run there:
 *
 *   schema             .github/scripts/validate-json-schemas.sh (check-jsonschema)
 *   lint               the pinned erc7730 linter, with the ABIs of tracker data (lint_descriptor.py)
 *   selectorCoverage   .github/scripts/check-selector-coverage.js
 *   recommendedFields  .github/scripts/check-recommended-fields.js (suggestions, never a failure)
 *   tests              the Sourcify test runner at TEST_RUNNER.commit
 *
 * The results go to tracker/drafts/<protocol>/calldata-<Name>.validation.json,
 * and tracker/drafts/summary.json is rewritten from them.
 */

export const TEST_RUNNER = {
  repo: "https://github.com/sourcifyeth/clear-signing-test-runner.git",
  commit: "277965de0599977e227f0d5e9e0e66e7690ea392",
} as const

/** Where the runner reads chain names: served from the draft's chain list instead. */
const CHAIN_LIST_URL = "https://chainid.network/chains_mini.json"

export interface ValidateOptions {
  readonly trackerDir: string
  /** A clone of the ERC-7730 registry. */
  readonly registryDir: string
  /** One draft (a calldata-*.json under tracker/drafts/); default every draft. */
  readonly draft?: string
  /** Only the drafts of this protocol. */
  readonly protocol?: string
  /** The test runner checkout; cloned and built at TEST_RUNNER.commit when missing. */
  readonly runnerDir?: string
  /** A Python with the registry's erc7730 and check-jsonschema; a venv is made when missing. */
  readonly python?: string
  /** The chain list the drafts were rendered with. */
  readonly chainsFile?: string
  readonly log?: (line: string) => void
}

type Status = "pass" | "fail"

export interface CheckResult {
  readonly status: string
  readonly messages: readonly string[]
}

export interface DraftValidation {
  readonly descriptor: string
  readonly tests: string
  readonly descriptorSha256: string
  readonly testsSha256: string
  readonly registry: {
    readonly commit: string
    /** Registry descriptors for the same deployments, removed from the copy so the runner finds the draft. */
    readonly displaced: readonly string[]
  }
  readonly tools: {
    readonly runner: string
    readonly erc7730: string
    readonly chainList: { readonly source: string; readonly sha256: string }
  }
  readonly checks: {
    readonly schema: CheckResult & { readonly status: Status }
    readonly lint: CheckResult & {
      readonly status: "pass" | "warnings" | "fail"
    }
    readonly selectorCoverage: CheckResult & { readonly status: Status }
    readonly recommendedFields: CheckResult & {
      readonly status: "pass" | "suggestions" | "fail"
    }
    readonly tests: CheckResult & {
      readonly status: Status
      readonly passed: number
      readonly cases: readonly {
        description: string
        status: string
        message?: string
      }[]
    }
  }
  readonly passed: boolean
}

export async function validateDrafts(
  options: ValidateOptions
): Promise<{ path: string; validation: DraftValidation }[]> {
  const log = options.log ?? (() => {})
  const draftsDir = join(options.trackerDir, "drafts")
  const drafts = options.draft
    ? [resolve(options.draft)]
    : findDrafts(draftsDir, options.protocol)
  if (drafts.length === 0)
    throw new Error(`No draft to check under ${draftsDir}.`)
  const registryDir = resolve(options.registryDir)
  if (!existsSync(join(registryDir, ".github", "scripts")))
    throw new Error(
      `${registryDir} is not a clone of the ERC-7730 registry: it has no .github/scripts.`
    )

  const cache = dirname(defaultChainListFile())
  const runnerCli = ensureRunner(
    options.runnerDir ?? join(cache, "test-runner"),
    log
  )
  const python =
    options.python ??
    ensurePython(join(cache, "erc7730-venv"), registryDir, log)
  const chainList = await loadChainList(options.chainsFile, log)
  const tools = {
    runner: `${TEST_RUNNER.repo}@${TEST_RUNNER.commit}`,
    erc7730: run(python, [
      "-I",
      "-c",
      "import importlib.metadata as m; print(m.version('erc7730'))",
    ]).trim(),
    chainList: { source: chainList.source, sha256: chainList.sha256 },
  }
  const commit = gitHead(registryDir)
  // The registry's scripts require viem: the tracker's own, wherever it runs from.
  const viem = createRequire(import.meta.url).resolve("viem/package.json")

  const out: { path: string; validation: DraftValidation }[] = []
  for (const draft of drafts) {
    log(`checking ${draft}`)
    const validation = checkDraft(draft, {
      registryDir,
      commit,
      runnerCli,
      python,
      chainList,
      tools,
      abisDir: join(options.trackerDir, "data", "abis"),
      lintScript: join(options.trackerDir, "lint_descriptor.py"),
      nodeModules: dirname(dirname(viem)),
    })
    const path = draft.replace(/\.json$/, ".validation.json")
    writeFileSync(path, `${JSON.stringify(validation, null, 2)}\n`)
    for (const [name, check] of Object.entries(validation.checks))
      log(
        `  ${name}: ${check.status}${check.messages.length ? ` (${check.messages.length} messages)` : ""}`
      )
    log(`  ${validation.passed ? "PASSED" : "FAILED"}: wrote ${path}`)
    out.push({ path, validation })
  }
  const summary = writeSummary(draftsDir)
  log(
    `summary: ${Object.keys(summary).length} validated deployment(s) in ${join(draftsDir, "summary.json")}`
  )
  return out
}

function findDrafts(draftsDir: string, protocol: string | undefined): string[] {
  if (!existsSync(draftsDir)) return []
  const out: string[] = []
  for (const name of readdirSync(draftsDir).sort()) {
    if (protocol && name !== protocol) continue
    const dir = join(draftsDir, name)
    if (!statSync(dir).isDirectory()) continue
    for (const file of readdirSync(dir).sort())
      if (
        /^calldata-.+\.json$/.test(file) &&
        !/\.(tests|validation)\.json$/.test(file)
      )
        out.push(join(dir, file))
  }
  return out
}

interface CheckContext {
  readonly registryDir: string
  readonly commit: string
  readonly runnerCli: string
  readonly python: string
  readonly chainList: ChainList
  readonly tools: DraftValidation["tools"]
  readonly abisDir: string
  readonly lintScript: string
  readonly nodeModules: string
}

function checkDraft(draft: string, ctx: CheckContext): DraftValidation {
  const fileName = basename(draft)
  const protocol = basename(dirname(draft))
  const testsName = fileName.replace(/\.json$/, ".tests.json")
  const testsPath = join(dirname(draft), "testsv2", testsName)
  if (!existsSync(testsPath))
    throw new Error(`${draft} has no tests file at ${testsPath}.`)

  const work = mkdtempSync(join(tmpdir(), "draft-check-"))
  try {
    const root = join(work, "registry")
    cpSync(ctx.registryDir, root, {
      recursive: true,
      filter: (src) =>
        basename(src) !== ".git" && basename(src) !== "node_modules",
    })
    const descriptorRel = `registry/${protocol}/${fileName}`
    const testsRel = `registry/${protocol}/testsv2/${testsName}`
    const deployments = deploymentKeys(readJsonFile(draft))
    const displaced = displaceClaimants(root, deployments, descriptorRel)
    mkdirSync(join(root, "registry", protocol, "testsv2"), { recursive: true })
    copyFileSync(draft, join(root, descriptorRel))
    copyFileSync(testsPath, join(root, testsRel))

    const env = {
      ...process.env,
      PATH: `${dirname(ctx.python)}${delimiter}${process.env.PATH ?? ""}`,
      NODE_PATH: ctx.nodeModules,
    }
    const schema = schemaCheck(root, [descriptorRel, testsRel], ctx.python, env)
    const lint = lintCheck(root, descriptorRel, work, ctx)
    const selectorCoverage = coverageCheck(root, descriptorRel, work, env)
    const recommendedFields = recommendedCheck(root, descriptorRel, env)
    const tests = runnerCheck(root, testsRel, work, ctx)
    return {
      descriptor: fileName,
      tests: `testsv2/${testsName}`,
      descriptorSha256: sha256File(draft),
      testsSha256: sha256File(testsPath),
      registry: { commit: ctx.commit, displaced },
      tools: ctx.tools,
      checks: { schema, lint, selectorCoverage, recommendedFields, tests },
      passed:
        schema.status === "pass" &&
        lint.status !== "fail" &&
        selectorCoverage.status === "pass" &&
        recommendedFields.status !== "fail" &&
        tests.status === "pass",
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"))
}

function deploymentKeys(descriptor: unknown): Set<string> {
  const out = new Set<string>()
  const deployments = (
    descriptor as { context?: { contract?: { deployments?: unknown } } }
  )?.context?.contract?.deployments
  if (Array.isArray(deployments))
    for (const d of deployments as { chainId?: unknown; address?: unknown }[])
      if (typeof d.chainId === "number" && typeof d.address === "string")
        out.add(`${d.chainId}:${d.address.toLowerCase()}`)
  return out
}

/**
 * The runner indexes every descriptor of the registry, and the first one
 * that claims a deployment wins. Each registry descriptor that claims one of
 * the draft's deployments, itself or through its includes, is removed from
 * the copy; a file at the draft's own path is replaced by it.
 */
function displaceClaimants(
  root: string,
  deployments: ReadonlySet<string>,
  own: string
): string[] {
  const displaced: string[] = []
  const walk = (dir: string, rel: string) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const relPath = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (
          entry.name !== "tests" &&
          entry.name !== "testsv2" &&
          !entry.name.startsWith(".")
        )
          walk(path, relPath)
        continue
      }
      if (
        !/^calldata-.+\.json$/.test(entry.name) ||
        entry.name.endsWith(".tests.json")
      )
        continue
      const claimed = claimedDeployments(path)
      if (![...claimed].some((key) => deployments.has(key))) continue
      if (relPath !== own) rmSync(path)
      displaced.push(relPath)
    }
  }
  walk(join(root, "registry"), "registry")
  walk(join(root, "ercs"), "ercs")
  return displaced.sort()
}

function claimedDeployments(
  path: string,
  seen = new Set<string>()
): Set<string> {
  if (seen.has(path) || !existsSync(path)) return new Set()
  seen.add(path)
  let descriptor: unknown
  try {
    descriptor = readJsonFile(path)
  } catch {
    return new Set()
  }
  const keys = deploymentKeys(descriptor)
  const includes = (descriptor as { includes?: unknown }).includes
  if (typeof includes === "string")
    for (const key of claimedDeployments(
      resolve(dirname(path), includes),
      seen
    ))
      keys.add(key)
  return keys
}

interface Run {
  readonly status: number
  readonly stdout: string
  readonly stderr: string
}

function spawn(
  command: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): Run {
  const result = spawnSync(command, args, {
    cwd,
    env: env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
}

function schemaCheck(
  root: string,
  files: readonly string[],
  python: string,
  env: NodeJS.ProcessEnv
): DraftValidation["checks"]["schema"] {
  const hasChecker =
    spawnSync("check-jsonschema", ["--version"], { env, encoding: "utf8" })
      .status === 0
  if (hasChecker) {
    const result = spawn(
      "bash",
      [".github/scripts/validate-json-schemas.sh", ...files],
      root,
      env
    )
    return {
      status: result.status === 0 ? "pass" : "fail",
      messages: lines(`${result.stdout}\n${result.stderr}`).filter(
        (line) => !line.startsWith("::group") && !line.startsWith("::endgroup")
      ),
    }
  }
  // The same schemas, by the jsonschema package, when check-jsonschema is not installed.
  const messages: string[] = [
    "check-jsonschema is not installed; validated with the jsonschema package instead.",
  ]
  let ok = true
  for (const file of files) {
    const schema = file.includes("/testsv2/")
      ? "specs/erc7730-tests-v2.schema.json"
      : resolve(
          root,
          dirname(file),
          (readJsonFile(join(root, file)) as { $schema?: string }).$schema ?? ""
        )
    const result = spawn(
      python,
      [
        "-I",
        "-c",
        "import json,sys,jsonschema\nschema=json.load(open(sys.argv[1]))\ndoc=json.load(open(sys.argv[2]))\nerrors=list(jsonschema.validators.validator_for(schema)(schema).iter_errors(doc))\nfor e in errors: print(f\"{sys.argv[2]}: {'/'.join(map(str, e.absolute_path))}: {e.message}\")\nsys.exit(1 if errors else 0)",
        resolve(root, schema),
        join(root, file),
      ],
      root
    )
    if (result.status !== 0) ok = false
    messages.push(...lines(`${result.stdout}\n${result.stderr}`))
  }
  return { status: ok ? "pass" : "fail", messages }
}

function lintCheck(
  root: string,
  descriptorRel: string,
  work: string,
  ctx: CheckContext
): DraftValidation["checks"]["lint"] {
  const out = join(work, "lint.json")
  const result = spawn(
    ctx.python,
    ["-I", ctx.lintScript, "--abis", ctx.abisDir, "--out", out, descriptorRel],
    root
  )
  if (!existsSync(out))
    return {
      status: "fail",
      messages: [
        `the linter wrote no result (exit ${result.status})`,
        ...lines(result.stderr),
      ],
    }
  const report = readJsonFile(out) as {
    outputs: { level: string; title: string | null; message: string }[]
    missing: { chainId: number; address: string }[]
  }
  const messages = [
    ...report.missing.map(
      (m) => `error: no ABI in tracker data for ${m.chainId}:${m.address}`
    ),
    ...report.outputs.map(
      (o) => `${o.level}: ${o.title ? `${o.title}: ` : ""}${o.message}`
    ),
  ]
  const levels = new Set(report.outputs.map((o) => o.level))
  const status =
    result.status !== 0 || report.missing.length > 0 || levels.has("error")
      ? "fail"
      : levels.has("warning")
        ? "warnings"
        : "pass"
  return { status, messages }
}

function coverageCheck(
  root: string,
  descriptorRel: string,
  work: string,
  env: NodeJS.ProcessEnv
): DraftValidation["checks"]["selectorCoverage"] {
  const report = join(work, "coverage.json")
  const result = spawn(
    process.execPath,
    [
      ".github/scripts/check-selector-coverage.js",
      "--report",
      report,
      descriptorRel,
    ],
    root,
    env
  )
  const errors = existsSync(report)
    ? ((readJsonFile(report) as Record<string, string[]>)[descriptorRel] ?? [])
    : []
  return {
    status: result.status === 0 ? "pass" : "fail",
    messages:
      errors.length > 0 ? errors : lines(`${result.stdout}\n${result.stderr}`),
  }
}

function recommendedCheck(
  root: string,
  descriptorRel: string,
  env: NodeJS.ProcessEnv
): DraftValidation["checks"]["recommendedFields"] {
  // The script also reads CHANGED_FILES and AFFECTED_DESCRIPTORS: only the draft is changed.
  const {
    CHANGED_FILES: _changed,
    AFFECTED_DESCRIPTORS: _affected,
    ...rest
  } = env
  const result = spawn(
    process.execPath,
    [".github/scripts/check-recommended-fields.js", descriptorRel],
    root,
    rest
  )
  if (result.status !== 0)
    return { status: "fail", messages: lines(result.stderr) }
  const items = (
    JSON.parse(result.stdout) as {
      items: { type: string; format?: string; key?: string; message: string }[]
    }
  ).items
  return {
    status: items.length > 0 ? "suggestions" : "pass",
    messages: items.map(
      (item) =>
        `${item.type}: ${item.format ?? item.key ?? ""}: ${item.message}`
    ),
  }
}

function runnerCheck(
  root: string,
  testsRel: string,
  work: string,
  ctx: CheckContext
): DraftValidation["checks"]["tests"] {
  const shim = join(work, "chain-list-shim.mjs")
  writeFileSync(shim, chainListShim())
  const results = join(work, "results.json")
  const run = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(shim).href,
      ctx.runnerCli,
      join(root, testsRel),
      "-o",
      results,
      "-v",
    ],
    root,
    { ...process.env, CHAIN_INFO_FILE: ctx.chainList.file }
  )
  if (run.status !== 0 || !existsSync(results))
    return {
      status: "fail",
      passed: 0,
      cases: [],
      messages: [
        `the runner failed (exit ${run.status})`,
        ...lines(run.stderr),
      ],
    }
  const report = readJsonFile(results) as {
    cases: { description: string; status: string; message?: string }[]
  }
  const expected = (readJsonFile(join(root, testsRel)) as { tests: unknown[] })
    .tests.length
  const cases = report.cases.map((c) => ({
    description: c.description,
    status: c.status,
    ...(c.message ? { message: c.message } : {}),
  }))
  const passed = cases.filter((c) => c.status === "pass").length
  return {
    status: passed === expected && expected > 0 ? "pass" : "fail",
    passed,
    cases,
    messages: lines(run.stderr),
  }
}

/** Loaded with `node --import`: the runner's chain-list fetch answered from the draft's file. */
function chainListShim(): string {
  return [
    'import { readFileSync } from "node:fs"',
    `const url = ${JSON.stringify(CHAIN_LIST_URL)}`,
    "const file = process.env.CHAIN_INFO_FILE",
    "const real = globalThis.fetch",
    "globalThis.fetch = async (input, init) => {",
    '  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url',
    "  if (target === url)",
    '    return new Response(readFileSync(file), { status: 200, headers: { "content-type": "application/json" } })',
    "  return real(input, init)",
    "}",
    "",
  ].join("\n")
}

function run(command: string, args: readonly string[], cwd?: string): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...(cwd ? { cwd } : {}),
    maxBuffer: 64 * 1024 * 1024,
  })
}

function gitHead(dir: string): string {
  try {
    return run("git", ["-C", dir, "rev-parse", "HEAD"]).trim()
  } catch {
    return "unknown"
  }
}

/** The test runner at TEST_RUNNER.commit, cloned and built once. */
function ensureRunner(dir: string, log: (line: string) => void): string {
  const cli = join(dir, "dist", "cli.js")
  if (!existsSync(join(dir, ".git"))) {
    log(`cloning the test runner into ${dir}`)
    mkdirSync(dirname(dir), { recursive: true })
    run("git", ["clone", "--quiet", TEST_RUNNER.repo, dir])
  }
  if (gitHead(dir) !== TEST_RUNNER.commit) {
    run("git", ["-C", dir, "fetch", "--quiet", "origin", TEST_RUNNER.commit])
    run("git", ["-C", dir, "checkout", "--quiet", TEST_RUNNER.commit])
    rmSync(join(dir, "dist"), { recursive: true, force: true })
  }
  if (gitHead(dir) !== TEST_RUNNER.commit)
    throw new Error(
      `${dir} is not at the test runner's pinned commit ${TEST_RUNNER.commit}.`
    )
  if (!existsSync(cli)) {
    log(`building the test runner in ${dir}`)
    run("npm", ["ci", "--no-audit", "--no-fund"], dir)
    run("npm", ["run", "build"], dir)
  }
  return cli
}

/** A venv with the registry's pinned erc7730 and check-jsonschema, made once. */
function ensurePython(
  venv: string,
  registryDir: string,
  log: (line: string) => void
): string {
  const python = join(venv, "bin", "python")
  const ready = () =>
    existsSync(python) &&
    spawnSync(python, ["-I", "-c", "import erc7730"], { encoding: "utf8" })
      .status === 0
  if (ready()) return python
  log(`installing the registry's erc7730 into ${venv}`)
  run("python3", ["-m", "venv", venv])
  const requirements = [
    "-r",
    join(registryDir, ".github", "requirements.txt"),
    "-r",
    join(registryDir, ".github", "requirements-schema.txt"),
  ]
  const pip = spawnSync(
    python,
    ["-m", "pip", "install", "--quiet", ...requirements],
    { encoding: "utf8" }
  )
  if (pip.status !== 0)
    run("uv", [
      "pip",
      "install",
      "--quiet",
      "--python",
      python,
      ...requirements,
    ])
  if (!ready()) throw new Error(`Could not install erc7730 into ${venv}.`)
  return python
}
