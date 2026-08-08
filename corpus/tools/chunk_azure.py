#!/usr/bin/env python3
"""Chunk the azure corpus per DESIGN.md §7.5 / spec.md FR-006 through FR-015,
FR-019, FR-023, FR-008a, FR-013a (specs/005-corpus-ingest-foundation).

Reads corpus/raw/azure/, writes three outputs, all pure text processing with
zero database access (research.md §1):
    corpus/_meta/chunks/azure.jsonl       one row per DocChunk candidate
    corpus/_meta/candidates/azure.jsonl   one row per Concept candidate (49)
    corpus/reports/unmapped-headings-azure.md

Implemented directly from the spec's functional requirements — NOT derived
from, or validated against, any prior measurement script (see this repo's
tasks.md and docs/DECISIONS.md's 2026-08-08 measurement-first-discipline
entry for why that distinction matters).
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
REPORT_OUT = CORPUS / "reports" / "unmapped-headings-azure.md"

SOURCE_ID = "azure"

# --- SC-005: concept-eligible file scope -----------------------------------

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


# --- FR-023: concept_id normalization ---------------------------------------

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


_TITLE_SUFFIX_RE = re.compile(r"\s+(Pattern|Architecture Style)$", re.I)


def derive_display_name(concept_id: str, frontmatter: dict) -> str:
    title = frontmatter.get("title")
    if isinstance(title, str) and title.strip():
        return _TITLE_SUFFIX_RE.sub("", title.strip())
    return " ".join(word.capitalize() for word in concept_id.split("-"))


def parse_doc_date(frontmatter: dict) -> str | None:
    raw = frontmatter.get("ms.date")
    if not isinstance(raw, str):
        return None
    try:
        return datetime.datetime.strptime(raw.strip(), "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


# --- FR-006 / FR-006a / FR-007: section parsing -----------------------------

_H2_RE = re.compile(r"^##(?!#)\s*(.+?)\s*$")
_H3_RE = re.compile(r"^###(?!#)\s*(.+?)\s*$")


class Section:
    __slots__ = ("level", "heading", "parent_h2", "lines")

    def __init__(self, level: int, heading: str, parent_h2: str | None):
        self.level = level
        self.heading = heading
        self.parent_h2 = parent_h2
        self.lines: list[str] = []

    @property
    def body(self) -> str:
        return "\n".join(self.lines)


def parse_sections(text: str) -> list[Section]:
    sections: list[Section] = []
    in_fence = False
    current: Section | None = None
    parent_h2: str | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            if current is not None:
                current.lines.append(line)
            continue
        if not in_fence:
            m2 = _H2_RE.match(line)
            m3 = _H3_RE.match(line) if not m2 else None
            if m2:
                current = Section(2, m2.group(1), None)
                sections.append(current)
                parent_h2 = m2.group(1)
                continue
            if m3:
                current = Section(3, m3.group(1), parent_h2)
                sections.append(current)
                continue
        if current is not None:
            current.lines.append(line)
    return sections


# --- FR-008 / FR-008a: kind classification ----------------------------------

_KIND_PATTERNS = [
    ("cost", re.compile(r"^(Problems|Issues|Considerations|Challenges|Limitations)", re.I)),
    # "Pattern advantages" is matched explicitly (prefix-anchored, like every
    # other rule here) rather than a general \bAdvantages\b contains-match.
    # The corpus has exactly two headings containing that word: "Pattern
    # advantages" (genuinely a benefit section) and "Advantages and
    # considerations for each strategy" (a MIXED section — its body contains
    # real cost/consideration content alongside advantages). A broad match
    # would classify the whole mixed section as `benefit`, which is exactly
    # the DESIGN.md §9④ failure mode: a drawback gets cited as an advantage,
    # with a genuine verbatim excerpt behind it, so the substring check still
    # passes. The narrower match leaves "Advantages and considerations for
    # each strategy" unmapped, surfacing it in the report for a human call
    # instead of silently mislabeling half its content.
    ("benefit", re.compile(r"^(Benefits|Pattern advantages)", re.I)),
    ("when", re.compile(r"^When to use", re.I)),
    ("example", re.compile(r"^(Example|Next step)", re.I)),
    ("meta", re.compile(r"^(Workload design|Related resources|Contributors)", re.I)),
]

TRADEOFF_KINDS = {"cost", "benefit", "when"}


def classify_kind(heading: str, parent_h2: str | None) -> str | None:
    governing_h2 = parent_h2 if parent_h2 is not None else heading
    guarded = governing_h2.strip().lower().startswith("context and problem")
    for kind, pattern in _KIND_PATTERNS:
        if pattern.match(heading.strip()):
            if guarded and kind in TRADEOFF_KINDS:
                continue
            return kind
    return None


def is_discarded_section(heading: str) -> bool:
    return heading.strip().lower().startswith("workload design")


# --- FR-011: directive-line stripping ---------------------------------------
#
# A directive line can sit in the MIDDLE of otherwise-kept prose (e.g. an
# :::image::: directive between two sentences of an "Example" section).
# Simply excising that line and rejoining the rest would produce text that is
# no longer a literal, contiguous substring of the source file — violating
# SC-001. split_around_directives() returns each contiguous, directive-free
# run as its own piece instead, so callers can emit one chunk per piece
# rather than one chunk splicing multiple non-adjacent runs together.

_DIRECTIVE_LINE_RE = re.compile(r"^[ \t]*:::.*$", re.MULTILINE)


def split_around_directives(text: str) -> list[str]:
    spans = [m.span() for m in _DIRECTIVE_LINE_RE.finditer(text)]
    if not spans:
        return [text] if text.strip() else []
    parts: list[str] = []
    pos = 0
    for start, end in spans:
        segment = text[pos:start]
        if segment.strip():
            parts.append(segment)
        pos = end
    tail = text[pos:]
    if tail.strip():
        parts.append(tail)
    return parts


def strip_directives(body: str) -> str:
    """Thin single-string convenience wrapper (used directly by a few tests
    and for the simple, no-mid-content-removal case). The real chunking
    pipeline uses split_around_directives() so a directive in the middle of a
    section can never merge two non-adjacent runs into one non-substring
    chunk."""
    return "\n".join(split_around_directives(body))


# --- FR-012: link extraction (read-only scan, never mutates content) -------

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


# --- FR-009: item-level bullet splitting ------------------------------------
#
# Offset-based (not line-split-and-rejoin): every Item.body and every
# remainder piece is a direct slice of the original section body, which
# guarantees it's a literal substring by construction — no reconstruction
# step that could silently break contiguity (the same class of bug as
# directive stripping, above). A top-level bullet's span runs from its own
# "- " through the character right before the next top-level bullet (or the
# end of the section), so any indented sub-content/sub-bullets under it are
# naturally included in its body.

_TOP_BULLET_RE = re.compile(r"^-\s+(.*)$", re.MULTILINE)

_ITEM_LABEL_PATTERNS = [
    re.compile(r"^\*\*(.+?)\.\*\*\s*(.*)$"),  # - **Label.** body
    re.compile(r"^\*\*(.+?):\*\*\s*(.*)$"),  # - **Label:** body
    re.compile(r"^\*\*(.+?)\*\*\.\s*(.*)$"),  # - **Label**. body
    re.compile(r"^\*\*(.+?)\*\*:\s*(.*)$"),  # - **Label**: body
    re.compile(r"^\*\*(.+?)\*\*\s+(.*)$"),  # - **Label** body (loosest, tried last)
]


class Item:
    __slots__ = ("label", "body")

    def __init__(self, label: str, body: str):
        self.label = label
        self.body = body


def split_items(body: str) -> tuple[list[Item], list[str]]:
    """Returns (items, remainder_pieces). remainder_pieces is a list, not a
    single joined string, because non-matching bullets can occur in more
    than one *non-adjacent* run once matched items are excised from between
    them — joining non-adjacent runs together would not be a valid substring
    of the source (spec FR-009 acceptance scenario 5).

    But adjacent non-matching bullets are NOT non-adjacent: a top-level
    bullet's span already extends all the way to the start of the next
    top-level bullet (`span_end`), so there is no gap between consecutive
    bullets to begin with. A run of consecutive non-matching bullets (plus
    any leading prose before the first bullet) is therefore always
    contiguous in the source and MUST be emitted as a single piece — only a
    genuinely matched item, sitting between two such runs, is what actually
    starts a new, non-adjacent piece. Treating every non-matching bullet as
    its own piece (an earlier version of this function) over-fragmented
    sections with no bold labels at all — e.g. throttling.md's "Problems and
    considerations" (pure prose bullets, zero labelled items) split into 17
    chunks instead of remaining the single chunk FR-009 requires."""
    matches = list(_TOP_BULLET_RE.finditer(body))
    if not matches:
        return [], ([body] if body.strip() else [])

    items: list[Item] = []
    remainder: list[str] = []
    remainder_start: int | None = 0  # covers any leading prose before the first bullet
    prev_end = 0

    for i, m in enumerate(matches):
        span_end = matches[i + 1].start() if i + 1 < len(matches) else len(body)
        first_line = m.group(1)

        matched = None
        for pattern in _ITEM_LABEL_PATTERNS:
            im = pattern.match(first_line)
            if im:
                matched = (im.group(1).strip(), im.start(2))
                break

        if matched is None:
            if remainder_start is None:
                remainder_start = m.start()
            prev_end = span_end
            continue

        if remainder_start is not None:
            piece = body[remainder_start:m.start()]
            if piece.strip():
                remainder.append(piece)
            remainder_start = None

        label, offset_in_line = matched
        item_body_start = m.start(1) + offset_in_line
        items.append(Item(label, body[item_body_start:span_end]))
        prev_end = span_end

    if remainder_start is not None:
        piece = body[remainder_start:prev_end]
        if piece.strip():
            remainder.append(piece)

    return items, remainder


# --- chunk_id: label-derived slug, not positional (FR-005) -----------------


def slugify(text: str) -> str:
    slug = text.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-")


def build_chunk_id(concept_id: str, kind: str, slug: str) -> str:
    return f"{SOURCE_ID}:{concept_id}:{kind}:{slug}"


def finalize_chunk_ids(pending: list[dict]) -> list[dict]:
    """Assigns final chunkId values from the COMPLETE set of pending chunks
    for a file, not incrementally as each is produced. An earlier,
    incremental version gave the bare id to whichever colliding chunk was
    emitted first and a hash suffix to the rest — which made the bare id
    positional in disguise: it belonged to whatever was traversed first, not
    to any particular content. If an upstream edit later split that same
    section differently (e.g. a directive line landing in the middle of what
    used to be the first piece), the bare id could end up pointing at
    different content than it originally held — exactly what FR-005 and
    spec acceptance scenario 11 forbid, just relocated from "index in
    document order" to "order of traversal."

    Here, every chunk carries a `baseChunkId`; slugs that occur more than
    once within the file get a content-hash suffix on EVERY occurrence
    (including the one that would have been "first"), so the bare id is
    only ever used when it's genuinely unique. A chunk whose content changes
    always gets a new id; a chunk whose content is unchanged always keeps
    the id it already had, regardless of what else in the file changed
    around it."""
    counts: dict[str, int] = {}
    for c in pending:
        counts[c["baseChunkId"]] = counts.get(c["baseChunkId"], 0) + 1

    finalized: list[dict] = []
    seen_final_ids: set[str] = set()
    for c in pending:
        base_id = c["baseChunkId"]
        if counts[base_id] > 1:
            suffix = hashlib.sha256(c["content"].encode("utf-8")).hexdigest()[:6]
            chunk_id = f"{base_id}-{suffix}"
        else:
            chunk_id = base_id
        # Defensive tiebreaker for the (extremely unlikely) case of two
        # colliding chunks with byte-identical content, which would hash to
        # the same suffix: append a counter rather than silently overwrite.
        if chunk_id in seen_final_ids:
            n = 2
            while f"{chunk_id}-{n}" in seen_final_ids:
                n += 1
            chunk_id = f"{chunk_id}-{n}"
        seen_final_ids.add(chunk_id)
        out = {k: v for k, v in c.items() if k != "baseChunkId"}
        out["chunkId"] = chunk_id
        finalized.append(out)
    return finalized


# --- FR-013 / FR-013a: contextual prefix ------------------------------------


def build_context_prefix(display_name: str, ancestor_headings: list[str]) -> str:
    parts = [f"{display_name} pattern"] + ancestor_headings
    return "[" + " / ".join(parts) + "]"


# --- per-file chunking -------------------------------------------------------


def chunk_file(path: Path, concept_id: str, source_url: str = "", citable: bool = True,
                content_hash: str = "", source_file: str = "") -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    frontmatter = parse_frontmatter(text)
    display_name = derive_display_name(concept_id, frontmatter)
    doc_date = parse_doc_date(frontmatter)

    sections = parse_sections(text)

    pending_chunks: list[dict] = []
    unmapped_headings: list[str] = []
    related_targets: set[str] = set()

    for section in sections:
        heading = section.heading
        for _link_text, target in extract_links(section.body):
            related_targets.add(target)

        kind = classify_kind(heading, section.parent_h2)
        if kind is None:
            unmapped_headings.append(heading)
            continue
        if kind == "meta" and is_discarded_section(heading):
            continue

        ancestor = [section.parent_h2, heading] if section.level == 3 else [heading]
        prefix = build_context_prefix(display_name, ancestor)

        def _emit(label: str, raw_body: str):
            # One chunk per contiguous, directive-free segment — never one
            # chunk splicing multiple non-adjacent segments together (would
            # violate SC-001's substring guarantee; see split_around_directives).
            for segment in split_around_directives(raw_body):
                content = segment.strip()
                if not content:
                    continue
                slug = slugify(label)
                pending_chunks.append(
                    {
                        "baseChunkId": build_chunk_id(concept_id, kind, slug),
                        "patternId": concept_id,
                        "kind": kind,
                        "label": label,
                        "content": content,
                        "contextPrefix": prefix,
                        "sourceUrl": source_url,
                        "citable": citable,
                        "kindConfidence": "regex",
                        "docDate": doc_date,
                        "contentHash": content_hash,
                        "sourceFile": source_file,
                    }
                )

        if kind in TRADEOFF_KINDS:
            items, remainder_pieces = split_items(section.body)
            for item in items:
                _emit(item.label, item.body)
            for piece in remainder_pieces:
                _emit(heading, piece)
        else:
            _emit(heading, section.body)

    return {
        "chunks": finalize_chunk_ids(pending_chunks),
        "unmapped_headings": unmapped_headings,
        "related_targets": related_targets,
        "display_name": display_name,
        "doc_date": doc_date,
    }


# --- FR-020 / FR-021 / FR-022: unmapped-headings report ---------------------


def build_unmapped_report(counts: dict[str, int]) -> str:
    lines = ["# Unmapped headings — azure corpus", ""]
    if not counts:
        lines.append("No unmapped headings — every H2/H3 heading matched a `kind` "
                      "regex or was recognized-and-discarded by rule.")
        return "\n".join(lines) + "\n"
    lines.append(f"{len(counts)} distinct unmapped headings, {sum(counts.values())} total occurrences.")
    lines.append("")
    lines.append("| heading | occurrences |")
    lines.append("|---|---:|")
    for heading, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        lines.append(f"| {heading} | {count} |")
    return "\n".join(lines) + "\n"


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
    unmapped_counts: dict[str, int] = {}
    kind_totals: dict[str, int] = {}

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
        for h in result["unmapped_headings"]:
            unmapped_counts[h] = unmapped_counts.get(h, 0) + 1
        for c in result["chunks"]:
            kind_totals[c["kind"]] = kind_totals.get(c["kind"], 0) + 1

        all_candidates.append(
            {
                "conceptId": concept_id,
                "name": result["display_name"],
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
    print(f"[chunk_azure] wrote {len(all_chunks)} chunks -> {CHUNKS_OUT}")
    for kind, count in sorted(kind_totals.items()):
        print(f"  {kind}: {count}")

    CANDIDATES_OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(CANDIDATES_OUT, "w", encoding="utf-8") as f:
        for candidate in all_candidates:
            f.write(json.dumps(candidate, ensure_ascii=False) + "\n")
    print(f"[chunk_azure] wrote {len(all_candidates)} concept candidates -> {CANDIDATES_OUT}")

    REPORT_OUT.parent.mkdir(parents=True, exist_ok=True)
    REPORT_OUT.write_text(build_unmapped_report(unmapped_counts), encoding="utf-8")
    print(f"[chunk_azure] wrote unmapped-headings report -> {REPORT_OUT}")


if __name__ == "__main__":
    main()
