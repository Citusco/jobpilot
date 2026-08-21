"""Pydantic schemas for this service.

Three distinct layers, kept deliberately separate (see
specs/004-python-agent-orchestration/research.md #3 and the architecture plan):

1. LLM output schemas (``ItemsLLMOutput``) - targets for ``with_structured_output``.
   Snake_case only, never serialized with a different casing, so no aliasing complexity
   needed here.
2. ``GraphState`` - the LangGraph state schema. Kept flat, snake_case, no nested aliased
   models and no aliases of its own, specifically to avoid the documented
   LangGraph+Pydantic footguns around generics/aliases in state schemas.
3. HTTP request/response schemas (``ExtractRequest``, ``ExtractResponse``) - constructed
   explicitly from ``GraphState`` in main.py, never handed to LangGraph.

The training-directions models this file used to carry (``ExtractionLLMOutput``,
``DirectionsLLMOutput``, ``Extraction``, ``CandidateDirection``, ``ExtractSufficient``,
``ExtractInsufficient``) are gone with the pipeline they served - FR-020. Nothing here
carries a sufficiency verdict any more: absence is an empty item list, per item, never a
judgment about the whole submission (FR-004, FR-022).
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

# Contract bounds (specs/007-jd-concept-graph/contracts/extract.md), not provider limits.
_MAX_ITEMS = 200
_MAX_EVIDENCE_SPANS = 10

# --- 1. LLM output schemas (with_structured_output targets) ---


class ExtractedItemLLM(BaseModel):
    """One technical phrase the posting mentions, with the text that justifies it.

    ``surface`` is the phrase as the posting wrote it: not normalised, not expanded, not
    corrected. Normalisation belongs to the caller, which owns the single normalizeTerm
    implementation -- a second one here would drift and produce lookups that silently
    return nothing (docs/DECISIONS.md, 2026-08-10 concept_terms entry).
    """

    surface: str = Field(min_length=1)
    evidence: list[str] = Field(min_length=1, max_length=_MAX_EVIDENCE_SPANS)


class ItemsLLMOutput(BaseModel):
    """Target schema for the extract_items node's LLM call.

    An empty list is valid and is the correct answer for a posting with no technical
    content.
    """

    items: list[ExtractedItemLLM] = Field(default_factory=list, max_length=_MAX_ITEMS)


# --- 2. LangGraph state (flat, snake_case, no aliases) ---


class GraphState(BaseModel):
    jd_text: str
    items: list[ExtractedItemLLM] = Field(default_factory=list)


# --- 3. HTTP request/response schemas ---


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1)


class ExtractedItem(BaseModel):
    surface: str
    evidence: list[str]


class ExtractResponse(BaseModel):
    items: list[ExtractedItem]


# --- /embed (specs/006-corpus-structure-rebuild/contracts/embed.md) ---
#
# No LangGraph node involved -- a plain route, request/response only -- so
# these don't split into the three-layer structure above. Field bounds
# (1-256 texts, each non-empty and at most 8,000 chars) are the contract's
# own guard against an unbounded request, not a provider limit.

_MAX_EMBED_TEXTS = 256
_MAX_TEXT_CHARS = 8000


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=_MAX_EMBED_TEXTS)

    @field_validator("texts")
    @classmethod
    def _each_text_is_valid(cls, texts: list[str]) -> list[str]:
        for text in texts:
            if not text.strip():
                raise ValueError("each text must be non-empty after trimming")
            if len(text) > _MAX_TEXT_CHARS:
                raise ValueError(f"each text must be at most {_MAX_TEXT_CHARS} characters")
        return texts


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    model: str
    dimensions: int
