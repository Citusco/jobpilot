"""Contract tests for the reshaped POST /extract.

Replaces test_extract_endpoint.py. The endpoint keeps its path and changes its meaning:
technical items in place of a role/stack/seniority extraction, and no sufficiency verdict
at all (specs/007-jd-concept-graph/contracts/extract.md).
"""

from fastapi.testclient import TestClient

from agent_service.main import app, get_graph
from agent_service.nodes import AgentLLMError
from agent_service.schemas import ExtractedItemLLM

JD_TEXT = (
    "We are hiring a Backend Engineer. Responsibilities include operating "
    "Queue-Based Load Leveling between services and tuning a message broker."
)


class _FakeGraph:
    def __init__(self, result=None, error: Exception | None = None):
        self._result = result
        self._error = error
        self.invoked = False

    def invoke(self, _input):
        self.invoked = True
        if self._error is not None:
            raise self._error
        return self._result


client = TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.pop(get_graph, None)


def test_returns_200_with_items_matching_the_contract_shape():
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(
        result={
            "jd_text": JD_TEXT,
            "items": [
                ExtractedItemLLM(
                    surface="Queue-Based Load Leveling",
                    evidence=["operating Queue-Based Load Leveling between services"],
                ),
                ExtractedItemLLM(surface="message broker", evidence=["tuning a message broker"]),
            ],
        }
    )

    response = client.post("/extract", json={"text": JD_TEXT})

    assert response.status_code == 200
    assert response.json() == {
        "items": [
            {
                "surface": "Queue-Based Load Leveling",
                "evidence": ["operating Queue-Based Load Leveling between services"],
            },
            {"surface": "message broker", "evidence": ["tuning a message broker"]},
        ]
    }


def test_a_posting_with_no_technical_content_returns_200_with_an_empty_list():
    # FR-004 at the contract level: there is no `sufficient` field and no rejection
    # branch. Absence is an empty list, not a verdict about the whole submission.
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(
        result={"jd_text": "A friendly team.", "items": []}
    )

    response = client.post("/extract", json={"text": "A friendly team."})

    assert response.status_code == 200
    assert response.json() == {"items": []}


def test_response_carries_no_sufficiency_verdict():
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(
        result={"jd_text": "A friendly team.", "items": []}
    )

    body = client.post("/extract", json={"text": "A friendly team."}).json()

    assert "sufficient" not in body
    assert "reason" not in body
    assert "extraction" not in body
    assert "directions" not in body


def test_missing_text_returns_422_without_invoking_the_graph():
    graph = _FakeGraph(result={"jd_text": "", "items": []})
    app.dependency_overrides[get_graph] = lambda: graph

    response = client.post("/extract", json={})

    assert response.status_code == 422
    assert graph.invoked is False


def test_empty_text_returns_422_without_invoking_the_graph():
    graph = _FakeGraph(result={"jd_text": "", "items": []})
    app.dependency_overrides[get_graph] = lambda: graph

    response = client.post("/extract", json={"text": ""})

    assert response.status_code == 422
    assert graph.invoked is False


def test_llm_failure_returns_502():
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(
        error=AgentLLMError("upstream LLM call failed")
    )

    response = client.post("/extract", json={"text": JD_TEXT})

    assert response.status_code == 502
