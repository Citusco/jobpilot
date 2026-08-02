from langchain_core.runnables import RunnableLambda

from agent_service.nodes import AgentLLMError, make_extract_node
from agent_service.schemas import ExtractionLLMOutput, GraphState


def _fake_structured_model(parsed, parsing_error=None):
    def _invoke(_inputs):
        return {"raw": None, "parsed": parsed, "parsing_error": parsing_error}

    return RunnableLambda(_invoke)


def test_returns_sufficient_extraction():
    parsed = ExtractionLLMOutput(
        sufficient=True,
        role="Backend Engineer",
        tech_stack=["Node.js", "PostgreSQL"],
        seniority="Senior",
        seniority_inferred=False,
    )
    node = make_extract_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text="Senior Backend Engineer, Node.js, PostgreSQL"))

    assert result["sufficient"] is True
    assert result["role"] == "Backend Engineer"
    assert result["tech_stack"] == ["Node.js", "PostgreSQL"]
    assert result["seniority"] == "Senior"
    assert result["seniority_inferred"] is False
    assert result["insufficient_reason"] is None


def test_returns_insufficient_reason():
    parsed = ExtractionLLMOutput(sufficient=False, insufficient_reason="JD text is too short")
    node = make_extract_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text="hi"))

    assert result["sufficient"] is False
    assert result["insufficient_reason"] == "JD text is too short"
    assert result["role"] is None


def test_raises_when_llm_output_fails_schema_validation():
    node = make_extract_node(
        _fake_structured_model(parsed=None, parsing_error=ValueError("bad shape"))
    )

    try:
        node(GraphState(jd_text="Senior Backend Engineer, Node.js"))
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass
