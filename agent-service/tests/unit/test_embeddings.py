"""Provider mocked throughout -- no test here may reach a real embeddings
API (CLAUDE.md's LangGraph node testing rule, applied to this plain route's
provider wrapper too)."""

import pytest

from agent_service.embeddings import EMBEDDING_DIMENSIONS, embed_texts
from agent_service.nodes import AgentLLMError


class _FakeEmbeddingsClient:
    def __init__(self, vectors=None, error: Exception | None = None):
        self._vectors = vectors
        self._error = error

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if self._error is not None:
            raise self._error
        return self._vectors


def _vector(seed: float = 0.1) -> list[float]:
    return [seed] * EMBEDDING_DIMENSIONS


def test_embed_texts_batches_all_inputs_through_one_call():
    calls: list[list[str]] = []

    class _RecordingClient(_FakeEmbeddingsClient):
        def embed_documents(self, texts: list[str]) -> list[list[float]]:
            calls.append(texts)
            return [_vector(), _vector(0.2), _vector(0.3)]

    client = _RecordingClient()
    vectors = embed_texts(client, ["a", "b", "c"])

    assert len(calls) == 1  # one provider call, not one per text
    assert calls[0] == ["a", "b", "c"]
    assert len(vectors) == 3


def test_embed_texts_translates_provider_failure_to_agent_llm_error():
    client = _FakeEmbeddingsClient(error=RuntimeError("provider timed out"))

    with pytest.raises(AgentLLMError, match="provider call failed"):
        embed_texts(client, ["a"])


def test_embed_texts_rejects_a_vector_of_the_wrong_length():
    client = _FakeEmbeddingsClient(vectors=[[0.1, 0.2, 0.3]])  # not 1536-long

    with pytest.raises(AgentLLMError, match="expected 1536"):
        embed_texts(client, ["a"])


def test_embed_texts_rejects_a_vector_count_mismatch():
    client = _FakeEmbeddingsClient(vectors=[_vector()])  # 1 vector for 2 texts

    with pytest.raises(AgentLLMError, match="1 vectors for 2 texts"):
        embed_texts(client, ["a", "b"])
