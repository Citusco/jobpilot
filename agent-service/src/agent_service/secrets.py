"""Loads runtime secrets from AWS Secrets Manager into the process environment.

Fetched once at process startup (see main.py), not per-request - the values are cached
in os.environ for the lifetime of the process, same "fetch once, reuse" shape as the
LangGraph/ChatOpenAI client construction (llm.py, graph.py).

Secret shape: a single Secrets Manager secret, stored as a JSON object, containing the
keys OPENAI_API_KEY (required) and LANGCHAIN_API_KEY (optional). One secret rather than
two, since AWS Secrets Manager bills per secret, not per key-value pair within one.

OPENAI_API_KEY is a hard requirement - the service cannot do anything useful without it,
so a missing/unfetchable value fails loudly at startup (raises), it does not fail open.
LANGCHAIN_API_KEY is optional - LangSmith tracing already fails open on its own if unset
(spec.md Assumptions), so this loader does not need special-case handling for it beyond
not requiring it to be present in the secret payload.

AWS credentials themselves are never handled by this module - boto3's default credential
chain resolves them (environment variables, ~/.aws/credentials, or an IAM role when
deployed), which is the whole point of using Secrets Manager: no long-lived secret value
(the OpenAI key) ever needs to sit in a file inside this repo's working tree.
"""

import json
import os

import boto3

_SECRET_NAME_ENV_VAR = "AGENT_SERVICE_SECRET_NAME"
_DEFAULT_SECRET_NAME = "jobpilot/agent-service"


class SecretLoadError(Exception):
    """Raised when a required secret value could not be fetched or is malformed."""


def load_secrets_into_env() -> None:
    # An explicitly-set OPENAI_API_KEY (e.g. exported by the test suite, or set directly
    # for a quick local override) always wins over Secrets Manager - this is what lets
    # tests run without any AWS credentials at all, not a workaround bolted on after the
    # fact. Real local dev and deployed environments simply don't set this var and fall
    # through to the fetch below.
    if os.environ.get("OPENAI_API_KEY"):
        return

    secret_name = os.environ.get(_SECRET_NAME_ENV_VAR, _DEFAULT_SECRET_NAME)

    try:
        # Client construction can fail too (e.g. NoRegionError if neither AWS_REGION nor
        # ~/.aws/config sets a region) - not just the get_secret_value call, so both are
        # wrapped in the same try/except for one consistent, clean error type.
        client = boto3.client("secretsmanager")
        response = client.get_secret_value(SecretId=secret_name)
    except Exception as exc:  # noqa: BLE001 - re-raised as a domain-specific error below
        raise SecretLoadError(
            f"Failed to fetch secret '{secret_name}' from AWS Secrets Manager: {exc}"
        ) from exc

    try:
        values = json.loads(response["SecretString"])
    except (KeyError, json.JSONDecodeError) as exc:
        raise SecretLoadError(
            f"Secret '{secret_name}' did not contain a valid JSON SecretString"
        ) from exc

    openai_api_key = values.get("OPENAI_API_KEY")
    if not openai_api_key:
        raise SecretLoadError(f"Secret '{secret_name}' is missing required key OPENAI_API_KEY")
    os.environ["OPENAI_API_KEY"] = openai_api_key

    langchain_api_key = values.get("LANGCHAIN_API_KEY")
    if langchain_api_key:
        os.environ["LANGCHAIN_API_KEY"] = langchain_api_key
