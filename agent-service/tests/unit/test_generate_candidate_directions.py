from langchain_core.runnables import RunnableLambda

from agent_service.nodes import AgentLLMError, make_generate_directions_node
from agent_service.schemas import DirectionLLMItem, DirectionsLLMOutput, GraphState


def _fake_structured_model(parsed, parsing_error=None):
    def _invoke(_inputs):
        return {"raw": None, "parsed": parsed, "parsing_error": parsing_error}

    return RunnableLambda(_invoke)


def _state() -> GraphState:
    return GraphState(
        jd_text="Senior Backend Engineer, Node.js, PostgreSQL",
        sufficient=True,
        role="Backend Engineer",
        tech_stack=["Node.js", "PostgreSQL"],
        seniority="Senior",
        seniority_inferred=False,
    )


def test_returns_directions_within_bound():
    parsed = DirectionsLLMOutput(
        directions=[
            DirectionLLMItem(
                name="API design",
                rationale="quoted from JD",
                tags=["api"],
                suggested_question_count=3,
            )
        ]
    )
    node = make_generate_directions_node(_fake_structured_model(parsed))

    result = node(_state())

    assert len(result["directions"]) == 1
    assert result["directions"][0].name == "API design"


def test_accepts_zero_directions():
    parsed = DirectionsLLMOutput(directions=[])
    node = make_generate_directions_node(_fake_structured_model(parsed))

    result = node(_state())

    assert result["directions"] == []


def test_raises_when_llm_output_fails_schema_validation():
    node = make_generate_directions_node(
        _fake_structured_model(parsed=None, parsing_error=ValueError("bad shape"))
    )

    try:
        node(_state())
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass
