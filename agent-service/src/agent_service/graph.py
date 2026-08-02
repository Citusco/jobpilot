"""LangGraph StateGraph wiring.

Shape (translating the design agreed pre-stack-pivot in
specs/001-jd-training-directions/research.md #4, minus the old persistence node - see
specs/004-python-agent-orchestration/spec.md Assumptions):

    START -> extract_jd_structure -> (conditional edge on `sufficient`)
        -> reject_input -> END
        -> generate_candidate_directions -> END

Both branches reach their own terminal node explicitly, keeping each node
independently testable (Constitution Principle II) and the graph's own shape honest
about the two distinct terminal states.
"""

from typing import Any

from langchain_core.runnables import Runnable
from langgraph.graph import END, START, StateGraph

from agent_service.llm import build_chat_model
from agent_service.nodes import make_extract_node, make_generate_directions_node, reject_input
from agent_service.schemas import DirectionsLLMOutput, ExtractionLLMOutput, GraphState


def _route_on_sufficient(state: GraphState) -> str:
    return "generate_candidate_directions" if state.sufficient else "reject_input"


def _wire_graph(
    extract_structured: Runnable[Any, Any], directions_structured: Runnable[Any, Any]
) -> Any:
    """Builds and compiles the StateGraph from two already-structured-output-bound
    Runnables. Split out from build_graph() so tests can exercise the real conditional
    edge routing (FR-004) with fake Runnables, without needing a real ChatOpenAI client
    (which requires a real OPENAI_API_KEY to construct) - see tests/unit/test_graph.py."""
    graph = StateGraph(GraphState)
    # mypy can't structurally match a closure returned from a factory function against
    # LangGraph's add_node overloads (a plain top-level function like reject_input below
    # matches fine) - verified correct at runtime via the graph-compile smoke test in
    # quickstart.md and the passing contract test; not a real type-safety gap.
    graph.add_node("extract_jd_structure", make_extract_node(extract_structured))  # type: ignore[call-overload]
    graph.add_node(  # type: ignore[call-overload]
        "generate_candidate_directions", make_generate_directions_node(directions_structured)
    )
    graph.add_node("reject_input", reject_input)

    graph.add_edge(START, "extract_jd_structure")
    graph.add_conditional_edges(
        "extract_jd_structure",
        _route_on_sufficient,
        {
            "generate_candidate_directions": "generate_candidate_directions",
            "reject_input": "reject_input",
        },
    )
    graph.add_edge("generate_candidate_directions", END)
    graph.add_edge("reject_input", END)

    return graph.compile()


def build_graph() -> Any:
    """Returns a CompiledStateGraph. Typed as Any: LangGraph's CompiledStateGraph generic
    signature is verbose/internal-shaped and pinning it precisely here would be fragile
    against library upgrades for no real type-safety benefit at this module boundary -
    callers only ever call .invoke(dict) -> dict on it (see main.py's get_graph)."""
    model = build_chat_model()
    extract_structured = model.with_structured_output(
        ExtractionLLMOutput, method="json_schema", include_raw=True
    )
    directions_structured = model.with_structured_output(
        DirectionsLLMOutput, method="json_schema", include_raw=True
    )
    return _wire_graph(extract_structured, directions_structured)
