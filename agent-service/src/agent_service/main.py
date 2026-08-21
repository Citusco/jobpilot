from typing import Any

from fastapi import Depends, FastAPI, HTTPException

from agent_service.embeddings import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    build_embeddings_client,
    embed_texts,
)
from agent_service.graph import build_graph
from agent_service.nodes import AgentLLMError
from agent_service.schemas import (
    EmbedRequest,
    EmbedResponse,
    ExtractedItem,
    ExtractRequest,
    ExtractResponse,
)
from agent_service.secrets import SecretLoadError, load_secrets_into_env

app = FastAPI(title="JobPilot Agent Orchestration Service")

_compiled_graph: Any | None = None
_embeddings_client: Any | None = None


def get_graph() -> Any:
    """FastAPI dependency for the compiled graph - overridden in tests via
    app.dependency_overrides (the FastAPI equivalent of NestJS's overrideProvider).

    Lazily loads secrets and compiles the graph on first real invocation, rather than at
    module import time. This keeps `import agent_service.main` (and therefore test
    collection) free of any real AWS/OpenAI network call - tests replace this whole
    dependency via dependency_overrides, so this function body never actually runs in
    the test suite, and production incurs the one-time cost on the first request instead
    of at process startup."""
    global _compiled_graph
    if _compiled_graph is None:
        # Must run before build_graph() - that's what constructs ChatOpenAI, which reads
        # OPENAI_API_KEY from the environment at construction time.
        load_secrets_into_env()
        _compiled_graph = build_graph()
    return _compiled_graph


@app.post("/extract", response_model=ExtractResponse)
def extract(request: ExtractRequest, graph: Any = Depends(get_graph)) -> ExtractResponse:
    """Report the technical items a posting mentions.

    No sufficiency verdict and no rejection branch: a posting with nothing technical
    yields {"items": []} (FR-004). This service does not resolve, score, classify or rank
    -- it does not know what a concept is and has no database access (DESIGN.md 4.1).
    """
    try:
        state: dict[str, Any] = graph.invoke({"jd_text": request.text})
    except AgentLLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return ExtractResponse(
        items=[
            ExtractedItem(surface=item.surface, evidence=item.evidence)
            for item in state["items"]
        ]
    )


def get_embeddings_client() -> Any:
    """FastAPI dependency for the embeddings client, mirroring get_graph()'s
    lazy-load-then-cache shape. Overridden in tests via
    app.dependency_overrides -- this function body never runs in the test
    suite, so no test reaches a provider.

    Unlike get_graph(), a missing credential is translated to a 503 here
    directly (SecretLoadError raised inside a FastAPI dependency is caught
    before the route body runs) -- contracts/embed.md's 503 case, naming
    the missing credential rather than the network."""
    global _embeddings_client
    if _embeddings_client is None:
        try:
            load_secrets_into_env()
        except SecretLoadError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        _embeddings_client = build_embeddings_client()
    return _embeddings_client


@app.post("/embed", response_model=EmbedResponse)
def embed(request: EmbedRequest, client: Any = Depends(get_embeddings_client)) -> EmbedResponse:
    try:
        vectors = embed_texts(client, request.texts)
    except AgentLLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return EmbedResponse(vectors=vectors, model=EMBEDDING_MODEL, dimensions=EMBEDDING_DIMENSIONS)
