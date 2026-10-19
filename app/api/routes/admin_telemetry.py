"""Admin endpoints for inspecting and clearing persisted service telemetry."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.api.routes.admin_users import get_current_admin
from app.domain.accounts import UserAccount
from app.models.service_telemetry import ServiceTelemetryModel
from app.schemas.service_telemetry import (
    ServiceTelemetryClearResponse,
    ServiceTelemetryItem,
    ServiceTelemetryListResponse,
)
from app.services.dashboard import clear_recorded_query_latencies

router = APIRouter(prefix="/admin/telemetry", tags=["admin-telemetry"])


@router.get("", response_model=ServiceTelemetryListResponse)
def list_service_telemetry(
    admin: Annotated[UserAccount, Depends(get_current_admin)],
    session: Annotated[Session, Depends(get_session)],
    hours: Annotated[int, Query(ge=1, le=168)] = 24,
) -> ServiceTelemetryListResponse:
    cutoff = datetime.now(UTC) - timedelta(hours=hours)
    total = session.scalar(
        select(func.count(ServiceTelemetryModel.id)).where(
            ServiceTelemetryModel.created_at >= cutoff
        )
    ) or 0
    rows = session.scalars(
        select(ServiceTelemetryModel)
        .where(ServiceTelemetryModel.created_at >= cutoff)
        .order_by(ServiceTelemetryModel.created_at.desc())
        .limit(500)
    )
    records = [
        ServiceTelemetryItem(
            id=str(row.id),
            component=row.component,
            status=row.status,
            latency_ms=row.latency_ms,
            token_usage=row.token_usage,
            failure_code=row.failure_code,
            created_at=row.created_at.isoformat(),
        )
        for row in rows
    ]
    return ServiceTelemetryListResponse(total=total, records=records)


@router.delete("", response_model=ServiceTelemetryClearResponse)
def clear_service_telemetry(
    admin: Annotated[UserAccount, Depends(get_current_admin)],
    session: Annotated[Session, Depends(get_session)],
) -> ServiceTelemetryClearResponse:
    result = session.execute(delete(ServiceTelemetryModel))
    deleted = result.rowcount or 0
    session.commit()
    clear_recorded_query_latencies()
    return ServiceTelemetryClearResponse(deleted=deleted)
