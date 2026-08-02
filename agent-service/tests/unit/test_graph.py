from langchain_core.runnables import RunnableLambda

from agent_service.graph import _wire_graph
from agent_service.schemas import DirectionsLLMOutput, ExtractionLLMOutput


def _fake_model(parsed):
    def _invoke(_inputs):
        return {"raw": None, "parsed": parsed, "parsing_error": None}

    return RunnableLambda(_invoke)


def test_sufficient_routes_to_generate_directions():
    extract_parsed = ExtractionLLMOutput(
        sufficient=True,
        role="Backend Engineer",
        tech_stack=["Node.js"],
        seniority="Senior",
        seniority_inferred=False,
    )
    directions_invoked = {"called": False}

    def _directions_invoke(_inputs):
        directions_invoked["called"] = True
        return {"raw": None, "parsed": DirectionsLLMOutput(directions=[]), "parsing_error": None}

    graph = _wire_graph(_fake_model(extract_parsed), RunnableLambda(_directions_invoke))

    result = graph.invoke({"jd_text": "Senior Backend Engineer, Node.js"})

    assert directions_invoked["called"] is True
    assert result["sufficient"] is True


def test_insufficient_routes_to_reject_and_never_invokes_directions_model():
    # FR-004: insufficient input must be rejected without attempting to generate
    # candidate directions - assert the directions model is never even called, not just
    # that the final result looks right (catches wiring bugs like the wrong branch being
    # reachable, not just a routing function that happens to return the right string).
    extract_parsed = ExtractionLLMOutput(sufficient=False, insufficient_reason="too short")
    directions_invoked = {"called": False}

    def _directions_invoke(_inputs):
        directions_invoked["called"] = True
        return {"raw": None, "parsed": DirectionsLLMOutput(directions=[]), "parsing_error": None}

    graph = _wire_graph(_fake_model(extract_parsed), RunnableLambda(_directions_invoke))

    result = graph.invoke({"jd_text": "hi"})

    assert directions_invoked["called"] is False
    assert result["sufficient"] is False
    assert result["directions"] == []
