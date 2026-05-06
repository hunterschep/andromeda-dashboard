#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

DEFAULT_MAX_LOC = 300
TRACKED_SUFFIXES = {".css", ".md", ".py", ".toml", ".ts", ".tsx"}
EXCLUDED_DIRS = {
    ".git",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "dist",
    "node_modules",
    "__pycache__",
}
EXCLUDED_FILES = {"package-lock.json"}


def maintained_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if any(part in EXCLUDED_DIRS for part in relative.parts):
            continue
        if relative.parts[0] == "tests":
            continue
        if path.name in EXCLUDED_FILES or path.name.endswith(".test.tsx"):
            continue
        if path.suffix in TRACKED_SUFFIXES:
            files.append(path)
    return sorted(files)


def line_count(path: Path) -> int:
    with path.open("r", encoding="utf-8") as handle:
        return sum(1 for _line in handle)


def violations(root: Path, max_loc: int) -> list[tuple[int, Path]]:
    oversized: list[tuple[int, Path]] = []
    for path in maintained_files(root):
        loc = line_count(path)
        if loc > max_loc:
            oversized.append((loc, path.relative_to(root)))
    return sorted(oversized, reverse=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check maintained source files by LOC.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    parser.add_argument("--max-loc", type=int, default=DEFAULT_MAX_LOC)
    args = parser.parse_args()

    root = args.root.resolve()
    oversized = violations(root, args.max_loc)
    if not oversized:
        print(f"LOC guard passed: all maintained files are <= {args.max_loc} LOC.")
        return 0
    print(f"LOC guard failed: maintained files over {args.max_loc} LOC:")
    for loc, path in oversized:
        print(f"{loc:5d} {path}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
