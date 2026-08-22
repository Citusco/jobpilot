"""Graph topology tests.

    before   START -> extract_jd_structure -> (sufficient?) -> generate_candidate_directions
                                                            -> reject_input
    after    START -> extract_items -> END

The conditional edge and both downstream nodes are gone. The point of asserting on the
compiled topology rather than only on an invoke() result is that FR-022 forbids the
sufficiency gate coming back in another form -- a conditional edge reappearing here is
exactly what that would look like.
"""

from langchain_core.runnables import RunnableLambda

from agent_service.graph import _wire_graph
from agent_service.schemas import ExtractedItemLLM, ItemsLLMOutput

JD_TEXT = "Responsibilities include tuning a message broker."


def _fake_model(parsed):
    def _invoke(_inputs):
        return {"raw": None, "parsed": parsed, "parsing_error": None}

    return RunnableLambda(_invoke)


def _items_parsed() -> ItemsLLMOutput:
    return ItemsLLMOutput(
        items=[ExtractedItemLLM(surface="message broker", evidence=["tuning a message broker"])]
    )


def test_graph_has_exactly_one_node_between_start_and_end():
    graph = _wire_graph(_fake_model(_items_parsed()))

    drawn = graph.get_graph()
    node_names = {name for name in drawn.nodes if not name.startswith("__")}

    assert node_names == {"extract_items"}


def test_graph_has_no_conditional_edge_and_no_reject_path():
    graph = _wire_graph(_fake_model(_items_parsed()))

    drawn = graph.get_graph()

    assert not any(edge.conditional for edge in drawn.edges)
    assert all("reject" not in name for name in drawn.nodes)


def test_graph_returns_items_in_state():
    graph = _wire_graph(_fake_model(_items_parsed()))

    result = graph.invoke({"jd_text": JD_TEXT})

    assert [item.surface for item in result["items"]] == ["message broker"]


def test_graph_returns_an_empty_item_list_without_rejecting_the_submission():
    # FR-004: a posting with no technical content still runs the whole graph and comes
    # back with an empty list. There is no branch that can refuse it.
    graph = _wire_graph(_fake_model(ItemsLLMOutput(items=[])))

    result = graph.invoke({"jd_text": "We are a friendly team looking for a great person."})

    assert result["items"] == []
