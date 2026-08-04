#!/usr/bin/env python3
"""Build corpus/summary.json — a snapshot of corpus state across both kinds.

git sources: reflects an actual fetch (raw/ populated, manifest written).
html sources: reflects discovery only unless corpus/raw/{id} has content
(i.e. --fetch has been run), which as of this snapshot it has not for any
web source — pending human review of the --discover output first.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"

git_results = json.loads((CORPUS / "_meta" / "git-fetch-results.json").read_text(encoding="utf-8"))
filter_report = json.loads((CORPUS / "_meta" / "filter-report.json").read_text(encoding="utf-8"))
discover_summary = json.loads((CORPUS / "_meta" / "discover-summary.json").read_text(encoding="utf-8"))

summary = {"git_sources": {}, "html_sources": {}}

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
    raw_dir = CORPUS / "raw" / sid
    fetched = raw_dir.exists() and any(raw_dir.iterdir())
    summary["html_sources"][sid] = {
        "status": "fetched" if fetched else "discovered_pending_fetch_approval",
        "discovered_count": meta["count"],
        "expected_count_range": meta["expected_range"],
        "count_outside_expected_range": meta["flag"],
    }

summary["totals"] = {
    "git_sources": len(summary["git_sources"]),
    "git_files_before_filter": sum(v["files_before_filter"] for v in summary["git_sources"].values()),
    "git_files_after_filter": sum(v["files_after_filter"] for v in summary["git_sources"].values()),
    "html_sources": len(summary["html_sources"]),
    "html_urls_discovered": sum(v["discovered_count"] for v in summary["html_sources"].values()),
    "html_sources_fetched": sum(1 for v in summary["html_sources"].values() if v["status"] == "fetched"),
}

out_path = CORPUS / "summary.json"
out_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"wrote {out_path}")
print(json.dumps(summary["totals"], indent=2))
