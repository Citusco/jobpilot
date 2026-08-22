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

import re
from collections.abc import Callable
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import Runnable

from agent_service.schemas import GraphState, ItemsLLMOutput


class AgentLLMError(Exception):
    """Raised when the underlying LLM call fails or returns output that fails schema
    validation (constitution Principle I: raw/invalid output must never be passed
    through)."""


_WHITESPACE = re.compile(r"\s+")


def _realign(span: str, jd_text: str, surface: str) -> str:
    """Return the posting's own wording for `span`, or raise if there is none.

    An exact substring is returned unchanged. Otherwise the span and the posting are both
    compared with runs of whitespace treated as equal, and the matching region of the
    *posting* is returned -- never the model's rewrapped version of it. Anything that
    differs by more than whitespace is a paraphrase and still fails, which is hard
    constraint 1 and the reason evidence is worth anything.
    """
    if span in jd_text:
        return span

    needle = _WHITESPACE.sub(" ", span).strip()
    if needle == "":
        raise AgentLLMError(
            f"extract_items: evidence for {surface!r} is empty once whitespace is removed"
        )

    # Collapse the posting the same way, keeping an index from every character of the
    # collapsed form back to where it came from. That is what makes it possible to return
    # the posting's own text rather than the model's rewrapped copy of it -- the whole
    # point of the guard is that a stored span can be located in the source later.
    collapsed: list[str] = []
    origin: list[int] = []
    position = 0
    while position < len(jd_text):
        if jd_text[position].isspace():
            run = position
            while run < len(jd_text) and jd_text[run].isspace():
                run += 1
            collapsed.append(" ")
            origin.append(position)
            position = run
        else:
            collapsed.append(jd_text[position])
            origin.append(position)
            position += 1
    haystack = "".join(collapsed)

    found = haystack.find(needle)
    if found == -1:
        raise AgentLLMError(
            f"extract_items: evidence for {surface!r} is not a substring "
            f"of the submitted text: {span!r}"
        )
    # `needle` is stripped, so its last character is never a collapsed whitespace run and
    # the end offset is exact.
    return jd_text[origin[found] : origin[found + len(needle) - 1] + 1]


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
        #
        # The comparison ignores how whitespace is broken up, and only that. Measured:
        # roughly one long posting in three failed here because the model returned the
        # span with the posting's hard line break collapsed to a space. That is not a
        # paraphrase, and refusing it made a correct extraction look like a 502. What is
        # kept is always the posting's own text, so the caller's identical substring check
        # still passes and a stored span can still be located in the source.
        for item in validated.items:
            item.evidence = [
                _realign(span, state.jd_text, item.surface) for span in item.evidence
            ]

        return {"items": validated.items}

    return extract_items
