from langchain_core.runnables import RunnableLambda

from agent_service.nodes import AgentLLMError, make_generate_directions_node
from agent_service.schemas import (
    DirectionLLMItem,
    DirectionsLLMOutput,
    ExtractionLLMOutput,
    GraphState,
)


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


def test_raises_when_llm_call_itself_fails():
    def _raising_invoke(_inputs):
        raise TimeoutError("simulated network timeout")

    node = make_generate_directions_node(RunnableLambda(_raising_invoke))

    try:
        node(_state())
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass


def test_prompt_receives_full_jd_text():
    # FR-003: directions must be informed by the full original JD text, not a summary -
    # assert jd_text actually reaches the rendered prompt, so a regression that drops it
    # from _GENERATE_DIRECTIONS_PROMPT's variables would be caught. structured_model
    # sits downstream of the prompt in the LCEL chain, so it receives a rendered
    # ChatPromptValue, not the raw input dict.
    captured = {}

    def _capturing_invoke(prompt_value):
        captured["rendered"] = prompt_value.to_string()
        return {
            "raw": None,
            "parsed": DirectionsLLMOutput(directions=[]),
            "parsing_error": None,
        }

    node = make_generate_directions_node(RunnableLambda(_capturing_invoke))
    state = _state()

    node(state)

    assert state.jd_text in captured["rendered"]


def test_raises_when_more_than_six_directions_returned():
    # spec.md Edge Cases: more than 6 directions "MUST NOT be silently truncated,
    # coerced, or passed through partially valid". model_construct() bypasses
    # DirectionsLLMOutput's own max_length=6 validation to simulate ">6 directions"
    # somehow getting past with_structured_output's own parsing - the explicit
    # re-validation step (model_validate, which always validates) must be what actually
    # catches it.
    seven_items = [
        DirectionLLMItem(
            name=f"Direction {i}", rationale="r", tags=["t"], suggested_question_count=1
        )
        for i in range(7)
    ]
    bogus_parsed = DirectionsLLMOutput.model_construct(directions=seven_items)
    node = make_generate_directions_node(_fake_structured_model(bogus_parsed))

    try:
        node(_state())
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass


def test_raises_when_re_validation_fails_despite_successful_parse():
    # Same defense-in-depth gap as test_extract_jd_structure's equivalent test: parsed
    # is a real object (so with_structured_output "succeeded"), but it's the wrong
    # schema entirely - DirectionsLLMOutput requires a `directions` field that
    # ExtractionLLMOutput's model_dump() doesn't have.
    bogus_parsed = ExtractionLLMOutput.model_construct(sufficient=True, role="x")
    node = make_generate_directions_node(_fake_structured_model(bogus_parsed))

    try:
        node(_state())
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass
