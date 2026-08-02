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

# Must run before build_graph() - that's what constructs ChatOpenAI, which reads
# OPENAI_API_KEY from the environment at construction time.
load_secrets_into_env()
_compiled_graph = build_graph()


def get_graph() -> Any:
    """FastAPI dependency for the compiled graph - overridden in tests via
    app.dependency_overrides (the FastAPI equivalent of NestJS's overrideProvider)."""
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
