"""OpenAI embeddings client construction and the /embed provider call.

Wraps OpenAIEmbeddings from langchain-openai -- already pinned for llm.py's
ChatOpenAI, so this adds no new dependency. The boundary this feature draws
is "which service holds the provider credential," not "which library calls
the API" (docs/DECISIONS.md 2026-08-10, "Embedding calls belong to the
inference service"), so reusing the same first-party integration package is
consistent with that reasoning, not an exception to it.
"""

from langchain_openai import OpenAIEmbeddings

from agent_service.nodes import AgentLLMError

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536


def build_embeddings_client() -> OpenAIEmbeddings:
    return OpenAIEmbeddings(model=EMBEDDING_MODEL)


def embed_texts(client: OpenAIEmbeddings, texts: list[str]) -> list[list[float]]:
    """Batches all `texts` through one provider call and validates the
    response shape before it reaches the HTTP boundary. contracts/embed.md's
    502 covers both "the provider call failed" and "the provider returned a
    malformed result" -- both are handled here so main.py's route body stays
    a thin translation to HTTPException, the same shape /extract already
    uses for AgentLLMError."""
    try:
        vectors = client.embed_documents(texts)
    except Exception as exc:  # noqa: BLE001 - re-raised as AgentLLMError below
        raise AgentLLMError(f"embed: provider call failed: {exc}") from exc

    if len(vectors) != len(texts):
        raise AgentLLMError(
            f"embed: provider returned {len(vectors)} vectors for {len(texts)} texts"
        )
    for vector in vectors:
        if len(vector) != EMBEDDING_DIMENSIONS:
            raise AgentLLMError(
                f"embed: provider returned a vector of length {len(vector)}, "
                f"expected {EMBEDDING_DIMENSIONS}"
            )
    return vectors
