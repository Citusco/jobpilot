"""LangGraph StateGraph wiring.

Shape (specs/007-jd-concept-graph/contracts/extract.md):

    START -> extract_items -> END

The conditional edge on `sufficient` and both downstream nodes are gone: the branch
existed only to serve the whole-submission sufficiency gate, which FR-004 replaces with
a per-item unresolved state and FR-022 forbids reinstating in another form.

A single-node graph is not an argument for removing LangGraph. The retry loop in
DESIGN.md section 6 is P1 and lands on this graph, and the state-machine wiring is what
it attaches to.
"""

from typing import Any

from langchain_core.runnables import Runnable
from langgraph.graph import END, START, StateGraph

from agent_service.llm import build_chat_model
from agent_service.nodes import make_extract_items_node
from agent_service.schemas import GraphState, ItemsLLMOutput


def _wire_graph(extract_structured: Runnable[Any, Any]) -> Any:
    """Builds and compiles the StateGraph from an already-structured-output-bound
    Runnable. Split out from build_graph() so tests can exercise the real topology with a
    fake Runnable, without needing a real ChatOpenAI client (which requires a real
    OPENAI_API_KEY to construct) - see tests/unit/test_graph.py."""
    graph = StateGraph(GraphState)
    # mypy can't structurally match a closure returned from a factory function against
    # LangGraph's add_node overloads - verified correct at runtime by the graph tests.
    graph.add_node("extract_items", make_extract_items_node(extract_structured))  # type: ignore[call-overload]

    graph.add_edge(START, "extract_items")
    graph.add_edge("extract_items", END)

    return graph.compile()


def build_graph() -> Any:
    """Returns a CompiledStateGraph. Typed as Any: LangGraph's CompiledStateGraph generic
    signature is verbose/internal-shaped and pinning it precisely here would be fragile
    against library upgrades for no real type-safety benefit at this module boundary -
    callers only ever call .invoke(dict) -> dict on it (see main.py's get_graph)."""
    model = build_chat_model()
    extract_structured = model.with_structured_output(
        ItemsLLMOutput, method="json_schema", include_raw=True
    )
    return _wire_graph(extract_structured)
