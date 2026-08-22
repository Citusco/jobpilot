"""LangGraph node functions.

The node is built by a factory (make_extract_items_node) that takes an
already-structured-output-bound Runnable rather than constructing its own ChatOpenAI
client. This keeps the node independently unit-testable (Constitution Principle II) by
injecting a fake Runnable (e.g. langchain_core.runnables.RunnableLambda) in tests,
without needing to mock ChatOpenAI/LangChain internals - graph.py wires the real
`model.with_structured_output(...)` Runnable in production.

make_extract_node, make_generate_directions_node and reject_input are gone with the
training-directions pipeline (FR-020). There is no branch left: this service reports what
a posting mentions and never judges whether that is enough (FR-004, FR-022).
"""

from collections.abc import Callable
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable

from agent_service.schemas import GraphState, ItemsLLMOutput


class AgentLLMError(Exception):
    """Raised when the underlying LLM call fails or returns output that fails schema
    validation (constitution Principle I: raw/invalid output must never be passed
    through)."""


_EXTRACT_ITEMS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You list the technical items a job description mentions. A technical item "
            "is a technology, architectural pattern, practice, protocol, platform or "
            "engineering concept the role involves.\n\n"
            "Rules:\n"
            "- `surface` is the phrase exactly as the posting wrote it. Do not "
            "normalise it, expand it, correct its spelling, or substitute a canonical "
            "name. Report what the posting says.\n"
            "- `evidence` is one or more spans copied character for character from the "
            "posting. Quote, never paraphrase: a span that cannot be found verbatim in "
            "the submitted text is rejected.\n"
            "- If the same phrase is mentioned more than once, report it as one item "
            "with one evidence span per occurrence.\n"
            "- Do NOT report non-technical requirements: citizenship, security "
            "clearance, location, notice period, salary, soft skills, or application "
            "logistics.\n"
            "- If the posting mentions nothing technical, return an empty list. That is "
            "a valid answer, not a failure.",
        ),
        ("human", "{jd_text}"),
    ]
)


def make_extract_items_node(
    structured_model: Runnable[Any, Any],
) -> Callable[[GraphState], dict[str, Any]]:
    chain = _EXTRACT_ITEMS_PROMPT | structured_model

    def extract_items(state: GraphState) -> dict[str, Any]:
        try:
            result = chain.invoke({"jd_text": state.jd_text})
        except Exception as exc:  # noqa: BLE001 - re-raised as AgentLLMError below
            raise AgentLLMError(f"extract_items: LLM call failed: {exc}") from exc
        parsed = result.get("parsed")
        if parsed is None:
            raise AgentLLMError(
                f"extract_items: LLM did not return valid structured output: "
                f"{result.get('parsing_error')}"
            )
        # Explicit re-validation before writing to state (research.md #3): LangGraph
        # validates state on node *input*, not on what a node *returns* before merging -
        # this guards that gap, it is not distrust of with_structured_output itself.
        try:
            validated = ItemsLLMOutput.model_validate(parsed.model_dump())
        except Exception as exc:  # noqa: BLE001 - re-raised as AgentLLMError below
            raise AgentLLMError(f"extract_items: re-validation failed: {exc}") from exc

        # Every evidence span must be findable in the posting it claims to come from.
        # A model that paraphrases instead of quoting fails here rather than producing an
        # `evidence` value the caller stores and can never locate in the source text.
        # The caller's Zod schema asserts the same thing at the HTTP boundary; both sides
        # own it, because each is the last chance to catch it on its own side of the wire.
        for item in validated.items:
            for span in item.evidence:
                if span not in state.jd_text:
                    raise AgentLLMError(
                        f"extract_items: evidence for {item.surface!r} is not a substring "
                        f"of the submitted text: {span!r}"
                    )

        return {"items": validated.items}

    return extract_items
