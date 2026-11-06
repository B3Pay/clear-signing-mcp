"""Lint ERC-7730 descriptors the way the registry's CI does, offline.

The registry runs `erc7730 lint --require-verified` (the erc7730 package its
.github/requirements.txt pins), which fetches each deployment's ABI from
Sourcify. This runs the same linter with one change: the ABI of a deployment
is read from tracker data (tracker/data/abis/<chainId>/<address>.json), so a
draft is linted against the ABI it was drafted from. A deployment with no ABI
there fails loudly instead of being skipped.

Usage, with the Python that has erc7730 installed, from the root of a
registry checkout:

    python -I tracker/lint_descriptor.py --abis tracker/data/abis \
        --out result.json registry/<entity>/calldata-<Name>.json

It writes {"files", "outputs": [{"level", "title", "message", "file",
"line"}], "abis": [{"chainId", "address", "file"}], "missing": [...]} to
--out. Exit status: 0 when the linter reports no error, 1 when it does, 2
when a deployment has no local ABI.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--abis", required=True, type=Path, help="tracker/data/abis")
    parser.add_argument("--out", required=True, type=Path, help="where to write the result")
    parser.add_argument("descriptors", nargs="+", type=Path)
    args = parser.parse_args()

    from erc7730.common import client
    from erc7730.common.output import ListOutputAdder
    from erc7730.lint.v2.lint import lint_all
    from erc7730.model.abi import ABI
    from pydantic import TypeAdapter

    served: list[dict[str, Any]] = []
    missing: list[dict[str, Any]] = []

    def local_abis(chain_id: int, address: Any) -> list[ABI]:
        path = args.abis / str(chain_id) / f"{str(address).lower()}.json"
        entry = {"chainId": chain_id, "address": str(address), "file": str(path)}
        if not path.is_file():
            missing.append(entry)
            raise RuntimeError(f"no ABI for {chain_id}:{address} in tracker data ({path})")
        data = json.loads(path.read_text(encoding="utf-8"))
        served.append(entry)
        # JSON mode, as the client parses Sourcify's answer: the models are strict.
        return TypeAdapter(list[ABI]).validate_json(json.dumps(data["abi"]))

    client.get_contract_abis = local_abis

    out = ListOutputAdder()
    files = lint_all(list(args.descriptors), out, require_verified=True)
    result = {
        "files": files,
        "outputs": [
            {
                "level": output.level.name.lower(),
                "title": output.title,
                "message": output.message,
                "file": str(output.file) if output.file is not None else None,
                "line": output.line,
            }
            for output in out.outputs
            if output.level.name != "DEBUG"
        ],
        "abis": served,
        "missing": missing,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")

    if missing:
        for entry in missing:
            print(
                f"no ABI for {entry['chainId']}:{entry['address']} in tracker data: {entry['file']}",
                file=sys.stderr,
            )
        return 2
    if files == 0:
        print("no descriptor was linted", file=sys.stderr)
        return 1
    return 1 if out.has_errors else 0


if __name__ == "__main__":
    sys.exit(main())
