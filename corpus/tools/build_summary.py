#!/usr/bin/env python3
"""Build corpus/summary.json — a snapshot of corpus state across both kinds.

git sources: reflects an actual fetch (raw/ populated, manifest written).
html sources: reflects an actual --fetch (manifest row count + total bytes)
once run; before that, falls back to discovery-only counts.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
MANIFEST_DIR = CORPUS / "_meta" / "manifest"

git_results = json.loads((CORPUS / "_meta" / "git-fetch-results.json").read_text(encoding="utf-8"))
filter_report = json.loads((CORPUS / "_meta" / "filter-report.json").read_text(encoding="utf-8"))
discover_summary = json.loads((CORPUS / "_meta" / "discover-summary.json").read_text(encoding="utf-8"))

summary = {"git_sources": {}, "html_sources": {}}


def manifest_rows(sid: str) -> list[dict]:
    p = MANIFEST_DIR / f"{sid}.jsonl"
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


for sid, meta in git_results.items():
    fr = filter_report.get(sid, {})
    summary["git_sources"][sid] = {
        "status": "fetched",
        "repo": meta["repo"],
        "commit_sha": meta["commit_sha"],
        "fetched_at": meta["fetched_at"],
        "license": meta["license"],
        "license_tier": meta["license_tier"],
        "citable": meta["citable"],
        "files_before_filter": fr.get("before"),
        "files_after_filter": fr.get("after"),
    }

for sid, meta in discover_summary.items():
    rows = manifest_rows(sid)
    fetched = len(rows) > 0
    entry = {
        "status": "fetched" if fetched else "discovered_pending_fetch_approval",
        "discovered_count": meta["count"],
        "expected_count_range": meta["expected_range"],
        "count_outside_expected_range": meta["flag"],
    }
    if fetched:
        entry["files_fetched"] = len(rows)
        entry["total_bytes"] = sum(r["bytes"] for r in rows)
        entry["license"] = rows[0]["license"]
        entry["license_tier"] = rows[0]["license_tier"]
        entry["citable"] = rows[0]["citable"]
    summary["html_sources"][sid] = entry

summary["totals"] = {
    "git_sources": len(summary["git_sources"]),
    "git_files_before_filter": sum(v["files_before_filter"] for v in summary["git_sources"].values()),
    "git_files_after_filter": sum(v["files_after_filter"] for v in summary["git_sources"].values()),
    "html_sources": len(summary["html_sources"]),
    "html_urls_discovered": sum(v["discovered_count"] for v in summary["html_sources"].values()),
    "html_sources_fetched": sum(1 for v in summary["html_sources"].values() if v["status"] == "fetched"),
    "html_files_fetched": sum(v.get("files_fetched", 0) for v in summary["html_sources"].values()),
}

out_path = CORPUS / "summary.json"
out_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"wrote {out_path}")
print(json.dumps(summary["totals"], indent=2))
