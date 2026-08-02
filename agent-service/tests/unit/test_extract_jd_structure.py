import pytest
from langchain_core.runnables import RunnableLambda

from agent_service.nodes import AgentLLMError, make_extract_node
from agent_service.schemas import DirectionsLLMOutput, ExtractionLLMOutput, GraphState


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


def test_returns_sufficient_extraction_with_seniority_inferred():
    # Acceptance Scenario 1 explicitly calls out the seniority-inferred flag as part of
    # the sufficient response shape - the other test only ever exercises False.
    parsed = ExtractionLLMOutput(
        sufficient=True,
        role="Backend Engineer",
        tech_stack=["Node.js"],
        seniority="Mid-level",
        seniority_inferred=True,
    )
    node = make_extract_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text="Backend Engineer, Node.js"))

    assert result["seniority_inferred"] is True


def test_raises_when_llm_output_fails_schema_validation():
    node = make_extract_node(
        _fake_structured_model(parsed=None, parsing_error=ValueError("bad shape"))
    )

    try:
        node(GraphState(jd_text="Senior Backend Engineer, Node.js"))
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass


def test_raises_when_sufficient_true_but_all_required_fields_missing():
    # Defense-in-depth: simulates an LLM response that got past initial parsing
    # (model_construct bypasses ExtractionLLMOutput's own validator, standing in for a
    # provider/library quirk that let this through) but is internally inconsistent -
    # sufficient=True with every field missing. The explicit re-validation step must
    # catch this rather than let main.py construct an HTTP response from incomplete data.
    bogus_parsed = ExtractionLLMOutput.model_construct(
        sufficient=True, role=None, tech_stack=None, seniority=None, seniority_inferred=None
    )
    node = make_extract_node(_fake_structured_model(bogus_parsed))

    try:
        node(GraphState(jd_text="Senior Backend Engineer, Node.js"))
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass


@pytest.mark.parametrize("missing_field", ["role", "tech_stack", "seniority", "seniority_inferred"])
def test_raises_when_sufficient_true_but_a_single_field_is_missing(missing_field: str):
    # All-fields-missing alone can't distinguish the validator's correct `or` logic from
    # a hypothetical buggy `and` (which would also pass an all-missing case) - this
    # exercises one field missing at a time, which only the correct `or` logic catches.
    complete = {
        "sufficient": True,
        "role": "Backend Engineer",
        "tech_stack": ["Node.js"],
        "seniority": "Senior",
        "seniority_inferred": False,
    }
    complete[missing_field] = None
    bogus_parsed = ExtractionLLMOutput.model_construct(**complete)
    node = make_extract_node(_fake_structured_model(bogus_parsed))

    try:
        node(GraphState(jd_text="Senior Backend Engineer, Node.js"))
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass


def test_raises_when_insufficient_but_reason_missing():
    # Symmetric case to the sufficient=True validator above: sufficient=False with
    # insufficient_reason=None reaches main.py's ExtractInsufficient(reason=...), whose
    # `reason` field is a required str - same uncaught-ValidationError-to-raw-500 bug
    # class, just on the other branch.
    bogus_parsed = ExtractionLLMOutput.model_construct(sufficient=False, insufficient_reason=None)
    node = make_extract_node(_fake_structured_model(bogus_parsed))

    try:
        node(GraphState(jd_text="hi"))
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass


def test_raises_when_llm_call_itself_fails():
    def _raising_invoke(_inputs):
        raise TimeoutError("simulated network timeout")

    node = make_extract_node(RunnableLambda(_raising_invoke))

    try:
        node(GraphState(jd_text="Senior Backend Engineer, Node.js"))
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass


def test_raises_when_re_validation_fails_despite_successful_parse():
    # Simulates the defense-in-depth gap the explicit re-validation step guards against
    # (research.md #3): with_structured_output claims a successful parse and returns
    # *some* object, but it doesn't actually satisfy ExtractionLLMOutput's schema (here,
    # it's a DirectionsLLMOutput instance instead - its model_dump() has no `sufficient`
    # field, which ExtractionLLMOutput requires).
    bogus_parsed = DirectionsLLMOutput(directions=[])
    node = make_extract_node(_fake_structured_model(bogus_parsed))

    try:
        node(GraphState(jd_text="Senior Backend Engineer, Node.js"))
        assert False, "expected AgentLLMError to be raised"
    except AgentLLMError:
        pass
