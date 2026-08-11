import fastapi
import pytest
from fastapi.testclient import TestClient

import agent_service.main as main_module
from agent_service.embeddings import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL
from agent_service.main import app, get_embeddings_client
from agent_service.nodes import AgentLLMError
from agent_service.secrets import SecretLoadError

client = TestClient(app)


class _FakeEmbeddingsClient:
    def __init__(self, vectors=None, error: Exception | None = None):
        self._vectors = vectors
        self._error = error

    def embed_documents(self, texts):
        if self._error is not None:
            raise self._error
        return self._vectors


def _vector(seed: float) -> list[float]:
    return [seed] * EMBEDDING_DIMENSIONS


def teardown_function() -> None:
    app.dependency_overrides.pop(get_embeddings_client, None)


def test_valid_request_returns_200_matching_contract_shape():
    app.dependency_overrides[get_embeddings_client] = lambda: _FakeEmbeddingsClient(
        vectors=[_vector(0.1), _vector(0.2)]
    )

    response = client.post("/embed", json={"texts": ["Throttling", "Rate Limiting"]})

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == EMBEDDING_MODEL
    assert body["dimensions"] == EMBEDDING_DIMENSIONS
    assert len(body["vectors"]) == 2
    assert all(len(v) == EMBEDDING_DIMENSIONS for v in body["vectors"])


def test_empty_texts_array_returns_422():
    app.dependency_overrides[get_embeddings_client] = lambda: _FakeEmbeddingsClient(vectors=[])

    response = client.post("/embed", json={"texts": []})

    assert response.status_code == 422


def test_blank_text_returns_422():
    app.dependency_overrides[get_embeddings_client] = lambda: _FakeEmbeddingsClient(vectors=[])

    response = client.post("/embed", json={"texts": ["   "]})

    assert response.status_code == 422


def test_too_many_texts_returns_422():
    app.dependency_overrides[get_embeddings_client] = lambda: _FakeEmbeddingsClient(vectors=[])

    response = client.post("/embed", json={"texts": ["x"] * 257})

    assert response.status_code == 422


def test_text_over_length_limit_returns_422():
    app.dependency_overrides[get_embeddings_client] = lambda: _FakeEmbeddingsClient(vectors=[])

    response = client.post("/embed", json={"texts": ["x" * 8001]})

    assert response.status_code == 422


def test_provider_failure_returns_502():
    app.dependency_overrides[get_embeddings_client] = lambda: _FakeEmbeddingsClient(
        error=AgentLLMError("embed: provider call failed: boom")
    )

    response = client.post("/embed", json={"texts": ["Throttling"]})

    assert response.status_code == 502


def test_malformed_vector_from_provider_returns_502_not_500():
    app.dependency_overrides[get_embeddings_client] = lambda: _FakeEmbeddingsClient(
        vectors=[[0.1, 0.2]]  # wrong length -- caught by embed_texts, not the route itself
    )

    response = client.post("/embed", json={"texts": ["Throttling"]})

    assert response.status_code == 502


def test_missing_credential_surfaces_as_503_naming_the_secret(monkeypatch):
    # Exercises the real get_embeddings_client() (not an override), since
    # the 503 translation lives inside that dependency itself. Resets the
    # module-level cache before and after so this test neither depends on
    # nor pollutes other tests' state.
    monkeypatch.setattr(main_module, "_embeddings_client", None)

    def _raise_secret_load_error():
        raise SecretLoadError(
            "Secret 'jobpilot/agent-service' is missing required key OPENAI_API_KEY"
        )

    monkeypatch.setattr(main_module, "load_secrets_into_env", _raise_secret_load_error)

    with pytest.raises(fastapi.HTTPException) as exc_info:
        main_module.get_embeddings_client()

    assert exc_info.value.status_code == 503
    assert "OPENAI_API_KEY" in exc_info.value.detail
