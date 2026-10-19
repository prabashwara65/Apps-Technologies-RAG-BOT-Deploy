"""Schemas for operational dashboard metrics and configuration."""

from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, Field


class DashboardKpi(BaseModel):
    active_documents: int = Field(ge=0, description="Total active approved documents")
    total_chunks: int = Field(ge=0, description="Total searchable chunks in vector store")
    total_queries: int = Field(ge=0, description="Total user queries processed")
    system_status: str = Field(default="Healthy", description="Overall RAG service health")


class RAGConfiguration(BaseModel):
    embedding_model: str = Field(description="Active embedding model name")
    vector_database: str = Field(description="Active vector store technology")
    chunk_size_tokens: int = Field(description="Estimated chunk size in tokens")
    chunk_size_chars: int = Field(description="Max chunk characters configuration")
    overlap_tokens: int = Field(description="Chunk overlap in tokens")


class LatencyBucket(BaseModel):
    label: str = Field(description="Time bucket label (e.g. 10:00, 11:00, Mon)")
    timestamp: str = Field(description="ISO timestamp start of bucket")
    latency_ms: int = Field(ge=0, description="Average query latency in milliseconds")
    query_count: int = Field(ge=0, description="Number of queries in this bucket")


class ActivityItem(BaseModel):
    id: str = Field(description="Unique activity event ID")
    type: Literal["success", "warning", "info"] = Field(description="Visual badge type")
    title: str = Field(description="Activity description")
    timestamp_label: str = Field(description="Human readable time e.g. Today at 10:42 AM")
    occurred_at: str = Field(description="ISO timestamp")


class DocumentTypeCount(BaseModel):
    type: str
    count: int


class DocumentSummary(BaseModel):
    id: str
    title: str
    document_type: str
    status: str
    created_at: str
    chunk_count: int


class DocumentMetrics(BaseModel):
    total: int
    by_status: dict[str, int]
    by_type: list[DocumentTypeCount]
    recently_added_24h: int
    total_chunks: int
    documents: list[DocumentSummary]


class DocumentChunkCount(BaseModel):
    document_id: str
    title: str
    chunk_count: int


class EmbeddingSummary(BaseModel):
    total: int
    dimension: int
    model_name: str
    by_document: list[DocumentChunkCount]


class ServiceHealthComponent(BaseModel):
    name: str
    status: Literal["healthy", "degraded", "unavailable", "not_configured", "unknown"]
    message: str


class ServiceStatus(BaseModel):
    overall_status: Literal["Healthy", "Degraded", "Unknown", "Unreachable"]
    checked_at: str
    components: list[ServiceHealthComponent]
    queries_last_24h: int
    successful_queries_last_24h: int
    failed_queries_last_24h: int
    average_latency_ms: int
    answer_tokens_last_24h: int | None
    last_query_at: str | None
    telemetry_available: bool


class DashboardOverviewResponse(BaseModel):
    kpis: DashboardKpi
    configuration: RAGConfiguration
    latency_time_range: str
    latency_buckets: list[LatencyBucket]
    recent_activities: list[ActivityItem]
    document_metrics: DocumentMetrics
    embedding_summary: EmbeddingSummary
    service_status: ServiceStatus
