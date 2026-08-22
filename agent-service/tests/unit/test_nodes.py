"""Unit tests for the extraction node, provider mocked (Constitution Principle II).

Replaces test_extract_jd_structure.py and test_generate_candidate_directions.py: the
role/tech-stack/seniority extraction and the directions generator are both gone with the
pipeline they served (FR-020), and there is no reject node left to route to.
"""

import pytest
from langchain_core.runnables import RunnableLambda

from agent_service.nodes import AgentLLMError, make_extract_items_node
from agent_service.schemas import ExtractedItemLLM, GraphState, ItemsLLMOutput

JD_TEXT = (
    "We are hiring a Backend Engineer. Responsibilities include operating "
    "Queue-Based Load Leveling between services and tuning a message broker. "
    "Must hold citizenship and be located in Sydney."
)


def _fake_structured_model(parsed, parsing_error=None):
    def _invoke(_inputs):
        return {"raw": None, "parsed": parsed, "parsing_error": parsing_error}

    return RunnableLambda(_invoke)


def test_returns_items_with_surface_and_evidence():
    parsed = ItemsLLMOutput(
        items=[
            ExtractedItemLLM(
                surface="Queue-Based Load Leveling",
                evidence=["operating Queue-Based Load Leveling between services"],
            ),
            ExtractedItemLLM(surface="message broker", evidence=["tuning a message broker"]),
        ]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text=JD_TEXT))

    assert [item.surface for item in result["items"]] == [
        "Queue-Based Load Leveling",
        "message broker",
    ]
    assert result["items"][0].evidence == [
        "operating Queue-Based Load Leveling between services"
    ]


def test_returns_an_empty_list_for_a_posting_with_no_technical_content():
    # FR-004: absence is reported per item, never as a whole-submission verdict. There is
    # no `sufficient` flag left to set, so the only honest answer is an empty list.
    node = make_extract_items_node(_fake_structured_model(ItemsLLMOutput(items=[])))

    result = node(GraphState(jd_text="We are a friendly team looking for a great person."))

    assert result["items"] == []


def test_surface_is_returned_unnormalised():
    # contracts/extract.md: normalising here would create a second normalizeTerm on the
    # Python side, and two implementations that drift produce lookups that silently
    # return nothing. The node must hand the caller the phrase exactly as written.
    parsed = ItemsLLMOutput(
        items=[
            ExtractedItemLLM(
                surface="Queue-Based Load Leveling",
                evidence=["operating Queue-Based Load Leveling between services"],
            )
        ]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text=JD_TEXT))

    assert result["items"][0].surface == "Queue-Based Load Leveling"


def test_raises_when_evidence_is_paraphrased_rather_than_quoted():
    # The evidence span must be findable in the posting it claims to come from. A model
    # that rewrites the sentence instead of quoting it must fail here, not become a
    # stored evidence value that cannot be located in the source text.
    parsed = ItemsLLMOutput(
        items=[
            ExtractedItemLLM(
                surface="message broker",
                evidence=["the role involves working with message brokers"],
            )
        ]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    with pytest.raises(AgentLLMError):
        node(GraphState(jd_text=JD_TEXT))


def test_raises_when_the_llm_call_itself_fails():
    def _raising_invoke(_inputs):
        raise TimeoutError("simulated network timeout")

    node = make_extract_items_node(RunnableLambda(_raising_invoke))

    with pytest.raises(AgentLLMError):
        node(GraphState(jd_text=JD_TEXT))


def test_raises_when_llm_output_fails_schema_validation():
    node = make_extract_items_node(
        _fake_structured_model(parsed=None, parsing_error=ValueError("bad shape"))
    )

    with pytest.raises(AgentLLMError):
        node(GraphState(jd_text=JD_TEXT))


def test_raises_when_re_validation_fails_despite_a_successful_parse():
    # Defense in depth (research.md #3): with_structured_output reports a successful
    # parse but hands back an object that does not satisfy ItemsLLMOutput -- here an item
    # whose evidence list is empty, which model_construct lets past the field bound.
    bogus = ItemsLLMOutput.model_construct(
        items=[ExtractedItemLLM.model_construct(surface="message broker", evidence=[])]
    )
    node = make_extract_items_node(_fake_structured_model(bogus))

    with pytest.raises(AgentLLMError):
        node(GraphState(jd_text=JD_TEXT))


WRAPPED_JD = (
    "We are hiring a Backend Engineer. You will own gateway\n"
    "aggregation across the estate, operate a Circuit Breaker around\n"
    "third-party calls, and run Kubernetes in production."
)


def test_accepts_a_span_whose_only_difference_is_the_posting_s_line_wrapping():
    # Measured: POST /jd-submissions failed roughly one time in three on long postings,
    # because the model returns the span with the posting's hard line break collapsed to
    # a space. The guard was right to refuse it -- the paraphrase check is the whole
    # reason evidence can be trusted -- but a line break is not a paraphrase.
    parsed = ItemsLLMOutput(
        items=[
            ExtractedItemLLM(
                surface="gateway aggregation",
                evidence=["own gateway aggregation across the estate"],
            )
        ]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text=WRAPPED_JD))

    # Stored as the posting wrote it, newline included: the caller's own substring check
    # runs against the same text, and a stored span that is not literally in the posting
    # cannot be located in it later.
    assert result["items"][0].evidence == ["own gateway\naggregation across the estate"]
    assert result["items"][0].evidence[0] in WRAPPED_JD


def test_realigns_every_span_of_every_item_independently():
    parsed = ItemsLLMOutput(
        items=[
            ExtractedItemLLM(
                surface="Circuit Breaker",
                evidence=[
                    "operate a Circuit Breaker around third-party calls",
                    "run Kubernetes in production.",
                ],
            )
        ]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text=WRAPPED_JD))

    assert result["items"][0].evidence == [
        "operate a Circuit Breaker around\nthird-party calls",
        "run Kubernetes in production.",
    ]
    assert all(span in WRAPPED_JD for span in result["items"][0].evidence)


def test_still_refuses_a_paraphrase_that_whitespace_cannot_explain():
    # The relaxation is whitespace and nothing else. A span that differs in its words is
    # still a paraphrase, and hard constraint 1 says it must fail here.
    parsed = ItemsLLMOutput(
        items=[
            ExtractedItemLLM(
                surface="gateway aggregation",
                evidence=["owns gateway aggregation for the whole estate"],
            )
        ]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    with pytest.raises(AgentLLMError):
        node(GraphState(jd_text=WRAPPED_JD))


def test_leaves_a_span_that_already_matches_exactly_untouched():
    parsed = ItemsLLMOutput(
        items=[
            ExtractedItemLLM(
                surface="Kubernetes",
                evidence=["run Kubernetes in production."],
            )
        ]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    result = node(GraphState(jd_text=WRAPPED_JD))

    assert result["items"][0].evidence == ["run Kubernetes in production."]


def test_refuses_a_span_that_is_only_whitespace():
    parsed = ItemsLLMOutput.model_construct(
        items=[ExtractedItemLLM.model_construct(surface="nothing", evidence=["   "])]
    )
    node = make_extract_items_node(_fake_structured_model(parsed))

    with pytest.raises(AgentLLMError):
        node(GraphState(jd_text=WRAPPED_JD))
