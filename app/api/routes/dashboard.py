"""Dashboard metrics and system observability endpoints."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_request_settings, get_session
from app.core.config import Settings
from app.domain.accounts import UserAccount
from app.schemas.dashboard import DashboardOverviewResponse
from app.services.dashboard import get_dashboard_overview

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get(
    "/overview",
    response_model=DashboardOverviewResponse,
    summary="Get operational metrics, configuration, and activity logs",
)
def get_overview(
    user: Annotated[UserAccount, Depends(get_current_user)],
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_request_settings)],
    time_range: Literal["6h", "24h", "7d"] = Query(
        default="6h",
        description="Time filter range for query latency aggregation",
    ),
) -> DashboardOverviewResponse:
    """Return RAG KPIs, document metrics, active configuration, latency, and activity data."""
    return get_dashboard_overview(
        session=session,
        settings=settings,
        time_range=time_range,
    )
