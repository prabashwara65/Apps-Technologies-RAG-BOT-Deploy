"""Transactional, concurrency-safe PostgreSQL feedback repository."""
from uuid import UUID, uuid4
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session
from app.models.answer_feedback import AnswerFeedbackModel

class AnswerFeedbackRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def upsert(self, trace_id: UUID, user_id: UUID, rating: str, reason: str | None, comment: str | None) -> AnswerFeedbackModel:
        statement = insert(AnswerFeedbackModel).values(id=uuid4(), trace_id=trace_id, user_id=user_id, rating=rating, reason=reason, comment=comment)
        statement = statement.on_conflict_do_update(constraint="uq_answer_feedback_trace_user", set_={"rating": rating, "reason": reason, "comment": comment, "updated_at": func.now()}).returning(AnswerFeedbackModel)
        return self.session.scalars(statement.execution_options(populate_existing=True)).one()

    def get(self, trace_id: UUID, user_id: UUID) -> AnswerFeedbackModel | None:
        return self.session.scalar(select(AnswerFeedbackModel).where(AnswerFeedbackModel.trace_id == trace_id, AnswerFeedbackModel.user_id == user_id))

    def delete(self, trace_id: UUID, user_id: UUID) -> bool:
        return self.session.scalar(delete(AnswerFeedbackModel).where(AnswerFeedbackModel.trace_id == trace_id, AnswerFeedbackModel.user_id == user_id).returning(AnswerFeedbackModel.id)) is not None