"""Durable trace reads and writes."""
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.query_trace import QueryTraceModel
from app.schemas.query_trace import QueryTrace, QueryTraceSummary

class QueryTraceRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, trace: QueryTrace, user_id: UUID, tenant_id: str) -> str:
        self.session.add(QueryTraceModel(id=UUID(trace.id), user_id=user_id, tenant_id=tenant_id, payload=trace.model_dump(mode="json"), created_at=datetime.fromisoformat(trace.created_at)))
        self.session.flush()
        return trace.id

    def get(self, trace_id: UUID) -> QueryTrace | None:
        row = self.session.get(QueryTraceModel, trace_id)
        return QueryTrace.model_validate(row.payload) if row else None

    def list(self) -> list[QueryTraceSummary]:
        rows = self.session.scalars(select(QueryTraceModel).order_by(QueryTraceModel.created_at.desc()).limit(100))
        return [QueryTraceSummary(id=str(row.id), created_at=row.created_at.isoformat(), question=str(row.payload["question"])) for row in rows]