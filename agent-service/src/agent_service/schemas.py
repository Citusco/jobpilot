"""Pydantic schemas for this service.

Three distinct layers, kept deliberately separate (see
specs/004-python-agent-orchestration/research.md #3 and the architecture plan):

1. LLM output schemas (``ExtractionLLMOutput``, ``DirectionsLLMOutput``) - targets for
   ``with_structured_output``. Snake_case only, never serialized with a different casing,
   so no aliasing complexity needed here.
2. ``GraphState`` - the LangGraph state schema. Kept flat, snake_case, no nested aliased
   models and no aliases of its own, specifically to avoid the documented
   LangGraph+Pydantic footguns around generics/aliases in state schemas.
3. HTTP request/response schemas (``ExtractRequest``, ``ExtractSufficient``,
   ``ExtractInsufficient``) - these DO use aliases, to match the camelCase contract at
   specs/003-jd-extraction-nestjs-integration/contracts/agent-orchestration.yaml exactly.
   They are constructed explicitly from ``GraphState`` in main.py, never handed to
   LangGraph, so the footgun above does not apply to them.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# --- 1. LLM output schemas (with_structured_output targets) ---


class ExtractionLLMOutput(BaseModel):
    """Target schema for the extract_jd_structure node's LLM call."""

    sufficient: bool
    role: str | None = None
    tech_stack: list[str] | None = None
    seniority: str | None = None
    seniority_inferred: bool | None = None
    insufficient_reason: str | None = None


class DirectionLLMItem(BaseModel):
    name: str
    rationale: str
    tags: list[str] = Field(min_length=1)
    suggested_question_count: int = Field(gt=0)


class DirectionsLLMOutput(BaseModel):
    """Target schema for the generate_candidate_directions node's LLM call."""

    directions: list[DirectionLLMItem] = Field(max_length=6)


# --- 2. LangGraph state (flat, snake_case, no aliases) ---


class GraphState(BaseModel):
    jd_text: str
    sufficient: bool | None = None
    insufficient_reason: str | None = None
    role: str | None = None
    tech_stack: list[str] | None = None
    seniority: str | None = None
    seniority_inferred: bool | None = None
    directions: list[DirectionLLMItem] = Field(default_factory=list)


# --- 3. HTTP request/response schemas (aliased to match the camelCase contract) ---


class ExtractRequest(BaseModel):
    text: str = Field(min_length=1)


class Extraction(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    role: str
    tech_stack: list[str] = Field(alias="techStack")
    seniority: str
    seniority_inferred: bool = Field(alias="seniorityInferred")


class CandidateDirection(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    rationale: str
    tags: list[str] = Field(min_length=1)
    suggested_question_count: int = Field(alias="suggestedQuestionCount", gt=0)


class ExtractSufficient(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sufficient: Literal[True] = True
    extraction: Extraction
    directions: list[CandidateDirection] = Field(max_length=6)


class ExtractInsufficient(BaseModel):
    sufficient: Literal[False] = False
    reason: str


ExtractResponse = ExtractSufficient | ExtractInsufficient
