"""Shared ChatOpenAI client construction.

Timeout/retry policy per specs/004-python-agent-orchestration/research.md #4: a 20s
per-call timeout leaves margin under this feature's own 25s SC-001 budget and the NestJS
caller's 30s timeout (two LLM calls happen per request in the worst case - extraction
then generation - so the per-call timeout must be well below the total budget, not equal
to it). LangSmith tracing needs no code here at all - it activates purely via the
LANGCHAIN_TRACING_V2 / LANGCHAIN_API_KEY / LANGCHAIN_PROJECT environment variables
(research.md #5).
"""

from langchain_openai import ChatOpenAI

_MODEL = "gpt-4o"
_TIMEOUT_SECONDS = 20
_MAX_RETRIES = 2


def build_chat_model() -> ChatOpenAI:
    return ChatOpenAI(model=_MODEL, timeout=_TIMEOUT_SECONDS, max_retries=_MAX_RETRIES)
