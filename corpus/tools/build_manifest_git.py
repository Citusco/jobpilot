#!/usr/bin/env python3
"""Build corpus/_meta/manifest/{id}.jsonl for every kind: git source.

Run after fetch_git.py and filter_md.py — walks the (already filtered to
.md/.mdx) corpus/raw/{id} tree and, for each remaining file, records:
    source_url, raw_url, sha256, bytes, fetched_at, commit_sha, license, citable

source_url points at the GitHub blob view pinned to commit_sha; raw_url at
raw.githubusercontent.com, also pinned — both permalinks, not branch-relative.
"""
import hashlib
import json
import re

from corpus_paths import CORPUS, ROOT, raw_root, resolve_local_path  # noqa: F401
RAW_DIR = raw_root()
RESULTS_PATH = CORPUS / "_meta" / "git-fetch-results.json"
MANIFEST_DIR = CORPUS / "_meta" / "manifest"


def owner_repo(repo_url: str) -> str:
    m = re.search(r"github\.com/([^/]+/[^/]+?)(?:\.git)?$", repo_url)
    if not m:
        raise ValueError(f"cannot parse owner/repo from {repo_url}")
    return m.group(1)


def build_one(source_id: str, meta: dict) -> list[dict]:
    src_dir = RAW_DIR / source_id
    org_repo = owner_repo(meta["repo"])
    commit = meta["commit_sha"]
    rows = []
    for p in sorted(src_dir.rglob("*")):
        if not p.is_file() or ".git" in p.parts:
            continue
        rel = p.relative_to(src_dir).as_posix()
        content = p.read_bytes()
        rows.append({
            "source_url": f"https://github.com/{org_repo}/blob/{commit}/{rel}",
            "raw_url": f"https://raw.githubusercontent.com/{org_repo}/{commit}/{rel}",
            "sha256": hashlib.sha256(content).hexdigest(),
            "bytes": len(content),
            "fetched_at": meta["fetched_at"],
            "commit_sha": commit,
            "license": meta["license"],
            "license_tier": meta.get("license_tier"),
            "citable": meta.get("citable"),
            "local_path": "raw/" + source_id + "/" + str(rel).replace(chr(92), "/"),
        })
    return rows


def main():
    results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    for source_id, meta in results.items():
        rows = build_one(source_id, meta)
        out_path = MANIFEST_DIR / f"{source_id}.jsonl"
        with open(out_path, "w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"[{source_id}] wrote {len(rows)} rows -> {out_path}")


if __name__ == "__main__":
    main()
