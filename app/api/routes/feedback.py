"""Authenticated feedback capture; trace ownership is checked on every operation."""
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.api.dependencies import get_current_user, get_session
from app.api.permissions import get_current_admin
from app.domain.accounts import UserAccount
from app.models.answer_feedback import AnswerFeedbackModel
from app.models.query_trace import QueryTraceModel
from app.models.users import UserModel
from app.repositories.answer_feedback import AnswerFeedbackRepository
from app.schemas.answer_feedback import (
    FeedbackReason,
    FeedbackRecentItem,
    FeedbackResponse,
    FeedbackSubmitRequest,
    FeedbackSummaryResponse,
)

router = APIRouter(prefix="/feedback", tags=["feedback"], dependencies=[Depends(get_current_user)])

SessionDep = Annotated[Session, Depends(get_session)]
UserDep = Annotated[UserAccount, Depends(get_current_user)]

def require_trace(session: Session, trace_id: UUID, user: UserAccount) -> None:
    trace = session.get(QueryTraceModel, trace_id)
    if trace is None or trace.user_id != user.id:
        raise HTTPException(status_code=404, detail="Query trace not found.")
    # Accounts have no tenant membership. Ownership comes from the authenticated
    # asking user, never a tenant supplied by a feedback client.

def serialize(row: AnswerFeedbackModel) -> FeedbackResponse:
    return FeedbackResponse(trace_id=str(row.trace_id), user_id=str(row.user_id), rating=row.rating, reason=row.reason, comment=row.comment, created_at=row.created_at.isoformat(), updated_at=row.updated_at.isoformat())

@router.get("/summary", response_model=FeedbackSummaryResponse)
def get_feedback_summary(
    session: SessionDep,
    admin: Annotated[UserAccount, Depends(get_current_admin)],
    days: Annotated[int, Query(ge=1, le=90)] = 7,
    rating: Annotated[Literal["up", "down"] | None, Query()] = None,
    reason: Annotated[FeedbackReason | None, Query()] = None,
) -> FeedbackSummaryResponse:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    filters = [QueryTraceModel.created_at >= cutoff]
    if rating is not None:
        filters.append(AnswerFeedbackModel.rating == rating)
    if reason is not None:
        filters.append(AnswerFeedbackModel.reason == reason)

    counts_statement = (
        select(
            AnswerFeedbackModel.rating,
            AnswerFeedbackModel.reason,
            func.count(AnswerFeedbackModel.id).label("feedback_count"),
        )
        .join(QueryTraceModel, QueryTraceModel.id == AnswerFeedbackModel.trace_id)
        .where(*filters)
        .group_by(AnswerFeedbackModel.rating, AnswerFeedbackModel.reason)
    )
    counts = session.execute(counts_statement).all()
    up = sum(count for item_rating, _, count in counts if item_rating == "up")
    down = sum(count for item_rating, _, count in counts if item_rating == "down")
    by_reason: dict[str, int] = {}
    for _, item_reason, count in counts:
        if item_reason is not None:
            by_reason[item_reason] = by_reason.get(item_reason, 0) + count

    recent_statement = (
        select(
            AnswerFeedbackModel.trace_id,
            QueryTraceModel.payload,
            AnswerFeedbackModel.rating,
            AnswerFeedbackModel.reason,
            AnswerFeedbackModel.comment,
            AnswerFeedbackModel.created_at,
            UserModel.email,
        )
        .join(QueryTraceModel, QueryTraceModel.id == AnswerFeedbackModel.trace_id)
        .join(UserModel, UserModel.id == AnswerFeedbackModel.user_id)
        .where(*filters)
        .order_by(AnswerFeedbackModel.created_at.desc())
        .limit(50)
    )
    recent_rows = session.execute(recent_statement).all()
    recent: list[FeedbackRecentItem] = []
    for trace_id, payload, item_rating, item_reason, comment, created_at, user_email in recent_rows:
        question_full = str(payload.get("question", ""))
        recent.append(
            FeedbackRecentItem(
                trace_id=str(trace_id),
                question_preview=question_full[:100],
                question_full=question_full,
                rating=item_rating,
                reason=item_reason,
                comment=comment,
                created_at=created_at.isoformat(),
                user_email=user_email,
            )
        )

    total = up + down
    return FeedbackSummaryResponse(
        days=days,
        total=total,
        up=up,
        down=down,
        up_rate=round(up / total, 3) if total else 0.0,
        by_reason=by_reason,
        recent=recent,
    )

@router.post("/{trace_id}", response_model=FeedbackResponse)
def submit_feedback(trace_id: UUID, payload: FeedbackSubmitRequest, session: SessionDep, user: UserDep) -> FeedbackResponse:
    require_trace(session, trace_id, user)
    row = AnswerFeedbackRepository(session).upsert(trace_id, user.id, payload.rating, payload.reason, payload.comment)
    session.commit()
    return serialize(row)

@router.get("/{trace_id}", response_model=FeedbackResponse)
def get_feedback(trace_id: UUID, session: SessionDep, user: UserDep) -> FeedbackResponse:
    require_trace(session, trace_id, user)
    row = AnswerFeedbackRepository(session).get(trace_id, user.id)
    if row is None:
        raise HTTPException(status_code=404, detail="Feedback not found.")
    return serialize(row)

@router.delete("/{trace_id}", status_code=204)
def retract_feedback(trace_id: UUID, session: SessionDep, user: UserDep) -> Response:
    require_trace(session, trace_id, user)
    AnswerFeedbackRepository(session).delete(trace_id, user.id)
    session.commit()
    return Response(status_code=204)