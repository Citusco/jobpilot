from typing import Any

from fastapi import Depends, FastAPI, HTTPException

from agent_service.graph import build_graph
from agent_service.nodes import AgentLLMError
from agent_service.schemas import (
    CandidateDirection,
    ExtractInsufficient,
    Extraction,
    ExtractRequest,
    ExtractResponse,
    ExtractSufficient,
)
from agent_service.secrets import load_secrets_into_env

app = FastAPI(title="JobPilot Agent Orchestration Service")

_compiled_graph: Any | None = None


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
    try:
        state: dict[str, Any] = graph.invoke({"jd_text": request.text})
    except AgentLLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if not state["sufficient"]:
        return ExtractInsufficient(reason=state["insufficient_reason"])

    return ExtractSufficient(
        extraction=Extraction(
            role=state["role"],
            tech_stack=state["tech_stack"],
            seniority=state["seniority"],
            seniority_inferred=state["seniority_inferred"],
        ),
        directions=[
            CandidateDirection(
                name=d.name,
                rationale=d.rationale,
                tags=d.tags,
                suggested_question_count=d.suggested_question_count,
            )
            for d in state["directions"]
        ],
    )
