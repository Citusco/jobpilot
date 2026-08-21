#!/usr/bin/env python3
"""Prune corpus/raw/{id} (git sources) down to .md/.mdx files only.

Rationale (task C in the corpus-build brief): non-.md/.mdx files in these
doc repos are mostly compilable-sample noise (e.g. aspnetcore/'s .cs/.cshtml
projects referenced via Microsoft's `:::code source=...:::` include syntax),
not prose. They pollute later structure statistics and would bloat the
section-count estimate for no retrieval value.

Only touches raw/{id} for sources listed in corpus/_meta/git-fetch-results.json
(i.e. git-kind sources already fetched). Leaves .git/ alone. Removes any
directory left empty after pruning.

Writes corpus/_meta/filter-report.json: {id: {before, after, kept_ext_counts}}
"""
import json
from collections import Counter
from pathlib import Path

from corpus_paths import CORPUS, ROOT, raw_root, resolve_local_path  # noqa: F401
RAW_DIR = raw_root()
RESULTS_PATH = CORPUS / "_meta" / "git-fetch-results.json"
REPORT_PATH = CORPUS / "_meta" / "filter-report.json"

KEEP_EXTS = {".md", ".mdx"}


def iter_files(root: Path):
    for p in root.rglob("*"):
        if p.is_file() and ".git" not in p.parts:
            yield p


def prune_empty_dirs(root: Path):
    changed = True
    while changed:
        changed = False
        for d in sorted(root.rglob("*"), key=lambda p: -len(p.parts)):
            if d.is_dir() and d.name != ".git" and not any(d.iterdir()):
                d.rmdir()
                changed = True


def filter_source(source_id: str) -> dict:
    src_dir = RAW_DIR / source_id
    before_files = list(iter_files(src_dir))
    before = len(before_files)
    before_ext_counts = Counter(p.suffix.lower() for p in before_files)

    removed = 0
    for p in before_files:
        if p.suffix.lower() not in KEEP_EXTS:
            p.unlink()
            removed += 1

    prune_empty_dirs(src_dir)

    after_files = list(iter_files(src_dir))
    after = len(after_files)
    kept_ext_counts = Counter(p.suffix.lower() for p in after_files)

    print(f"[{source_id}] {before} -> {after} files (removed {removed})")
    return {
        "before": before,
        "after": after,
        "before_ext_counts": dict(before_ext_counts.most_common(15)),
        "kept_ext_counts": dict(kept_ext_counts),
    }


def main():
    results = json.loads(RESULTS_PATH.read_text(encoding="utf-8"))
    report = {}
    for source_id in results:
        report[source_id] = filter_source(source_id)

    totals = {
        "before": sum(v["before"] for v in report.values()),
        "after": sum(v["after"] for v in report.values()),
    }
    report["_totals"] = totals
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\nTOTAL: {totals['before']} -> {totals['after']} files")
    print(f"wrote {REPORT_PATH}")


if __name__ == "__main__":
    main()
