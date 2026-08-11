#!/usr/bin/env python3
"""Chunk the azure corpus per docs/DECISIONS.md's 2026-08-10 entries and
specs/006-corpus-structure-rebuild (structure-first, size-bounded hierarchical
chunking). Every section of every admitted document is stored — nothing is
filtered on the basis of what its heading is called (the abolished `kind`
subsystem discarded 69% of body text and then reported it missing).

Reads corpus/raw/azure/, writes two outputs, all pure text processing with
zero database access:
    corpus/_meta/chunks/azure.jsonl       one row per DocChunk candidate
    corpus/_meta/candidates/azure.jsonl   one row per Concept candidate (49)

There is no unmapped-headings report any more: nothing is unmapped.
"""
import argparse
import datetime
import hashlib
import json
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "corpus"
RAW_AZURE = CORPUS / "raw" / "azure"
MANIFEST_PATH = CORPUS / "_meta" / "manifest" / "azure.jsonl"
CHUNKS_OUT = CORPUS / "_meta" / "chunks" / "azure.jsonl"
CANDIDATES_OUT = CORPUS / "_meta" / "candidates" / "azure.jsonl"

SOURCE_ID = "azure"

# --- concept-eligible file scope --------------------------------------------

EXCLUDED_FILES = {
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "docs/changelog.md",
    "docs/patterns/index.md",
    "docs/guide/index.md",
    "docs/guide/architecture-styles/index.md",
    "docs/guide/choose-azure-container-service.md",
    "docs/guide/container-service-general-considerations.md",
}


def is_concept_eligible(rel_path: str) -> bool:
    if rel_path in EXCLUDED_FILES:
        return False
    return rel_path.startswith("docs/patterns/") or rel_path.startswith(
        "docs/guide/architecture-styles/"
    )


# --- concept_id normalization ------------------------------------------------

_SUFFIX_RE = re.compile(r"-(content|pattern)$")


def derive_concept_id(filename_stem: str) -> str:
    return _SUFFIX_RE.sub("", filename_stem)


# --- frontmatter -------------------------------------------------------------

_FRONTMATTER_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)


def parse_frontmatter(text: str) -> dict:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def strip_frontmatter(text: str) -> str:
    m = _FRONTMATTER_RE.match(text)
    return text[m.end():] if m else text


_TITLE_SUFFIX_RE = re.compile(r"\s+(Pattern|Architecture Style)$", re.I)


def derive_display_name(concept_id: str, frontmatter: dict) -> str:
    title = frontmatter.get("title")
    if isinstance(title, str) and title.strip():
        return _TITLE_SUFFIX_RE.sub("", title.strip())
    return " ".join(word.capitalize() for word in concept_id.split("-"))


_H1_RE = re.compile(r"^#[ \t]+(.+?)[ \t]*$", re.MULTILINE)


def derive_raw_title(preamble_text: str, frontmatter: dict) -> str | None:
    """The title exactly as authored -- unstripped of a trailing "Pattern"/
    "Architecture Style" suffix, unlike derive_display_name. Feeds the
    concept_terms title-type term (specs/006-corpus-structure-rebuild
    data-model.md): frontmatter `title` first, falling back to the
    document's H1 (searched only within the preamble, not the whole file,
    so a `# ` line inside a later code sample can never be mistaken for
    the document title)."""
    title = frontmatter.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    m = _H1_RE.search(preamble_text)
    return m.group(1).strip() if m else None


def parse_doc_date(frontmatter: dict) -> str | None:
    raw = frontmatter.get("ms.date")
    if not isinstance(raw, str):
        return None
    try:
        return datetime.datetime.strptime(raw.strip(), "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


# --- fenced code block protection -------------------------------------------
#
# Fences are masked BEFORE any boundary (heading, list item, paragraph) is
# chosen, by finding fence ranges up front and rejecting any candidate match
# whose start falls inside one. A section that cannot be split without
# cutting a fence stays whole and exceeds the size cap -- spec.md's Edge
# Cases explicitly permits this.

_FENCE_MARK_RE = re.compile(r"^[ \t]*```.*$", re.MULTILINE)


def _fence_ranges(text: str) -> list[tuple[int, int]]:
    marks = list(_FENCE_MARK_RE.finditer(text))
    ranges = []
    i = 0
    while i + 1 < len(marks):
        ranges.append((marks[i].start(), marks[i + 1].end()))
        i += 2
    return ranges


def _inside_any(pos: int, ranges: list[tuple[int, int]]) -> bool:
    return any(start <= pos < end for start, end in ranges)


# --- structure-first section parsing, with exact byte spans ----------------
#
# Every heading match's span is tracked directly against the post-frontmatter
# text (no line-join-and-rejoin reconstruction, which would lose exact offset
# fidelity). A section's body span runs from immediately after its heading
# line's newline through the start of the next heading line (or EOF) --
# nothing is trimmed, so consecutive spans plus the interleaved heading-line
# bytes reconstruct the source exactly by construction (this is what SC-001's
# "no gap, no overlap" is verified against in tests/test_chunk_azure.py).

_HEADING_RE = re.compile(r"^(#{2,3})(?!#)[ \t]*(.+?)[ \t]*$", re.MULTILINE)


class Section:
    __slots__ = ("level", "heading", "parent_h2", "match_start", "body_start", "body_end")

    def __init__(self, level, heading, parent_h2, match_start, body_start, body_end):
        self.level = level
        self.heading = heading
        self.parent_h2 = parent_h2
        self.match_start = match_start
        self.body_start = body_start
        self.body_end = body_end

    @property
    def body(self) -> str:
        raise NotImplementedError("slice the owning text with body_start/body_end instead")


def parse_sections(text: str) -> list[Section]:
    fence_ranges = _fence_ranges(text)
    matches = [m for m in _HEADING_RE.finditer(text) if not _inside_any(m.start(), fence_ranges)]

    sections: list[Section] = []
    parent_h2: str | None = None
    for i, m in enumerate(matches):
        level = len(m.group(1))
        heading = m.group(2)
        body_start = m.end()
        if body_start < len(text) and text[body_start] == "\n":
            body_start += 1
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)

        if level == 2:
            parent_h2 = heading
            this_parent = None
        else:
            this_parent = parent_h2

        sections.append(Section(level, heading, this_parent, m.start(), body_start, body_end))
    return sections


# --- FR-012-equivalent: link extraction (read-only scan, never mutates content)

_LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")


def extract_links(text: str) -> list[tuple[str, str]]:
    return [(m.group(1), m.group(2)) for m in _LINK_RE.finditer(text)]


_RELATIVE_MD_LINK_RE = re.compile(r"^\.?/?([\w.\-/]+?)\.md$")


def normalize_related_targets(targets: set[str]) -> list[str]:
    ids = set()
    for target in targets:
        m = _RELATIVE_MD_LINK_RE.match(target)
        if not m:
            continue
        stem = Path(m.group(1)).name
        ids.add(derive_concept_id(stem))
    return sorted(ids)


# --- size-bounded splitting (FR-006, FR-007) --------------------------------

BODY_CAP = 3000
CHILD_FLOOR = 300

_TOP_BULLET_RE = re.compile(r"^-\s+", re.MULTILINE)
_BLANK_LINE_RE = re.compile(r"\n[ \t]*\n+")


def _boundary_positions(body: str, fence_ranges: list[tuple[int, int]]) -> list[int]:
    item_starts = sorted(
        {m.start() for m in _TOP_BULLET_RE.finditer(body) if not _inside_any(m.start(), fence_ranges)}
    )
    if item_starts:
        return sorted({0, *item_starts})

    paragraph_starts = sorted(
        {
            m.end()
            for m in _BLANK_LINE_RE.finditer(body)
            if m.end() < len(body) and not _inside_any(m.start(), fence_ranges)
        }
    )
    return sorted({0, *paragraph_starts})


def _pack_boundaries(boundaries: list[int], total_len: int) -> list[tuple[int, int]]:
    raw_spans = []
    for i, start in enumerate(boundaries):
        end = boundaries[i + 1] if i + 1 < len(boundaries) else total_len
        raw_spans.append((start, end))

    packed: list[tuple[int, int]] = []
    cur_start, cur_end = raw_spans[0]
    for start, end in raw_spans[1:]:
        if (end - cur_start) <= BODY_CAP:
            cur_end = end
        else:
            packed.append((cur_start, cur_end))
            cur_start, cur_end = start, end
    packed.append((cur_start, cur_end))
    return packed


def _merge_floor_violations(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    result = list(spans)
    changed = True
    while changed and len(result) > 1:
        changed = False
        for i, (s, e) in enumerate(result):
            if (e - s) < CHILD_FLOOR:
                if i + 1 < len(result):
                    _, ne = result[i + 1]
                    result[i:i + 2] = [(s, ne)]
                else:
                    ps, _ = result[i - 1]
                    result[i - 1:i + 1] = [(ps, e)]
                changed = True
                break
    return result


def split_section_body(body: str) -> list[tuple[int, int]]:
    """Returns a list of (start, end) offsets relative to `body`, partitioning
    [0, len(body)) exactly. A body within the cap is returned unsplit. Splits
    prefer list-item boundaries, falling back to paragraph boundaries; fenced
    code blocks are never cut. No returned part is below CHILD_FLOOR unless
    the whole body already is."""
    if len(body) <= BODY_CAP:
        return [(0, len(body))]

    fence_ranges = _fence_ranges(body)
    boundaries = _boundary_positions(body, fence_ranges)
    if len(boundaries) <= 1:
        return [(0, len(body))]  # no usable boundary outside a fence: stays whole, exceeds cap

    packed = _pack_boundaries(boundaries, len(body))
    return _merge_floor_violations(packed)


# --- identifiers -------------------------------------------------------------


def slugify(text: str) -> str:
    slug = text.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def build_heading_path_slug(heading_path: list[str]) -> str:
    segments = heading_path[1:]  # exclude the document title
    if not segments:
        return "preamble"
    return "--".join(slugify(seg)[:40] for seg in segments)


def build_section_chunk_id(concept_id: str, heading_path: list[str]) -> str:
    return f"{SOURCE_ID}:{concept_id}:{build_heading_path_slug(heading_path)}"


def build_child_chunk_id(parent_chunk_id: str, content: str) -> str:
    sha8 = hashlib.sha256(content.encode("utf-8")).hexdigest()[:8]
    return f"{parent_chunk_id}:{sha8}"


def finalize_section_ids(pending: list[dict]) -> list[dict]:
    """Disambiguates section-level ids that collide on the same heading-path
    slug (spec.md Edge Cases: "identifiers must remain distinct"). Every
    occurrence of a colliding base id gets a content-hash suffix -- including
    the one that would otherwise keep the bare id -- so the bare id is only
    ever used when it is genuinely unique, and never depends on traversal
    order (docs/DECISIONS.md's chunk_id entry)."""
    counts: dict[str, int] = {}
    for c in pending:
        counts[c["baseChunkId"]] = counts.get(c["baseChunkId"], 0) + 1

    finalized: list[dict] = []
    seen: set[str] = set()
    for c in pending:
        base_id = c["baseChunkId"]
        if counts[base_id] > 1:
            suffix = hashlib.sha256(c["content"].encode("utf-8")).hexdigest()[:6]
            chunk_id = f"{base_id}-{suffix}"
        else:
            chunk_id = base_id
        if chunk_id in seen:
            n = 2
            while f"{chunk_id}-{n}" in seen:
                n += 1
            chunk_id = f"{chunk_id}-{n}"
        seen.add(chunk_id)
        out = {k: v for k, v in c.items() if k != "baseChunkId"}
        out["chunkId"] = chunk_id
        finalized.append(out)
    return finalized


# --- per-file chunking -------------------------------------------------------


def chunk_file(path: Path, concept_id: str, source_url: str = "", citable: bool = True,
                content_hash: str = "", source_file: str = "") -> dict:
    raw_text = path.read_text(encoding="utf-8", errors="replace")
    frontmatter = parse_frontmatter(raw_text)
    display_name = derive_display_name(concept_id, frontmatter)
    doc_date = parse_doc_date(frontmatter)
    post_fm_text = strip_frontmatter(raw_text)

    sections = parse_sections(post_fm_text)

    related_targets: set[str] = set()

    # Every unit -- preamble plus every H2/H3 section -- is a "top-level"
    # pending entry, in document order, none excluded (FR-001, FR-002).
    top_level: list[dict] = []

    first_start = sections[0].match_start if sections else len(post_fm_text)
    raw_title = derive_raw_title(post_fm_text[0:first_start], frontmatter)
    top_level.append({
        "headingPath": [display_name],
        "start": 0,
        "end": first_start,
    })
    for link_text, target in extract_links(post_fm_text[0:first_start]):
        related_targets.add(target)

    for section in sections:
        if section.level == 2:
            heading_path = [display_name, section.heading]
        else:
            heading_path = (
                [display_name, section.parent_h2, section.heading]
                if section.parent_h2 is not None
                else [display_name, section.heading]
            )
        top_level.append({
            "headingPath": heading_path,
            "start": section.body_start,
            "end": section.body_end,
        })
        for link_text, target in extract_links(post_fm_text[section.body_start:section.body_end]):
            related_targets.add(target)

    # Drop true zero-length spans (a heading immediately followed by another
    # heading, or a document whose very first line is already a heading) --
    # they contribute nothing and would otherwise become an empty chunk.
    top_level = [t for t in top_level if t["end"] > t["start"]]

    pending_sections: list[dict] = []
    for t in top_level:
        content = post_fm_text[t["start"]:t["end"]]
        pending_sections.append({
            "baseChunkId": build_section_chunk_id(concept_id, t["headingPath"]),
            "patternId": concept_id,
            "headingPath": t["headingPath"],
            "parentChunkId": None,
            "sourceOffset": t["start"],
            "sourceLength": t["end"] - t["start"],
            "content": content,
            "sourceUrl": source_url,
            "citable": citable,
            "docDate": doc_date,
            "contentHash": content_hash,
            "sourceFile": source_file,
        })

    finalized_sections = finalize_section_ids(pending_sections)

    all_chunks: list[dict] = []
    for section_chunk in finalized_sections:
        all_chunks.append(section_chunk)
        content = section_chunk["content"]
        if len(content) <= BODY_CAP:
            continue

        parent_id = section_chunk["chunkId"]
        child_spans = split_section_body(content)
        if len(child_spans) <= 1:
            continue  # unsplittable (fence-protected or no boundary) -- stays as the single section chunk

        seen_child_ids: set[str] = set()
        for rel_start, rel_end in child_spans:
            child_content = content[rel_start:rel_end]
            child_id = build_child_chunk_id(parent_id, child_content)
            if child_id in seen_child_ids:
                n = 2
                while f"{child_id}-{n}" in seen_child_ids:
                    n += 1
                child_id = f"{child_id}-{n}"
            seen_child_ids.add(child_id)
            all_chunks.append({
                "chunkId": child_id,
                "patternId": concept_id,
                "headingPath": section_chunk["headingPath"],
                "parentChunkId": parent_id,
                "sourceOffset": section_chunk["sourceOffset"] + rel_start,
                "sourceLength": rel_end - rel_start,
                "content": child_content,
                "sourceUrl": source_url,
                "citable": citable,
                "docDate": doc_date,
                "contentHash": content_hash,
                "sourceFile": source_file,
            })

    return {
        "chunks": all_chunks,
        "related_targets": related_targets,
        "display_name": display_name,
        "raw_title": raw_title,
        "doc_date": doc_date,
    }


# --- driver -------------------------------------------------------------------


def _load_manifest() -> dict[str, dict]:
    rows = [json.loads(l) for l in MANIFEST_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
    by_rel: dict[str, dict] = {}
    for row in rows:
        local_path = row["local_path"].replace("\\", "/")
        rel = local_path.removeprefix("raw/azure/")
        by_rel[rel] = row
    return by_rel


def main():
    ap = argparse.ArgumentParser()
    ap.parse_args()

    manifest = _load_manifest()
    eligible_rel_paths = sorted(rel for rel in manifest if is_concept_eligible(rel))
    print(f"[chunk_azure] {len(eligible_rel_paths)} concept-eligible files")

    all_chunks: list[dict] = []
    all_candidates: list[dict] = []
    section_count = 0
    leaf_count = 0
    total_leaf_bytes = 0

    for rel in eligible_rel_paths:
        entry = manifest[rel]
        path = CORPUS / entry["local_path"]
        concept_id = derive_concept_id(Path(rel).stem)
        result = chunk_file(
            path,
            concept_id,
            source_url=entry["source_url"],
            citable=bool(entry["citable"]),
            content_hash=entry["sha256"],
            source_file=rel,
        )
        all_chunks.extend(result["chunks"])

        parent_ids = {c["parentChunkId"] for c in result["chunks"] if c["parentChunkId"]}
        for c in result["chunks"]:
            if c["chunkId"] not in parent_ids:
                leaf_count += 1
                total_leaf_bytes += c["sourceLength"]
        section_count += sum(1 for c in result["chunks"] if c["parentChunkId"] is None)

        all_candidates.append(
            {
                "conceptId": concept_id,
                "name": result["display_name"],
                "title": result["raw_title"],
                "kind": "architecture",
                "aliases": [],
                "related": normalize_related_targets(result["related_targets"]),
                "addedFrom": "seed",
                "sourceFile": rel,
            }
        )

    CHUNKS_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(CHUNKS_OUT, "w", encoding="utf-8") as f:
        for chunk in all_chunks:
            f.write(json.dumps(chunk, ensure_ascii=False) + "\n")
    print(f"[chunk_azure] wrote {len(all_chunks)} chunk rows ({section_count} sections, {leaf_count} leaves) -> {CHUNKS_OUT}")
    print(f"[chunk_azure] leaf byte coverage: {total_leaf_bytes} bytes claimed")

    CANDIDATES_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(CANDIDATES_OUT, "w", encoding="utf-8") as f:
        for candidate in all_candidates:
            f.write(json.dumps(candidate, ensure_ascii=False) + "\n")
    print(f"[chunk_azure] wrote {len(all_candidates)} concept candidates -> {CANDIDATES_OUT}")


if __name__ == "__main__":
    main()
