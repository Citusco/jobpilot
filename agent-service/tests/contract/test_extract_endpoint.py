from fastapi.testclient import TestClient

from agent_service.main import app, get_graph
from agent_service.nodes import AgentLLMError
from agent_service.schemas import DirectionLLMItem


class _FakeGraph:
    def __init__(self, result=None, error: Exception | None = None):
        self._result = result
        self._error = error

    def invoke(self, _input):
        if self._error is not None:
            raise self._error
        return self._result


client = TestClient(app)


def teardown_function() -> None:
    app.dependency_overrides.pop(get_graph, None)


def test_sufficient_returns_200_matching_contract_shape():
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(
        result={
            "sufficient": True,
            "insufficient_reason": None,
            "role": "Backend Engineer",
            "tech_stack": ["Node.js"],
            "seniority": "Senior",
            "seniority_inferred": False,
            "directions": [
                DirectionLLMItem(
                    name="API design",
                    rationale="quoted from JD",
                    tags=["api"],
                    suggested_question_count=3,
                )
            ],
        }
    )

    response = client.post("/extract", json={"text": "a real JD text"})

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "sufficient": True,
        "extraction": {
            "role": "Backend Engineer",
            "techStack": ["Node.js"],
            "seniority": "Senior",
            "seniorityInferred": False,
        },
        "directions": [
            {
                "name": "API design",
                "rationale": "quoted from JD",
                "tags": ["api"],
                "suggestedQuestionCount": 3,
            }
        ],
    }


def test_insufficient_returns_200_with_reason():
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(
        result={
            "sufficient": False,
            "insufficient_reason": "JD text is too short",
            "role": None,
            "tech_stack": None,
            "seniority": None,
            "seniority_inferred": None,
            "directions": [],
        }
    )

    response = client.post("/extract", json={"text": "hi"})

    assert response.status_code == 200
    assert response.json() == {"sufficient": False, "reason": "JD text is too short"}


def test_missing_text_returns_422_without_invoking_graph():
    invoked = {"called": False}

    class _TrackingGraph(_FakeGraph):
        def invoke(self, _input):
            invoked["called"] = True
            return super().invoke(_input)

    app.dependency_overrides[get_graph] = lambda: _TrackingGraph(result={})

    response = client.post("/extract", json={})

    assert response.status_code == 422
    assert invoked["called"] is False


def test_empty_text_returns_422_without_invoking_graph():
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(result={})

    response = client.post("/extract", json={"text": ""})

    assert response.status_code == 422


def test_llm_failure_returns_502():
    app.dependency_overrides[get_graph] = lambda: _FakeGraph(
        error=AgentLLMError("upstream LLM call failed")
    )

    response = client.post("/extract", json={"text": "a real JD text"})

    assert response.status_code == 502
