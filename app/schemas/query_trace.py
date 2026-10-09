"""Admin-facing diagnostic query trace contracts."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class TraceChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")

    chunk_id: str
    document_title: str
    content_preview: str
    distance: float | None = None
    rank_score: float | None = None
    rrf_score: float | None = None
    dense_rank: int | None = None
    sparse_rank: int | None = None


class TraceQueryExpansion(BaseModel):
    original: str
    expanded: str
    succeeded: bool


class TraceRetrievalStage(BaseModel):
    top: list[TraceChunk]
    total_returned: int


class TraceRrfStage(BaseModel):
    k: int
    top: list[TraceChunk]


class TraceContextSource(BaseModel):
    marker: str
    document_title: str
    content_preview: str


class TraceContextStage(BaseModel):
    sources: list[TraceContextSource]
    chars_used: int
    char_budget: int


class TraceAnswerStage(BaseModel):
    text: str
    cited_markers: list[str]
    available_markers: list[str]
    citations_valid: bool


class QueryTrace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    created_at: str
    question: str
    stage_query_expansion: TraceQueryExpansion
    stage_dense_retrieval: TraceRetrievalStage
    stage_sparse_retrieval: TraceRetrievalStage
    stage_rrf_fusion: TraceRrfStage | None
    stage_context: TraceContextStage
    stage_answer: TraceAnswerStage


class QueryTraceSummary(BaseModel):
    id: str
    created_at: str
    question: str


class QueryTraceListResponse(BaseModel):
    traces: list[QueryTraceSummary]
