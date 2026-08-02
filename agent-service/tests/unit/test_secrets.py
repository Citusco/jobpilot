import json
import os
from unittest.mock import MagicMock, patch

import pytest

from agent_service.secrets import SecretLoadError, load_secrets_into_env


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch):
    # load_secrets_into_env() writes to os.environ directly (not via monkeypatch.setenv),
    # so monkeypatch's own automatic teardown doesn't know to undo it - clean up
    # explicitly both before and after each test, or a key set by one test leaks into
    # every test that runs after it in the same session.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("LANGCHAIN_API_KEY", raising=False)
    yield
    # Plain os.environ.pop here, NOT monkeypatch.delenv: if a value was set by
    # load_secrets_into_env() (bypassing monkeypatch entirely), calling
    # monkeypatch.delenv on it here would make monkeypatch record *this* deletion as an
    # undo-able action and restore the leaked value right back when monkeypatch's own
    # fixture teardown runs afterward (it tears down after _clean_env, since _clean_env
    # depends on it - LIFO order). A plain pop leaves nothing for monkeypatch to "undo".
    os.environ.pop("OPENAI_API_KEY", None)
    os.environ.pop("LANGCHAIN_API_KEY", None)


def test_skips_fetch_when_openai_api_key_already_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-already-set")

    with patch("agent_service.secrets.boto3.client") as mock_client:
        load_secrets_into_env()

    mock_client.assert_not_called()


def test_fetches_and_sets_both_keys_from_secret() -> None:
    fake_client = MagicMock()
    secret_payload = {"OPENAI_API_KEY": "sk-from-aws", "LANGCHAIN_API_KEY": "ls-from-aws"}
    fake_client.get_secret_value.return_value = {"SecretString": json.dumps(secret_payload)}

    with patch("agent_service.secrets.boto3.client", return_value=fake_client):
        load_secrets_into_env()

    import os

    assert os.environ["OPENAI_API_KEY"] == "sk-from-aws"
    assert os.environ["LANGCHAIN_API_KEY"] == "ls-from-aws"


def test_raises_when_openai_api_key_missing_from_secret() -> None:
    fake_client = MagicMock()
    fake_client.get_secret_value.return_value = {"SecretString": json.dumps({})}

    with patch("agent_service.secrets.boto3.client", return_value=fake_client):
        with pytest.raises(SecretLoadError):
            load_secrets_into_env()


def test_raises_when_secret_string_is_not_valid_json() -> None:
    fake_client = MagicMock()
    fake_client.get_secret_value.return_value = {"SecretString": "not json"}

    with patch("agent_service.secrets.boto3.client", return_value=fake_client):
        with pytest.raises(SecretLoadError):
            load_secrets_into_env()


def test_raises_when_get_secret_value_fails() -> None:
    fake_client = MagicMock()
    fake_client.get_secret_value.side_effect = RuntimeError("access denied")

    with patch("agent_service.secrets.boto3.client", return_value=fake_client):
        with pytest.raises(SecretLoadError):
            load_secrets_into_env()


def test_raises_when_client_construction_fails() -> None:
    # Regression test: boto3.client(...) itself can fail (e.g. NoRegionError when no
    # AWS region is configured at all) - this must be caught too, not just
    # get_secret_value. Found by actually running this against a machine with no AWS
    # config, not by inspection.
    with patch("agent_service.secrets.boto3.client", side_effect=RuntimeError("no region")):
        with pytest.raises(SecretLoadError):
            load_secrets_into_env()
