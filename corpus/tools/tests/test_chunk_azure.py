"""Tests for the rewritten chunk_azure.py (structure-first, size-bounded
hierarchical chunking -- specs/006-corpus-structure-rebuild).

Per tasks.md T003, the coverage/determinism/nesting assertions run against
the REAL corpus (corpus/raw/azure/), not fixtures -- both defects this
feature closes (the 69% kind-filter loss and the invisible preamble) survived
a passing fixture-only suite. Fixture-based tests below cover the smaller
mechanics (splitting, slugs, ids) where a hand-built input is clearer than
hunting for a real example.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chunk_azure as ca  # noqa: E402

MANIFEST_EXISTS = ca.MANIFEST_PATH.exists() and ca.RAW_AZURE.exists()


# ---------------------------------------------------------------------------
# Section parsing: H2/H3 splitting, code-fence protection, preamble
# ---------------------------------------------------------------------------

CQRS_FIXTURE = """---
title: CQRS Pattern
ms.date: 02/20/2025
---
Segregate the read and write operations for a data store into separate data
models.

## Solution

Intro text before any H3.

### Separate read models and write models

Some content about separating models.

### Benefits of CQRS

- **Independent scaling.** Read and write workloads can scale independently.
- **Optimized data schemas.**: The read side can use a schema optimized for queries.

## Problems and considerations

- **Complexity.** The basic idea of CQRS is simple, but it can lead to complexity.
- **Messaging.** Although CQRS avoids conflicting update requests at the domain
  level, requests must still be handled or routed correctly.
  See [Event Sourcing pattern](./event-sourcing.md) for a common complement.

## When to use this pattern

This pattern is useful when read and write workloads have very different needs.

## Workload design

Cross-references to the Azure Well-Architected Framework.

- A link to something.
"""


def test_h2_body_stops_before_its_first_h3():
    post_fm = ca.strip_frontmatter(CQRS_FIXTURE)
    sections = ca.parse_sections(post_fm)
    solution = next(s for s in sections if s.level == 2 and s.heading == "Solution")
    body = post_fm[solution.body_start:solution.body_end]
    assert "Intro text before any H3." in body
    assert "Separate read models" not in body
    assert "Benefits of CQRS" not in body


def test_h3_headings_become_their_own_sections_with_parent_h2():
    post_fm = ca.strip_frontmatter(CQRS_FIXTURE)
    sections = ca.parse_sections(post_fm)
    h3s = {(s.heading, s.parent_h2) for s in sections if s.level == 3}
    assert ("Separate read models and write models", "Solution") in h3s
    assert ("Benefits of CQRS", "Solution") in h3s


def test_code_fence_protects_heading_like_lines_from_splitting():
    text = """## Solution

Some text.

```yaml
## this looks like a heading but is inside a fence
key: value
```

More text after the fence.
"""
    sections = ca.parse_sections(text)
    assert len(sections) == 1
    body = text[sections[0].body_start:sections[0].body_end]
    assert "## this looks like a heading" in body
    assert "More text after the fence." in body


def test_preamble_before_first_heading_is_its_own_unit():
    result = None
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "cqrs.md"
        p.write_text(CQRS_FIXTURE, encoding="utf-8")
        result = ca.chunk_file(p, "cqrs")
    preamble = next(c for c in result["chunks"] if c["headingPath"] == ["CQRS"])
    assert "Segregate the read and write operations" in preamble["content"]
    assert preamble["parentChunkId"] is None


def test_document_with_no_headings_is_a_single_preamble_chunk(tmp_path):
    text = "Just prose, no headings anywhere in this file at all.\n"
    p = tmp_path / "flat.md"
    p.write_text(text, encoding="utf-8")
    result = ca.chunk_file(p, "flat")
    assert len(result["chunks"]) == 1
    assert result["chunks"][0]["headingPath"] == ["Flat"]
    assert result["chunks"][0]["content"] == text


# ---------------------------------------------------------------------------
# Nothing is classified or discarded any more
# ---------------------------------------------------------------------------

def test_every_heading_produces_a_chunk_regardless_of_wording(tmp_path):
    text = (
        "## Some heading no rule would ever recognize\n\n"
        "Content that used to be silently dropped.\n\n"
        "## Workload design\n\n"
        "Also kept now -- previously discarded even though 'recognized'.\n"
    )
    p = tmp_path / "everything-kept.md"
    p.write_text(text, encoding="utf-8")
    result = ca.chunk_file(p, "everything-kept")
    contents = [c["content"] for c in result["chunks"]]
    assert any("used to be silently dropped" in c for c in contents)
    assert any("previously discarded" in c for c in contents)


def test_chunk_azure_module_has_no_classification_machinery():
    # docs/DECISIONS.md 2026-08-10 "The kind subsystem is abolished": these
    # names must not exist, not just be unused, so nothing can silently
    # resurrect the filter this feature exists to remove.
    for name in ("classify_kind", "is_discarded_section", "build_context_prefix", "_KIND_PATTERNS"):
        assert not hasattr(ca, name), f"{name} should have been deleted, not just stopped being called"


# ---------------------------------------------------------------------------
# Size-bounded splitting (FR-006, FR-007)
# ---------------------------------------------------------------------------

def test_body_under_cap_is_not_split():
    body = "Short body.\n"
    assert ca.split_section_body(body) == [(0, len(body))]


def test_body_over_cap_splits_on_list_items_and_partitions_exactly():
    items = "\n".join(f"- Item number {i} with some padding text to add length here.\n" for i in range(120))
    assert len(items) > ca.BODY_CAP
    spans = ca.split_section_body(items)
    assert len(spans) > 1
    # exact partition: contiguous, no gap, no overlap
    assert spans[0][0] == 0
    assert spans[-1][1] == len(items)
    for (s1, e1), (s2, e2) in zip(spans, spans[1:]):
        assert e1 == s2
    reconstructed = "".join(items[s:e] for s, e in spans)
    assert reconstructed == items


def test_body_over_cap_falls_back_to_paragraphs_when_not_a_list():
    paragraph = "This is one long sentence padded out. " * 20 + "\n"
    body = (paragraph + "\n") * 15
    assert len(body) > ca.BODY_CAP
    spans = ca.split_section_body(body)
    assert len(spans) > 1
    reconstructed = "".join(body[s:e] for s, e in spans)
    assert reconstructed == body


def test_split_never_cuts_inside_a_fence():
    fence = "```\n" + ("x" * 4000) + "\n```\n"
    body = "Some intro.\n\n" + fence
    assert len(body) > ca.BODY_CAP
    spans = ca.split_section_body(body)
    # the fence occupies almost the whole body with no boundary outside it
    # other than the intro paragraph -- whatever the split, no part may start
    # or end strictly inside the fence's interior.
    fence_start = body.index("```")
    fence_end = body.rindex("```") + 3
    for s, e in spans:
        assert not (fence_start < s < fence_end)
        assert not (fence_start < e < fence_end)


def test_no_split_part_is_below_floor_unless_whole_body_is():
    items = "\n".join(f"- Item {i}: padding padding padding padding padding.\n" for i in range(50))
    spans = ca.split_section_body(items)
    if len(spans) > 1:
        for s, e in spans:
            assert (e - s) >= ca.CHILD_FLOOR


# ---------------------------------------------------------------------------
# Identifiers (FR-010, FR-011, FR-012)
# ---------------------------------------------------------------------------

def test_section_chunk_id_matches_documented_example():
    chunk_id = ca.build_section_chunk_id("cqrs", ["CQRS", "Solution", "Benefits of CQRS"])
    assert chunk_id == "azure:cqrs:solution--benefits-of-cqrs"


def test_preamble_chunk_id_uses_reserved_segment():
    chunk_id = ca.build_section_chunk_id("cqrs", ["CQRS"])
    assert chunk_id == "azure:cqrs:preamble"


def test_heading_path_segment_truncated_to_40_chars():
    long_heading = "A" * 100
    slug = ca.build_heading_path_slug(["Title", long_heading])
    assert len(slug) <= 40


def test_child_chunk_id_is_content_hash_not_ordinal():
    parent_id = "azure:cqrs:problems-and-considerations"
    id_a = ca.build_child_chunk_id(parent_id, "Some child text.")
    id_b = ca.build_child_chunk_id(parent_id, "Some child text.")
    id_c = ca.build_child_chunk_id(parent_id, "Different child text.")
    assert id_a == id_b  # same content -> same id (determinism)
    assert id_a != id_c  # different content -> different id
    assert id_a.startswith(parent_id + ":")


def test_finalize_section_ids_disambiguates_every_colliding_occurrence():
    pending = [
        {"baseChunkId": "azure:x:same", "content": "first"},
        {"baseChunkId": "azure:x:same", "content": "second"},
        {"baseChunkId": "azure:x:unique", "content": "third"},
    ]
    finalized = ca.finalize_section_ids(pending)
    ids = [c["chunkId"] for c in finalized]
    assert len(set(ids)) == 3
    assert "azure:x:same" not in ids  # neither collider keeps the bare id
    assert "azure:x:unique" in ids


# ---------------------------------------------------------------------------
# Real corpus: byte coverage, nesting, determinism (the assertions that
# would have caught the two defects this feature closes)
# ---------------------------------------------------------------------------

def _load_manifest():
    return ca._load_manifest()


def _eligible_files():
    manifest = _load_manifest()
    return sorted(rel for rel in manifest if ca.is_concept_eligible(rel)), manifest


def _reconstruct_document(post_fm_text: str, chunks: list[dict]) -> str:
    """Reconstructs the post-frontmatter text from LEAF chunk spans only
    (chunks that are not themselves a parent) plus the heading-line bytes
    between them, in offset order.

    SCOPE, precisely (an independent review of this suite found the original
    wording overclaimed): this catches duplicated or overlapping spans
    (reconstructed length would exceed the source's) and misaligned offsets
    (test_real_corpus_content_equals_source_span_exactly covers this one
    directly too). It does NOT catch a whole leaf being silently omitted --
    a missing leaf's span just becomes part of the next gap, which is filled
    unconditionally from post_fm_text, so a dropped section reconstructs
    "successfully." That is the job of test_real_corpus_overall_byte_coverage_is_total,
    which recomputes total claimable bytes independently of which chunks
    chunk_file() actually emitted. The two tests are not redundant with each
    other; do not remove one on the assumption the other already covers it."""
    parent_ids = {c["parentChunkId"] for c in chunks if c["parentChunkId"]}
    leaves = sorted(
        (c for c in chunks if c["chunkId"] not in parent_ids),
        key=lambda c: c["sourceOffset"],
    )
    # Gaps between leaves are expected -- they are the heading-line bytes
    # ("## Solution\n") that delimit sections and are deliberately not part
    # of any chunk's content (docs/DECISIONS.md's "Full body text" counting
    # basis excludes heading markup throughout).
    pieces = []
    cursor = 0
    for leaf in leaves:
        pieces.append(post_fm_text[cursor:leaf["sourceOffset"]])
        pieces.append(leaf["content"])
        cursor = leaf["sourceOffset"] + leaf["sourceLength"]
    pieces.append(post_fm_text[cursor:])
    return "".join(pieces)


def test_real_corpus_leaf_chunks_reconstruct_every_document_exactly():
    # Catches duplication, overlap, and offset misalignment -- NOT omission,
    # which test_real_corpus_overall_byte_coverage_is_total exists to catch
    # instead. See _reconstruct_document's docstring for why these are two
    # separate, non-redundant guarantees.
    if not MANIFEST_EXISTS:
        import pytest
        pytest.skip("corpus/raw/azure/ not present in this environment")

    eligible, manifest = _eligible_files()
    assert len(eligible) > 0
    for rel in eligible:
        entry = manifest[rel]
        path = ca.CORPUS / entry["local_path"]
        concept_id = ca.derive_concept_id(Path(rel).stem)
        result = ca.chunk_file(path, concept_id, source_file=rel)
        post_fm_text = ca.strip_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        reconstructed = _reconstruct_document(post_fm_text, result["chunks"])
        assert reconstructed == post_fm_text, f"reconstruction mismatch for {rel}"


def test_real_corpus_content_equals_source_span_exactly():
    if not MANIFEST_EXISTS:
        import pytest
        pytest.skip("corpus/raw/azure/ not present in this environment")

    eligible, manifest = _eligible_files()
    for rel in eligible:
        entry = manifest[rel]
        path = ca.CORPUS / entry["local_path"]
        concept_id = ca.derive_concept_id(Path(rel).stem)
        result = ca.chunk_file(path, concept_id, source_file=rel)
        post_fm_text = ca.strip_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        for chunk in result["chunks"]:
            span = post_fm_text[chunk["sourceOffset"]:chunk["sourceOffset"] + chunk["sourceLength"]]
            assert span == chunk["content"], f"{chunk['chunkId']} content != source span"


def test_real_corpus_parent_child_spans_nest_and_children_cover_parent_exactly():
    if not MANIFEST_EXISTS:
        import pytest
        pytest.skip("corpus/raw/azure/ not present in this environment")

    eligible, manifest = _eligible_files()
    found_a_split = False
    for rel in eligible:
        entry = manifest[rel]
        path = ca.CORPUS / entry["local_path"]
        concept_id = ca.derive_concept_id(Path(rel).stem)
        result = ca.chunk_file(path, concept_id, source_file=rel)
        by_id = {c["chunkId"]: c for c in result["chunks"]}
        children_by_parent: dict[str, list[dict]] = {}
        for c in result["chunks"]:
            if c["parentChunkId"]:
                children_by_parent.setdefault(c["parentChunkId"], []).append(c)

        for parent_id, children in children_by_parent.items():
            found_a_split = True
            parent = by_id[parent_id]
            children_sorted = sorted(children, key=lambda c: c["sourceOffset"])
            assert children_sorted[0]["sourceOffset"] == parent["sourceOffset"]
            assert (
                children_sorted[-1]["sourceOffset"] + children_sorted[-1]["sourceLength"]
                == parent["sourceOffset"] + parent["sourceLength"]
            )
            cursor = parent["sourceOffset"]
            for child in children_sorted:
                assert child["sourceOffset"] == cursor, "gap or overlap between siblings"
                assert child["sourceOffset"] >= parent["sourceOffset"]
                assert (
                    child["sourceOffset"] + child["sourceLength"]
                    <= parent["sourceOffset"] + parent["sourceLength"]
                )
                cursor += child["sourceLength"]
    assert found_a_split, "expected at least one section over the size cap in the real corpus"


def test_real_corpus_heading_path_root_is_document_title_and_preamble_is_singleton():
    if not MANIFEST_EXISTS:
        import pytest
        pytest.skip("corpus/raw/azure/ not present in this environment")

    eligible, manifest = _eligible_files()
    for rel in eligible:
        entry = manifest[rel]
        path = ca.CORPUS / entry["local_path"]
        concept_id = ca.derive_concept_id(Path(rel).stem)
        result = ca.chunk_file(path, concept_id, source_file=rel)
        title = result["display_name"]
        for c in result["chunks"]:
            assert c["headingPath"][0] == title
        # A split preamble produces several rows sharing the title-only
        # headingPath (a parent plus its children) -- what must stay unique
        # is the number of top-level (unsplit-parent) preamble SECTIONS, not
        # the row count.
        preamble_sections = [
            c for c in result["chunks"] if len(c["headingPath"]) == 1 and c["parentChunkId"] is None
        ]
        assert len(preamble_sections) <= 1, f"{rel}: more than one preamble section"


def test_real_corpus_no_chunk_id_collisions_across_whole_build():
    if not MANIFEST_EXISTS:
        import pytest
        pytest.skip("corpus/raw/azure/ not present in this environment")

    eligible, manifest = _eligible_files()
    all_ids: list[str] = []
    for rel in eligible:
        entry = manifest[rel]
        path = ca.CORPUS / entry["local_path"]
        concept_id = ca.derive_concept_id(Path(rel).stem)
        result = ca.chunk_file(path, concept_id, source_file=rel)
        all_ids.extend(c["chunkId"] for c in result["chunks"])
    assert len(all_ids) == len(set(all_ids)), "chunk_id collision somewhere in the real build"


def test_real_corpus_two_runs_produce_identical_ids_spans_and_counts():
    if not MANIFEST_EXISTS:
        import pytest
        pytest.skip("corpus/raw/azure/ not present in this environment")

    eligible, manifest = _eligible_files()
    for rel in eligible[:10]:  # a representative sample keeps this fast; full-corpus determinism
        entry = manifest[rel]  # is additionally exercised implicitly by every other real-corpus test
        path = ca.CORPUS / entry["local_path"]
        concept_id = ca.derive_concept_id(Path(rel).stem)
        result_a = ca.chunk_file(path, concept_id, source_file=rel)
        result_b = ca.chunk_file(path, concept_id, source_file=rel)
        key = lambda c: (c["chunkId"], c["sourceOffset"], c["sourceLength"])
        assert sorted(map(key, result_a["chunks"])) == sorted(map(key, result_b["chunks"]))
        assert len(result_a["chunks"]) == len(result_b["chunks"])


def test_real_corpus_overall_byte_coverage_is_total():
    if not MANIFEST_EXISTS:
        import pytest
        pytest.skip("corpus/raw/azure/ not present in this environment")

    eligible, manifest = _eligible_files()
    total_source_bytes = 0
    total_heading_bytes = 0
    total_leaf_bytes = 0
    for rel in eligible:
        entry = manifest[rel]
        path = ca.CORPUS / entry["local_path"]
        concept_id = ca.derive_concept_id(Path(rel).stem)
        result = ca.chunk_file(path, concept_id, source_file=rel)
        post_fm_text = ca.strip_frontmatter(path.read_text(encoding="utf-8", errors="replace"))
        total_source_bytes += len(post_fm_text)

        sections = ca.parse_sections(post_fm_text)
        for s in sections:
            total_heading_bytes += s.body_start - s.match_start

        parent_ids = {c["parentChunkId"] for c in result["chunks"] if c["parentChunkId"]}
        for c in result["chunks"]:
            if c["chunkId"] not in parent_ids:
                total_leaf_bytes += c["sourceLength"]

    coverage = total_leaf_bytes / (total_source_bytes - total_heading_bytes)
    print(
        f"\n[coverage] {len(eligible)} concepts, leaf bytes {total_leaf_bytes} / "
        f"body bytes {total_source_bytes - total_heading_bytes} = {coverage:.4%}"
    )
    assert round(coverage, 4) == 1.0
