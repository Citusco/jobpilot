import pytest

from agent_service.llm import build_chat_model


def test_build_chat_model_sets_timeout_and_retries(monkeypatch: pytest.MonkeyPatch):
    # ChatOpenAI requires *some* API key string to construct at all (it doesn't validate
    # the key's authenticity here, just that one is present) - a dummy value is enough to
    # verify the timeout/retry config this module is actually responsible for, per
    # research.md #4's SC-001 budget rationale.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-dummy")

    model = build_chat_model()

    assert model.request_timeout == 20
    assert model.max_retries == 2
