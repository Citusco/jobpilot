#!/usr/bin/env python3
"""Fetch (or just discover) all kind: html sources from corpus/sources.yaml.

Usage:
    python corpus/tools/fetch_html.py --discover [--only id1,id2]
    python corpus/tools/fetch_html.py --fetch [--only id1,id2]

--discover:
    BFS (or sitemap-then-BFS) crawl restricted to each source's
    allow_path_prefixes / max_depth, following the SAME polite-crawling rules
    as a real fetch (robots.txt, global 1 req/s, retries). Writes the
    discovered URL list to corpus/_meta/discover/{id}.json and prints a
    summary (count vs expected_count_range). Also caches every page fetched
    during discovery under corpus/_meta/discover-cache/{id}/ so a subsequent
    --fetch does not re-download it.
    Does NOT write anything to corpus/raw/ — discovery output is for human
    review before a real fetch is authorized.

--fetch:
    Reads the URL list previously written by --discover (must exist — fetch
    refuses to run undiscovered) and saves each page's raw response bytes,
    verbatim, to corpus/raw/{id}/<url-derived-path>. Reuses the discover
    cache when present. Resumable: a URL whose destination file already
    exists is skipped. Retries 429/5xx up to 3x with exponential backoff.
    Writes corpus/_meta/manifest/{id}.jsonl.

Global crawl politeness (applies in both modes):
    - one HTTP request in flight at a time, >=1s between requests, GLOBAL
      across all hosts touched by this process (not per-host)
    - descriptive User-Agent (see USER_AGENT below)
    - robots.txt fetched and honored per host, cached in-process
"""
import argparse
import datetime
import hashlib
import json
import re
import sys
import time
import urllib.robotparser
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
import yaml
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
SOURCES_YAML = CORPUS / "sources.yaml"
RAW_DIR = CORPUS / "raw"
META_DIR = CORPUS / "_meta"
DISCOVER_DIR = META_DIR / "discover"
DISCOVER_CACHE_DIR = META_DIR / "discover-cache"
MANIFEST_DIR = META_DIR / "manifest"

USER_AGENT = (
    "JobPilotInterviewCorpusBot/0.1 "
    "(+educational research corpus build for an interview-prep tool; "
    "contact: nxchen1005@gmail.com; respects robots.txt; 1 req/s global)"
)

MIN_INTERVAL = 1.0  # seconds, global across all hosts
_last_request_ts = [0.0]
_robots_cache = {}


def _throttle():
    elapsed = time.monotonic() - _last_request_ts[0]
    if elapsed < MIN_INTERVAL:
        time.sleep(MIN_INTERVAL - elapsed)
    _last_request_ts[0] = time.monotonic()


def _robots_allows(url: str) -> bool:
    parsed = urlparse(url)
    host = f"{parsed.scheme}://{parsed.netloc}"
    if host not in _robots_cache:
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(urljoin(host, "/robots.txt"))
        try:
            _throttle()
            resp = requests.get(urljoin(host, "/robots.txt"), headers={"User-Agent": USER_AGENT}, timeout=10)
            if resp.status_code == 200:
                rp.parse(resp.text.splitlines())
            else:
                rp.parse([])  # no robots.txt -> allow all
        except requests.RequestException:
            rp.parse([])
        _robots_cache[host] = rp
    return _robots_cache[host].can_fetch(USER_AGENT, url)


def fetch(url: str, max_retries=3):
    """GET url respecting global rate limit + robots.txt. Returns requests.Response or None."""
    if not _robots_allows(url):
        print(f"    robots.txt disallows {url}, skipping")
        return None
    backoff = 2.0
    for attempt in range(1, max_retries + 1):
        _throttle()
        try:
            resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=20)
        except requests.RequestException as e:
            print(f"    attempt {attempt}/{max_retries} network error on {url}: {e}")
            if attempt == max_retries:
                return None
            time.sleep(backoff)
            backoff *= 2
            continue
        if resp.status_code == 429 or resp.status_code >= 500:
            print(f"    attempt {attempt}/{max_retries} got {resp.status_code} on {url}")
            if attempt == max_retries:
                return None
            time.sleep(backoff)
            backoff *= 2
            continue
        return resp
    return None


def _cache_path(source_id: str, url: str) -> Path:
    h = hashlib.sha256(url.encode()).hexdigest()[:24]
    return DISCOVER_CACHE_DIR / source_id / f"{h}.html"


def fetch_cached(source_id: str, url: str):
    cp = _cache_path(source_id, url)
    if cp.exists():
        return cp.read_bytes(), 200
    resp = fetch(url)
    if resp is None:
        return None, None
    cp.parent.mkdir(parents=True, exist_ok=True)
    cp.write_bytes(resp.content)
    return resp.content, resp.status_code


def in_scope(url: str, allowed_netlocs: set[str], allow_prefixes: list[str]) -> bool:
    """allow_prefixes entries starting with 'http' are matched as full-URL
    prefixes (host-specific scoping, e.g. restrict one host to one subpath
    while another allowed host is unrestricted); bare-path entries (e.g.
    '/patterns/') are matched against the URL's path on ANY allowed host."""
    p = urlparse(url)
    if p.netloc and p.netloc not in allowed_netlocs:
        return False
    if p.scheme not in ("http", "https", ""):
        return False
    if not allow_prefixes:
        return True
    for pref in allow_prefixes:
        if pref.startswith("http"):
            if url.startswith(pref):
                return True
        elif p.path.startswith(pref):
            return True
    return False


MD_LINK_RE = re.compile(r"\]\(([^)\s]+)\)")


def extract_links(content_bytes: bytes, base_url: str) -> list[str]:
    """Dispatches on the URL's extension: markdown link syntax for .md/.mdx
    (some doc platforms, e.g. AWS docs, serve a clean text/markdown mirror of
    every HTML page at the same path with a .md extension — no JS-rendered
    nav to fight with), HTML <a href> otherwise."""
    if base_url.split("?")[0].rstrip("/").lower().endswith((".md", ".mdx")):
        out = []
        try:
            text = content_bytes.decode("utf-8", errors="replace")
        except Exception:
            return []
        for m in MD_LINK_RE.finditer(text):
            href = m.group(1).split("#")[0].strip()
            if not href or href.startswith("mailto:"):
                continue
            out.append(urljoin(base_url, href))
        return out
    try:
        soup = BeautifulSoup(content_bytes, "html.parser")
    except Exception:
        return []
    out = []
    for a in soup.find_all("a", href=True):
        href = a["href"].split("#")[0].strip()
        if not href or href.startswith("mailto:") or href.startswith("javascript:"):
            continue
        out.append(urljoin(base_url, href))
    return out


def try_sitemap(base_url: str) -> list[str]:
    parsed = urlparse(base_url)
    sitemap_url = f"{parsed.scheme}://{parsed.netloc}/sitemap.xml"
    resp = fetch(sitemap_url)
    if resp is None or resp.status_code != 200:
        return []
    urls = re.findall(r"<loc>(.*?)</loc>", resp.text)
    return urls


def discover_one(source: dict) -> list[str]:
    sid = source["id"]
    seeds = source["seed_urls"]
    max_depth = source.get("max_depth", 1)
    allow_prefixes = source.get("allow_path_prefixes", [])
    strategy = source.get("discovery_strategy", "bfs")
    require_ext = tuple(source.get("require_ext", []))
    prefer_md_mirror = source.get("prefer_md_mirror", False)
    allowed_netlocs = {urlparse(s).netloc for s in seeds}

    found: dict[str, int] = {}  # url -> depth discovered at
    queue: list[tuple[str, int]] = [(s, 0) for s in seeds]

    if strategy == "sitemap-then-bfs":
        print(f"[{sid}] trying sitemap.xml on seed hosts first")
        for s in seeds:
            urls = try_sitemap(s)
            in_scope_urls = [u for u in urls if in_scope(u, allowed_netlocs, allow_prefixes)]
            print(f"[{sid}]   {urlparse(s).netloc}: {len(urls)} urls in sitemap, {len(in_scope_urls)} in scope")
            for u in in_scope_urls:
                found.setdefault(u, 0)

    seen = set(u for s, _ in queue for u in [s])
    while queue:
        url, depth = queue.pop(0)
        if url in found and depth >= found[url]:
            continue
        found[url] = min(found.get(url, depth), depth)
        if depth >= max_depth:
            continue
        print(f"[{sid}] fetching (depth {depth}): {url}")
        content, status = fetch_cached(sid, url)
        if content is None:
            print(f"    -> failed, skipping")
            continue
        for link in extract_links(content, url):
            if prefer_md_mirror and link.split("?")[0].lower().endswith(".html"):
                # Some doc platforms (AWS docs) mix .html and .md hrefs within the
                # same markdown source even though every page also has a clean .md
                # mirror at the identical path — and only the .md mirror has real,
                # crawlable links (the .html rendering's nav is JS-injected). Prefer
                # the mirror so link-following doesn't dead-end at an .html page.
                link = re.sub(r"\.html$", ".md", link, flags=re.IGNORECASE)
            if link in seen:
                continue
            if not in_scope(link, allowed_netlocs, allow_prefixes):
                continue
            seen.add(link)
            queue.append((link, depth + 1))

    urls = sorted(found.keys())
    if require_ext:
        urls = [u for u in urls if u.split("?")[0].lower().endswith(require_ext)]
    content_prefixes = source.get("content_path_prefixes")
    if content_prefixes:
        # allow_path_prefixes governs what's crawled for link discovery (may
        # legitimately include pure index/nav pages, e.g. fowler's /tags/*
        # pages, needed to reach older entries not linked from the main
        # hubs); content_path_prefixes narrows the returned set to what
        # should actually become corpus content.
        before = len(urls)
        urls = [u for u in urls if any(urlparse(u).path.startswith(p) for p in content_prefixes)]
        print(f"[{sid}] content_path_prefixes narrowed {before} -> {len(urls)}")
    return urls


def cmd_discover(sources, only):
    DISCOVER_DIR.mkdir(parents=True, exist_ok=True)
    summary = {}
    for source in sources:
        sid = source["id"]
        if only and sid not in only:
            continue
        urls = discover_one(source)
        out_path = DISCOVER_DIR / f"{sid}.json"
        out_path.write_text(json.dumps(urls, indent=2, ensure_ascii=False), encoding="utf-8")
        lo, hi = source.get("expected_count_range", [None, None]) or [None, None]
        flag = ""
        if lo is not None and len(urls) < lo:
            flag = f"  <-- BELOW expected range [{lo}, {hi}], selector likely wrong"
        elif hi is not None and len(urls) > hi:
            flag = f"  <-- ABOVE expected range [{lo}, {hi}], scope likely too broad"
        summary[sid] = {"count": len(urls), "expected_range": [lo, hi], "flag": bool(flag)}
        print(f"[{sid}] discovered {len(urls)} URLs -> {out_path}{flag}")
    (META_DIR / "discover-summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def url_to_relpath(url: str) -> str:
    p = urlparse(url)
    path = p.path
    if path.endswith("/") or path == "":
        path += "index.html"
    if not re.search(r"\.\w+$", path):
        path += ".html"
    return (p.netloc + path).lstrip("/")


def cmd_fetch(sources, only):
    for source in sources:
        sid = source["id"]
        if only and sid not in only:
            continue
        discover_path = DISCOVER_DIR / f"{sid}.json"
        if not discover_path.exists():
            print(f"[{sid}] no discover output at {discover_path} — run --discover first, refusing to fetch blind")
            continue
        urls = json.loads(discover_path.read_text(encoding="utf-8"))
        dest_root = RAW_DIR / sid
        dest_root.mkdir(parents=True, exist_ok=True)
        manifest_rows = []
        for url in urls:
            rel = url_to_relpath(url)
            dest = dest_root / rel
            if dest.exists():
                print(f"[{sid}] already have {rel}, skipping")
            else:
                content, status = fetch_cached(sid, url)
                if content is None:
                    print(f"[{sid}] FAILED (after retries): {url}")
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(content)
                print(f"[{sid}] saved {url} -> {dest.relative_to(RAW_DIR)}")
            raw_bytes = dest.read_bytes()
            manifest_rows.append({
                "source_url": url,
                "raw_url": url,
                "sha256": hashlib.sha256(raw_bytes).hexdigest(),
                "bytes": len(raw_bytes),
                "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                "commit_sha": None,
                "license": source.get("license"),
                "license_tier": source.get("license_tier"),
                "citable": source.get("citable"),
                "local_path": str(dest.relative_to(CORPUS)),
            })
        MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
        with open(MANIFEST_DIR / f"{sid}.jsonl", "w", encoding="utf-8") as f:
            for row in manifest_rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"[{sid}] wrote manifest with {len(manifest_rows)} rows")


def main():
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--discover", action="store_true")
    mode.add_argument("--fetch", action="store_true")
    ap.add_argument("--only", help="comma-separated source ids")
    args = ap.parse_args()

    data = yaml.safe_load(SOURCES_YAML.read_text(encoding="utf-8"))
    sources = [s for s in data["sources"] if s["kind"] == "html"]
    only = set(args.only.split(",")) if args.only else None

    if args.discover:
        cmd_discover(sources, only)
    else:
        cmd_fetch(sources, only)


if __name__ == "__main__":
    main()
