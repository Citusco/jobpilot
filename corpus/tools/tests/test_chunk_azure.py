"""Fixture-based tests for chunk_azure.py, written directly from spec.md's
FR-006 through FR-015/FR-019/FR-023 — NOT derived from any prior measurement
script (see tasks.md's constraint banner and docs/DECISIONS.md's 2026-08-08
measurement-first-discipline entry). No real corpus file or database needed;
every fixture below is a small, self-contained markdown string.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chunk_azure as ca  # noqa: E402


# ---------------------------------------------------------------------------
# FR-006 / FR-006a / FR-007: H2+H3 splitting, code-fence protection
# ---------------------------------------------------------------------------

CQRS_FIXTURE = """---
title: CQRS Pattern
ms.date: 02/20/2025
---

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


def test_h2_keeps_only_intro_before_first_h3():
    sections = ca.parse_sections(CQRS_FIXTURE)
    solution = next(s for s in sections if s.level == 2 and s.heading == "Solution")
    assert "Intro text before any H3." in solution.body
    assert "Separate read models" not in solution.body
    assert "Benefits of CQRS" not in solution.body


def test_h3_headings_become_their_own_sections():
    sections = ca.parse_sections(CQRS_FIXTURE)
    headings = [(s.level, s.heading) for s in sections]
    assert (3, "Separate read models and write models") in headings
    assert (3, "Benefits of CQRS") in headings


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
    assert "## this looks like a heading" in sections[0].body
    assert "More text after the fence." in sections[0].body


# ---------------------------------------------------------------------------
# FR-008 / FR-008a: kind classification, Advantages, Context-and-problem guard
# ---------------------------------------------------------------------------

def test_classify_kind_maps_all_configured_prefixes_case_insensitively():
    assert ca.classify_kind("Problems and considerations", None) == "cost"
    assert ca.classify_kind("issues to note", None) == "cost"
    assert ca.classify_kind("Considerations", None) == "cost"
    assert ca.classify_kind("Challenges", None) == "cost"
    assert ca.classify_kind("Limitations", None) == "cost"
    assert ca.classify_kind("Benefits of CQRS", None) == "benefit"
    assert ca.classify_kind("benefits", None) == "benefit"
    assert ca.classify_kind("When to use this pattern", None) == "when"
    assert ca.classify_kind("Example", None) == "example"
    assert ca.classify_kind("Next step", None) == "example"
    assert ca.classify_kind("Workload design", None) == "meta"
    assert ca.classify_kind("Related resources", None) == "meta"
    assert ca.classify_kind("Contributors", None) == "meta"
    assert ca.classify_kind("Something else entirely", None) is None


def test_classify_kind_recognizes_advantages_as_benefit():
    # FR-008: deviation from DESIGN.md's literal regex, added because the real
    # corpus has "Pattern advantages" / "Advantages and considerations..."
    assert ca.classify_kind("Pattern advantages", None) == "benefit"
    assert ca.classify_kind("Advantages and considerations for each strategy", None) == "benefit"


def test_context_and_problem_parent_guard_suppresses_tradeoff_kind():
    # FR-008a, motivated by saga-content.md's real H3 "Challenges in
    # microservices architectures" nested under "## Context and problem".
    assert ca.classify_kind("Challenges in microservices architectures", "Context and problem") is None
    # A heading that would match `example`/`meta` under the same parent is unaffected —
    # the guard is scoped to cost/benefit/when only.
    assert ca.classify_kind("Related resources", "Context and problem") == "meta"
    # Not guarded when nested under a different H2.
    assert ca.classify_kind("Challenges in microservices architectures", "Solution") == "cost"
    # Not guarded when the heading is itself the "Context and problem" H2 (no parent).
    assert ca.classify_kind("Context and problem", None) is None


# ---------------------------------------------------------------------------
# FR-009: item-level bullet splitting, all five label forms
# ---------------------------------------------------------------------------

def test_item_level_split_covers_all_five_bold_label_forms():
    body = (
        "- **Independent scaling.** Read and write workloads can scale independently.\n"
        "- **Optimized data schemas:** the read side can use a different schema.\n"
        "- **Complexity**. The basic idea is simple but can grow complex.\n"
        "- **Messaging**: requests must be routed correctly.\n"
        "- **Team ownership** clear ownership boundaries emerge.\n"
    )
    items, remainder_pieces = ca.split_items(body)
    labels = [item.label for item in items]
    assert labels == [
        "Independent scaling",
        "Optimized data schemas",
        "Complexity",
        "Messaging",
        "Team ownership",
    ]
    # item.body is a direct slice of the source (through the start of the next
    # top-level bullet), so it may carry a trailing newline — .strip() it for
    # the content comparison, same as the real pipeline's _emit() does.
    assert items[0].body.strip() == "Read and write workloads can scale independently."
    assert items[0].body in body  # substring by construction
    assert remainder_pieces == []


def test_item_level_split_leaves_non_matching_bullets_in_remainder():
    body = (
        "- **Complexity.** The basic idea is simple but can grow complex.\n"
        "- Just a plain bullet with no bold label at all.\n"
    )
    items, remainder_pieces = ca.split_items(body)
    assert len(items) == 1
    assert items[0].label == "Complexity"
    assert any("Just a plain bullet with no bold label at all." in piece for piece in remainder_pieces)
    for piece in remainder_pieces:
        assert piece in body  # every remainder piece is a substring of the source


# ---------------------------------------------------------------------------
# FR-010: Workload design discard (recognized, not unmapped, no chunk)
# ---------------------------------------------------------------------------

def test_workload_design_is_discarded_but_recognized():
    assert ca.classify_kind("Workload design", None) == "meta"
    assert ca.is_discarded_section("Workload design") is True
    assert ca.is_discarded_section("Related resources") is False


# ---------------------------------------------------------------------------
# FR-011: directive-line stripping
# ---------------------------------------------------------------------------

def test_directive_lines_are_stripped():
    body = 'Some text.\n:::image type="content" source="./_images/x.png":::\nMore text.\n'
    result = ca.strip_directives(body)
    assert ":::" not in result
    assert "Some text." in result
    assert "More text." in result


# ---------------------------------------------------------------------------
# FR-012: verbatim link retention + separate extraction (not a content edit)
# ---------------------------------------------------------------------------

def test_links_are_never_stripped_from_content():
    body = "See [Event Sourcing pattern](./event-sourcing.md) for a common complement."
    # strip_directives is the only content transformation permitted (FR-014) —
    # it must leave link markup fully intact.
    assert ca.strip_directives(body) == body


def test_extract_links_captures_text_and_target_without_mutating_input():
    body = "See [Event Sourcing pattern](./event-sourcing.md) and [Saga](./saga-content.md)."
    links = ca.extract_links(body)
    assert links == [
        ("Event Sourcing pattern", "./event-sourcing.md"),
        ("Saga", "./saga-content.md"),
    ]


# ---------------------------------------------------------------------------
# FR-013 / FR-013a: context prefix, full ancestor chain for H3
# ---------------------------------------------------------------------------

def test_context_prefix_h2_format():
    prefix = ca.build_context_prefix("CQRS", ["Problems and considerations"])
    assert prefix == "[CQRS pattern / Problems and considerations]"


def test_context_prefix_h3_includes_full_ancestor_chain():
    prefix = ca.build_context_prefix(
        "CQRS",
        ["Combine the Event Sourcing and CQRS patterns", "Benefits of combining the Event Sourcing and CQRS patterns"],
    )
    assert prefix == (
        "[CQRS pattern / Combine the Event Sourcing and CQRS patterns / "
        "Benefits of combining the Event Sourcing and CQRS patterns]"
    )


# ---------------------------------------------------------------------------
# FR-014: no-rewrite guarantee (spot-checked at the module-function level)
# ---------------------------------------------------------------------------

def test_strip_directives_does_not_alter_surrounding_prose_characters():
    body = "Line one stays exactly the same.\nLine two also stays exactly the same.\n"
    assert ca.strip_directives(body) == body


# ---------------------------------------------------------------------------
# FR-015: frontmatter doc_date capture, null when absent
# ---------------------------------------------------------------------------

def test_doc_date_parsed_from_frontmatter():
    frontmatter = ca.parse_frontmatter(CQRS_FIXTURE)
    assert ca.parse_doc_date(frontmatter) == "2025-02-20"


def test_doc_date_is_none_when_frontmatter_absent():
    text = "## Context and problem\n\nNo frontmatter at all here.\n"
    frontmatter = ca.parse_frontmatter(text)
    assert frontmatter == {}
    assert ca.parse_doc_date(frontmatter) is None


# ---------------------------------------------------------------------------
# FR-023: concept_id normalization (blocking correctness — DESIGN.md §12 #2)
# ---------------------------------------------------------------------------

def test_concept_id_strips_content_suffix():
    assert ca.derive_concept_id("retry-content") == "retry"
    assert ca.derive_concept_id("saga-content") == "saga"


def test_concept_id_strips_pattern_suffix():
    assert ca.derive_concept_id("rate-limiting-pattern") == "rate-limiting"


def test_concept_id_unchanged_when_no_suffix():
    assert ca.derive_concept_id("cqrs") == "cqrs"


def test_display_name_from_frontmatter_title_strips_pattern_suffix():
    frontmatter = {"title": "CQRS Pattern"}
    assert ca.derive_display_name("cqrs", frontmatter) == "CQRS"


def test_display_name_falls_back_to_humanized_concept_id_when_no_frontmatter():
    # The -content/-pattern-suffixed files have no frontmatter at all
    # (confirmed by inspection, data-model.md's conceptId row) — this is the
    # fallback path those files actually take.
    assert ca.derive_display_name("retry", {}) == "Retry"
    assert ca.derive_display_name("materialized-view", {}) == "Materialized View"


# ---------------------------------------------------------------------------
# chunk_id: label-derived slug, not positional (FR-005, data-model.md)
# ---------------------------------------------------------------------------

def test_chunk_id_is_slug_based_not_positional():
    chunk_id = ca.build_chunk_id("cqrs", "cost", ca.slugify("Eventual consistency"))
    assert chunk_id == "azure:cqrs:cost:eventual-consistency"


def test_chunk_id_stable_when_a_new_item_is_inserted_above_an_existing_one():
    # spec.md acceptance scenario 11: inserting a new item above an existing
    # one must not change the existing item's chunk_id.
    body_before = "- **Eventual consistency.** The read side may lag behind.\n"
    body_after = (
        "- **New first item.** Something new.\n"
        "- **Eventual consistency.** The read side may lag behind.\n"
    )
    items_before, _ = ca.split_items(body_before)
    items_after, _ = ca.split_items(body_after)
    id_before = ca.build_chunk_id("cqrs", "cost", ca.slugify(items_before[0].label))
    id_after = ca.build_chunk_id("cqrs", "cost", ca.slugify(items_after[1].label))
    assert id_before == id_after == "azure:cqrs:cost:eventual-consistency"


# ---------------------------------------------------------------------------
# End-to-end: chunk_file() over the CQRS fixture
# ---------------------------------------------------------------------------

def test_chunk_file_end_to_end_on_cqrs_fixture(tmp_path):
    fixture_path = tmp_path / "cqrs.md"
    fixture_path.write_text(CQRS_FIXTURE, encoding="utf-8")

    result = ca.chunk_file(fixture_path, "cqrs")

    kinds = {c["kind"] for c in result["chunks"]}
    assert "benefit" in kinds
    assert "cost" in kinds
    assert "when" in kinds

    # SC-004: the H3-nested benefit content is recovered, not lost inside Solution.
    benefit_chunks = [c for c in result["chunks"] if c["kind"] == "benefit"]
    assert any("Independent scaling" in c["label"] or "independent-scaling" in c["chunkId"] for c in benefit_chunks)

    # SC-001: every chunk's content is a verbatim substring of the source file.
    for chunk in result["chunks"]:
        assert chunk["content"] in CQRS_FIXTURE
        # and the prefix must never be inside content (FR-013 / the fix-4 gap)
        assert chunk["contextPrefix"] not in chunk["content"]

    # FR-012: the cost item containing a markdown link keeps it byte-for-byte.
    messaging = next(c for c in result["chunks"] if "Messaging" in c.get("label", ""))
    assert "[Event Sourcing pattern](./event-sourcing.md)" in messaging["content"]

    # Workload design: recognized, not unmapped, produces no chunk.
    assert "Workload design" not in result["unmapped_headings"]
    assert not any(c["label"] == "Workload design" for c in result["chunks"])

    # doc_date captured from frontmatter.
    assert result["doc_date"] == "2025-02-20"

    # related-link target captured for candidate generation, without mutating content.
    assert "./event-sourcing.md" in result["related_targets"]


def test_chunk_file_idempotent_chunk_ids_across_two_runs(tmp_path):
    fixture_path = tmp_path / "cqrs.md"
    fixture_path.write_text(CQRS_FIXTURE, encoding="utf-8")
    result_a = ca.chunk_file(fixture_path, "cqrs")
    result_b = ca.chunk_file(fixture_path, "cqrs")
    ids_a = sorted(c["chunkId"] for c in result_a["chunks"])
    ids_b = sorted(c["chunkId"] for c in result_b["chunks"])
    assert ids_a == ids_b


# ---------------------------------------------------------------------------
# FR-020 / FR-021 / FR-022: unmapped-headings tracking (User Story 2)
# ---------------------------------------------------------------------------

def test_unmapped_heading_is_tracked_with_occurrence_and_not_a_matched_one(tmp_path):
    text = """## Related patterns

Some unrelated list of links.

## Benefits

- **Speed.** It's faster.
"""
    fixture_path = tmp_path / "some-pattern.md"
    fixture_path.write_text(text, encoding="utf-8")
    result = ca.chunk_file(fixture_path, "some-pattern")
    assert "Related patterns" in result["unmapped_headings"]
    assert "Benefits" not in result["unmapped_headings"]


def test_matched_but_discarded_heading_is_not_unmapped(tmp_path):
    text = "## Workload design\n\nCross-references only.\n"
    fixture_path = tmp_path / "some-pattern.md"
    fixture_path.write_text(text, encoding="utf-8")
    result = ca.chunk_file(fixture_path, "some-pattern")
    assert "Workload design" not in result["unmapped_headings"]


def test_build_unmapped_report_ranks_by_frequency_descending():
    counts = {"Related patterns": 2, "Components": 5, "Workflow": 1}
    report = ca.build_unmapped_report(counts)
    idx_components = report.index("Components")
    idx_related = report.index("Related patterns")
    idx_workflow = report.index("Workflow")
    assert idx_components < idx_related < idx_workflow


def test_build_unmapped_report_states_zero_explicitly_when_empty():
    report = ca.build_unmapped_report({})
    assert "0" in report or "none" in report.lower() or "no unmapped" in report.lower()


# ---------------------------------------------------------------------------
# FR-023 / SC-005: concept candidate generation (User Story 3)
# ---------------------------------------------------------------------------

def test_is_concept_eligible_matches_sc005_exactly():
    assert ca.is_concept_eligible("docs/patterns/cqrs.md") is True
    assert ca.is_concept_eligible("docs/patterns/retry-content.md") is True
    assert ca.is_concept_eligible("docs/guide/architecture-styles/microservices.md") is True
    assert ca.is_concept_eligible("docs/patterns/index.md") is False
    assert ca.is_concept_eligible("docs/guide/index.md") is False
    assert ca.is_concept_eligible("docs/guide/architecture-styles/index.md") is False
    assert ca.is_concept_eligible("README.md") is False
    assert ca.is_concept_eligible("CONTRIBUTING.md") is False
    assert ca.is_concept_eligible("SECURITY.md") is False
    assert ca.is_concept_eligible("docs/changelog.md") is False
    assert ca.is_concept_eligible("docs/guide/choose-azure-container-service.md") is False
    assert ca.is_concept_eligible("docs/guide/container-service-general-considerations.md") is False


def test_build_candidate_normalizes_related_link_targets_to_concept_ids():
    related = ca.normalize_related_targets({"./event-sourcing.md", "./saga-content.md", "https://external.example/x"})
    assert related == ["event-sourcing", "saga"]
