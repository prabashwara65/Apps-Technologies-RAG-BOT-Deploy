"""One editable rating per trace and user."""
from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column
from app.models.base import Base

class AnswerFeedbackModel(Base):
    __tablename__ = "answer_feedback"
    __table_args__ = (
        UniqueConstraint("trace_id", "user_id", name="uq_answer_feedback_trace_user"),
        Index("ix_answer_feedback_rating_created", "rating", "created_at"),
        Index("ix_answer_feedback_trace_id", "trace_id"),
        CheckConstraint("rating IN ('up', 'down')", name="ck_answer_feedback_rating"),
    )
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    trace_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("query_traces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[UUID] = mapped_column(Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    rating: Mapped[str] = mapped_column(String(8), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(60))
    comment: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())