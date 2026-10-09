"""Admin-only endpoints for recent grounded-answer traces."""

from typing import Annotated
from uuid import UUID
from sqlalchemy.orm import Session
from app.api.dependencies import get_session
from app.repositories.query_traces import QueryTraceRepository

from fastapi import APIRouter, Depends, HTTPException

from app.api.routes.admin_users import get_current_admin
from app.domain.accounts import UserAccount
from app.schemas.query_trace import QueryTrace, QueryTraceListResponse

router = APIRouter(prefix="/admin/traces", tags=["admin-traces"])


@router.get("", response_model=QueryTraceListResponse)
def list_traces(
    admin: Annotated[UserAccount, Depends(get_current_admin)],
    session: Annotated[Session, Depends(get_session)],
) -> QueryTraceListResponse:
    return QueryTraceListResponse(traces=QueryTraceRepository(session).list())


@router.get("/{trace_id}", response_model=QueryTrace)
def get_trace(
    trace_id: UUID,
    admin: Annotated[UserAccount, Depends(get_current_admin)],
    session: Annotated[Session, Depends(get_session)],
) -> QueryTrace:
    trace = QueryTraceRepository(session).get(trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Query trace not found.")
    return trace