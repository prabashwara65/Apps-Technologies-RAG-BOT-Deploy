"""Admin-facing service telemetry records."""

from pydantic import BaseModel


class ServiceTelemetryItem(BaseModel):
    id: str
    component: str
    status: str
    latency_ms: int
    token_usage: int | None
    failure_code: str | None
    created_at: str


class ServiceTelemetryListResponse(BaseModel):
    total: int
    records: list[ServiceTelemetryItem]


class ServiceTelemetryClearResponse(BaseModel):
    deleted: int
