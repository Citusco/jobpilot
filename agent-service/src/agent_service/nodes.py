"""LangGraph node functions.

Each node is built by a factory (make_extract_node / make_generate_directions_node)
that takes an already-structured-output-bound Runnable rather than constructing its
own ChatOpenAI client. This keeps the nodes independently unit-testable (Constitution
Principle II) by injecting a fake Runnable (e.g. langchain_core.runnables.RunnableLambda)
in tests, without needing to mock ChatOpenAI/LangChain internals - graph.py wires the
real `model.with_structured_output(...)` Runnable in production.

extract_jd_structure and generate_candidate_directions are different functional units
(different prompts, different LLM calls, different business logic) - kept in this one
file since both are "graph node" concerns, but each is its own factory/function, not
merged into shared logic that would blur what each node actually does.
"""

from collections.abc import Callable
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable

from agent_service.schemas import (
    DirectionLLMItem,
    DirectionsLLMOutput,
    ExtractionLLMOutput,
    GraphState,
)


class AgentLLMError(Exception):
    """Raised when the underlying LLM call fails or returns output that fails schema
    validation (constitution Principle I: raw/invalid output must never be passed
    through)."""


_EXTRACT_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You extract structured information from job description (JD) text. "
            "Determine the role, tech stack, and seniority level. If the JD text does "
            "not contain enough information to identify a role and tech stack, set "
            "sufficient=false and explain why in insufficient_reason. If seniority is "
            "not explicitly stated, infer it and set seniority_inferred=true.",
        ),
        ("human", "{jd_text}"),
    ]
)

_GENERATE_DIRECTIONS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Given a structured JD extraction and the full original JD text, recommend "
            "0 to 6 candidate technical training directions. Each direction MUST include "
            "a rationale that quotes or clearly references specific wording from the "
            "original JD text (not just the structured summary) - fabricated rationales "
            "not traceable to the JD text are not acceptable.",
        ),
        (
            "human",
            "Role: {role}\nTech stack: {tech_stack}\nSeniority: {seniority}\n\n"
            "Full JD text:\n{jd_text}",
        ),
    ]
)


def make_extract_node(
    structured_model: Runnable[Any, Any],
) -> Callable[[GraphState], dict[str, Any]]:
    chain = _EXTRACT_PROMPT | structured_model

    def extract_jd_structure(state: GraphState) -> dict[str, Any]:
        result = chain.invoke({"jd_text": state.jd_text})
        parsed = result.get("parsed")
        if parsed is None:
            raise AgentLLMError(
                f"extract_jd_structure: LLM did not return valid structured output: "
                f"{result.get('parsing_error')}"
            )
        # Explicit re-validation before writing to state (research.md #3): LangGraph
        # validates state on node *input*, not on what a node *returns* before merging -
        # this guards that gap, it is not distrust of with_structured_output itself.
        validated = ExtractionLLMOutput.model_validate(parsed.model_dump())
        return {
            "sufficient": validated.sufficient,
            "insufficient_reason": validated.insufficient_reason,
            "role": validated.role,
            "tech_stack": validated.tech_stack,
            "seniority": validated.seniority,
            "seniority_inferred": validated.seniority_inferred,
        }

    return extract_jd_structure


def make_generate_directions_node(
    structured_model: Runnable[Any, Any],
) -> Callable[[GraphState], dict[str, Any]]:
    chain = _GENERATE_DIRECTIONS_PROMPT | structured_model

    def generate_candidate_directions(state: GraphState) -> dict[str, Any]:
        result = chain.invoke(
            {
                "role": state.role,
                "tech_stack": state.tech_stack,
                "seniority": state.seniority,
                "jd_text": state.jd_text,
            }
        )
        parsed = result.get("parsed")
        if parsed is None:
            raise AgentLLMError(
                f"generate_candidate_directions: LLM did not return valid structured "
                f"output: {result.get('parsing_error')}"
            )
        validated = DirectionsLLMOutput.model_validate(parsed.model_dump())
        directions: list[DirectionLLMItem] = validated.directions
        return {"directions": directions}

    return generate_candidate_directions


def reject_input(state: GraphState) -> dict[str, Any]:
    """Trivial terminal node for the insufficient-information branch - no LLM call,
    just passes the reason through. Not unit-tested separately since it has no real
    logic; exercised via the graph-level contract test instead."""
    return {"directions": []}
