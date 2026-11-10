#!/usr/bin/env bash
# Runs the ERC-7730 registry's own pull-request checks on submissions/registry/,
# laid over a scratch clone of the registry: the jobs of its registry-checks.yml,
# descriptor-lint.yml and descriptor-tests.yml, with the tools the registry
# pins. It writes into the clone, so give it a clone made for this.
#
#   submissions/tools/check.sh --registry <scratch clone> --python <python> \
#     --runner <built Sourcify test runner> [--rust <cs-test binary>] \
#     [--chains <chains_mini.json>] [--offline]
#
#   --python   a Python with the registry's .github/requirements*.txt installed
#   --runner   sourcifyeth/clear-signing-test-runner at the registry's pinned
#              commit, built (npm ci && npm run build)
#   --rust     llbartekll/clear-signing's cs-test at the registry's pinned
#              commit; without it the Rust runner is skipped and the result
#              says so
#   --chains   serve the runner's chainid.network chain list from this file
#              (for a machine that cannot reach chainid.network)
#   --offline  lint with the ABIs in tracker/data/abis instead of fetching
#              them from Sourcify; the registry's CI fetches them, and fails a
#              deployment Sourcify has not verified, so only an online run
#              answers that
#
# The registry clone needs its npm dependencies (npm ci) for its scripts.
# Exit status: 0 when every check that ran passed.
set -uo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
registry="" python="" runner="" rust="" chains="" offline=0
while [ $# -gt 0 ]; do
  case "$1" in
    --registry) registry=$(cd "$2" && pwd); shift 2 ;;
    --python) python="$2"; shift 2 ;;
    --runner) runner=$(cd "$2" && pwd); shift 2 ;;
    --rust) rust="$2"; shift 2 ;;
    --chains) chains=$(cd "$(dirname "$2")" && pwd)/$(basename "$2"); shift 2 ;;
    --offline) offline=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[ -n "$registry" ] && [ -n "$python" ] && [ -n "$runner" ] || {
  echo "usage: check.sh --registry <clone> --python <python> --runner <dir> [--rust <cs-test>] [--chains <file>] [--offline]" >&2
  exit 2
}
[ -d "$registry/.github/scripts" ] || { echo "$registry is not a registry clone" >&2; exit 2; }

out=$(mktemp -d)
summary="$out/summary.md"
failed=0
pass() { echo "- ✅ $1" | tee -a "$summary"; }
fail() { echo "- ❌ $1" | tee -a "$summary"; failed=1; }
note() { echo "- ⚠️ $1" | tee -a "$summary"; }

base=$(cat "$repo/submissions/REGISTRY_BASE")
head=$(git -C "$registry" rev-parse HEAD)
echo "## Registry checks on submissions/registry (registry ${head:0:7}, base ${base:0:7})" | tee "$summary"

# A file the registry already has is submitted as a whole copy, made from the
# registry at REGISTRY_BASE. If the registry changed it since, laying the copy
# over would revert that change: rebase the copy first.
cd "$repo/submissions/registry"
mapfile -t files < <(find . -type f -name '*.json' | sed 's#^\./##' | sort)
cd "$registry"
for f in "${files[@]}"; do
  if git cat-file -e "$base:registry/$f" 2>/dev/null; then
    if [ "$(git rev-parse "$base:registry/$f")" != "$(git rev-parse "HEAD:registry/$f" 2>/dev/null)" ]; then
      fail "registry/$f changed upstream since ${base:0:7}: rebase the submitted copy"
    fi
  fi
done

cp -R "$repo/submissions/registry/." "$registry/registry/"
descriptors=() tests=()
for f in "${files[@]}"; do
  case "$f" in
    */testsv2/*.tests.json) tests+=("registry/$f") ;;
    */calldata-*.json | */eip712-*.json) descriptors+=("registry/$f") ;;
    *) fail "registry/$f: not a descriptor or a testsv2 file" ;;
  esac
done
echo "${#descriptors[@]} descriptor(s), ${#tests[@]} test file(s)"

# JSON files match their schema.
if PATH="$(dirname "$python"):$PATH" .github/scripts/validate-json-schemas.sh "${descriptors[@]}" "${tests[@]}" > "$out/schemas.log" 2>&1; then
  pass "JSON files match their schema"
else
  fail "JSON files match their schema: $(grep -m3 '::error' "$out/schemas.log" | tr '\n' ' ')"
fi

# No index entry is overwritten.
if node tools/scripts/generate-index.js --validate > "$out/index.log" 2>&1; then
  pass "No index entry is overwritten"
else
  fail "No index entry is overwritten: $(tail -5 "$out/index.log" | tr '\n' ' ')"
fi

# File names follow the registry layout.
bad=$(find registry -mindepth 2 \( -type d \( -name tests -o -name testsv2 -o -name sigs \) -prune \) -o \
  \( -type f ! -name 'calldata-*.json' ! -name 'eip712-*.json' ! -name 'common-*.json' -print \))
if [ -z "$bad" ]; then pass "File names follow the registry layout"; else fail "File names: $bad"; fi

# Attested descriptors are unchanged.
attested=""
for d in "${descriptors[@]}"; do
  for sig in "$(dirname "$d")"/sigs/"$(basename "$d" .json)".eip155-*.json; do
    [ -e "$sig" ] && attested="$attested $sig"
  done
done
if [ -z "$attested" ]; then pass "No attested descriptor is changed"; else fail "Attested descriptors changed:$attested"; fi

# Descriptors pass the ERC-7730 linter.
if [ "$offline" -eq 1 ]; then
  for d in "${descriptors[@]}"; do
    key=$(echo "$d" | tr '/' '_')
    "$python" -I "$repo/tracker/lint_descriptor.py" --abis "$repo/tracker/data/abis" --out "$out/lint-$key.json" "$d" > "$out/lint-$key.log" 2>&1
  done
  # The tracker has ABIs only for the contracts it tracks. A deployment it has
  # no ABI for is not linted here; that is a failure unless the registry
  # already lists the deployment (its CI linted it then, against Sourcify).
  verdict=$(node -e '
    const fs = require("fs"), path = require("path")
    const [outDir, indexFile] = process.argv.slice(1)
    const index = JSON.parse(fs.readFileSync(indexFile, "utf8"))
    const listed = new Set(Object.keys(index).map((k) => k.toLowerCase()))
    const errors = [], skipped = []
    for (const f of fs.readdirSync(outDir).filter((f) => /^lint-.*\.json$/.test(f))) {
      const r = JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8"))
      for (const m of r.missing) {
        const key = `eip155:${m.chainId}:${m.address}`.toLowerCase()
        if (listed.has(key)) skipped.push(key); else errors.push(`no ABI for ${key}`)
      }
      for (const o of r.outputs)
        if (o.level === "error" && o.title !== "Could not fetch ABI") errors.push(`${o.title}: ${o.message}`)
    }
    console.log(JSON.stringify({ errors, skipped }))
  ' "$out" "$registry/index.calldata.json")
  n_err=$(node -e 'console.log(JSON.parse(process.argv[1]).errors.length)' "$verdict")
  skipped=$(node -e 'console.log(JSON.parse(process.argv[1]).skipped.join(", "))' "$verdict")
  if [ "$n_err" -eq 0 ]; then
    pass "Descriptors pass the ERC-7730 linter (offline: ABIs from tracker data, Sourcify verification not checked)"
  else
    fail "Descriptors pass the ERC-7730 linter (offline): $(node -e 'console.log(JSON.parse(process.argv[1]).errors.slice(0,5).join("; "))' "$verdict")"
  fi
  [ -n "$skipped" ] && note "Not linted offline, already in the registry: $skipped"
else
  # As the registry's CI runs it. A deployment listed in submissions/UNVERIFIED
  # waits for its owner to verify it on Sourcify: its "not verified" error, and
  # no other error, is let through (lint-verdict.mjs).
  "$(dirname "$python")/erc7730" lint --require-verified "${descriptors[@]}" --gha > "$out/lint.log" 2>&1
  status=$?
  if verdict=$(node "$repo/submissions/tools/lint-verdict.mjs" "$out/lint.log" "$status" 2> "$out/lint-verdict.log"); then
    field() { node -e 'const x = JSON.parse(process.argv[1])[process.argv[2]]; console.log(Array.isArray(x) ? x.join("; ") : String(x))' "$verdict" "$1"; }
    if [ "$(field pass)" = true ]; then
      pass "Descriptors pass the ERC-7730 linter (--require-verified, ABIs from Sourcify)"
    else
      fail "Descriptors pass the ERC-7730 linter: $(field errors | tr '\n' ' ' | cut -c1-1000)"
    fi
    waiting=$(field waiting) verified=$(field verified)
    [ -n "$waiting" ] && note "Not verified on Sourcify, listed in submissions/UNVERIFIED as waiting for its owner: $waiting"
    [ -n "$verified" ] && note "Verified on Sourcify since it was listed: remove it from submissions/UNVERIFIED: $verified"
  else
    fail "Descriptors pass the ERC-7730 linter: lint-verdict.mjs failed: $(tail -3 "$out/lint-verdict.log" | tr '\n' ' ')"
  fi
  if grep -qi "could not fetch abi" "$out/lint.log"; then
    fail "The linter could not fetch an ABI: verify the contract on Sourcify"
  fi
  # Shown below without the leading "::", which would make each line an
  # annotation on the pull request.
  sed -E 's/^::(error|warning|notice) /\1 /; s/%0A/\n    /g' "$out/lint.log" > "$out/lint-shown.log"
fi
# On GitHub Actions, the linter's report and the registry's suggestions are
# shown in full, for the pull request text.
show() { [ -n "${GITHUB_ACTIONS:-}" ] && [ -f "$2" ] && { echo "::group::$1"; cat "$2"; echo "::endgroup::"; }; }
show "erc7730 lint output" "$out/lint-shown.log"

# Every function has a test case.
if node .github/scripts/check-selector-coverage.js "${descriptors[@]}" > "$out/coverage.log" 2>&1; then
  pass "Every function has a test case"
else
  fail "Every function has a test case: $(grep -m3 '::error' "$out/coverage.log" | tr '\n' ' ')"
fi

# Every descriptor has a test file.
for d in "${descriptors[@]}"; do
  t="$(dirname "$d")/testsv2/$(basename "$d" .json).tests.json"
  [ -f "$t" ] || fail "$d has no test file $t"
done

# The test runners render what each test expects.
shim="$out/chain-list-shim.mjs"
cat > "$shim" <<'EOF'
import { readFileSync } from "node:fs"
const url = "https://chainid.network/chains_mini.json"
const real = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const target = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (target === url && process.env.CHAIN_INFO_FILE)
    return new Response(readFileSync(process.env.CHAIN_INFO_FILE), { status: 200, headers: { "content-type": "application/json" } })
  return real(input, init)
}
EOF
count_cases() {
  # prints "<passed> <total>" for a runner results file
  node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const c=r.cases||[];console.log(c.filter(x=>x.status==="pass").length, c.length)' "$1"
}
for impl in sourcify rust; do
  if [ "$impl" = rust ] && [ -z "$rust" ]; then
    note "Rust runner not run here (no --rust): the registry's CI runs it"
    continue
  fi
  all=0 ok=0 crashed=""
  for t in "${tests[@]}"; do
    key=$(echo "$t" | tr '/' '_')
    res="$out/$impl-$key.results.json"
    if [ "$impl" = sourcify ]; then
      CHAIN_INFO_FILE="$chains" node --import "file://$shim" "$runner/dist/cli.js" "$registry/$t" --output "$res" > "$out/$impl-$key.log" 2>&1 || crashed="$crashed $t"
    else
      "$rust" run "$registry/$t" --registry "$registry/registry" --output "$res" > "$out/$impl-$key.log" 2>&1 || crashed="$crashed $t"
    fi
    if [ -f "$res" ]; then
      read -r p n < <(count_cases "$res")
      ok=$((ok + p)); all=$((all + n))
      if [ "$p" != "$n" ]; then
        node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));for(const c of r.cases)if(c.status!=="pass")console.log("   "+c.description+": "+(c.message||c.status))' "$res" | tee -a "$summary"
      fi
    fi
  done
  if [ -z "$crashed" ] && [ "$ok" -eq "$all" ] && [ "$all" -gt 0 ]; then
    pass "$impl runner: $ok of $all test cases render as expected"
  else
    fail "$impl runner: $ok of $all test cases render as expected${crashed:+; crashed on$crashed}"
  fi
done

# Suggestions, never a failure.
CHANGED_FILES="${descriptors[*]}" node .github/scripts/check-recommended-fields.js > "$out/recommendations.json" 2>/dev/null &&
  n=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).items.length)' "$out/recommendations.json") &&
  note "Registry suggestions (not failures): $n"
show "Registry suggestions" "$out/recommendations.json"

echo "Logs: $out"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && cat "$summary" >> "$GITHUB_STEP_SUMMARY"
exit "$failed"
