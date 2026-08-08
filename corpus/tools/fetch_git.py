#!/usr/bin/env python3
"""Fetch all kind: git sources from corpus/sources.yaml via sparse checkout.

Usage:
    python corpus/tools/fetch_git.py [--only id1,id2] [--force]

For each git source: shallow (--depth 1), blob-less (--filter=blob:none),
sparse-checkout clone limited to the configured paths, pinned to whatever
commit HEAD lands on. Idempotent — a source with an existing corpus/raw/{id}
directory is skipped unless --force is passed.

Writes corpus/_meta/git-fetch-results.json: {id: {commit_sha, fetched_at,
repo, paths}} — consumed by build_manifest.py to stamp per-file manifest rows.

Also copies any top-level LICENSE* file found in the clone to
corpus/licenses/{id}-<original-filename>.
"""
import argparse
import datetime
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path


def _rmtree_force(path: Path):
    """shutil.rmtree that survives git's read-only pack files on Windows."""
    def onexc(func, p, exc_info):
        os.chmod(p, stat.S_IWRITE)
        func(p)
    shutil.rmtree(path, onexc=onexc)

import yaml

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
SOURCES_YAML = CORPUS / "sources.yaml"
RAW_DIR = CORPUS / "raw"
LICENSES_DIR = CORPUS / "licenses"
RESULTS_PATH = CORPUS / "_meta" / "git-fetch-results.json"


def load_sources():
    data = yaml.safe_load(SOURCES_YAML.read_text(encoding="utf-8"))
    return [s for s in data["sources"] if s["kind"] == "git"]


def run(cmd, cwd=None):
    print("  $", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True)


def fetch_one(source: dict, force: bool) -> dict:
    sid = source["id"]
    repo = source["repo"]
    paths = source["paths"]
    dest = RAW_DIR / sid

    if dest.exists() and not force:
        print(f"[{sid}] already present at {dest}, skipping clone (use --force to redo)")
    else:
        if dest.exists():
            _rmtree_force(dest)
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        print(f"[{sid}] cloning {repo} -> {dest}")
        run([
            "git", "clone",
            "--depth", "1",
            "--filter=blob:none",
            "--sparse",
            "--no-checkout",
            repo, str(dest),
        ])
        run(["git", "sparse-checkout", "set", *paths], cwd=dest)
        run(["git", "checkout"], cwd=dest)

    commit_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=dest, check=True,
        capture_output=True, text=True,
    ).stdout.strip()

    LICENSES_DIR.mkdir(parents=True, exist_ok=True)
    for lic in dest.glob("LICENSE*"):
        shutil.copy(lic, LICENSES_DIR / f"{sid}-{lic.name}")

    n_files = sum(1 for p in paths for _ in (dest / p).rglob("*") if _.is_file())
    print(f"[{sid}] pinned commit {commit_sha[:12]}, {n_files} files under configured paths")

    return {
        "id": sid,
        "repo": repo,
        "paths": paths,
        "commit_sha": commit_sha,
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "license": source.get("license"),
        "license_tier": source.get("license_tier"),
        "citable": source.get("citable"),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated list of source ids to fetch")
    ap.add_argument("--force", action="store_true", help="re-clone even if raw/{id} exists")
    args = ap.parse_args()

    sources = load_sources()
    if args.only:
        wanted = set(args.only.split(","))
        sources = [s for s in sources if s["id"] in wanted]
        missing = wanted - {s["id"] for s in sources}
        if missing:
            print(f"unknown source id(s): {missing}", file=sys.stderr)
            sys.exit(1)

    results = {}
    if RESULTS_PATH.exists():
        results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))

    failures = []
    for source in sources:
        try:
            results[source["id"]] = fetch_one(source, args.force)
        except subprocess.CalledProcessError as e:
            print(f"[{source['id']}] FAILED: {e}", file=sys.stderr)
            failures.append(source["id"])

    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nwrote {RESULTS_PATH} ({len(results)} sources total)")
    if failures:
        print(f"FAILED sources: {failures}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
