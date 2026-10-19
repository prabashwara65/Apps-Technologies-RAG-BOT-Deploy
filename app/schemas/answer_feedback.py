"""Validated feedback contracts."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

FeedbackReason = Literal["wrong_answer", "incomplete", "wrong_document", "off_topic", "other"]

class FeedbackSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    rating: Literal["up", "down"]
    reason: FeedbackReason | None = None
    comment: str | None = Field(default=None, max_length=1000)

class FeedbackResponse(BaseModel):
    trace_id: str
    user_id: str
    rating: str
    reason: str | None
    comment: str | None
    created_at: str
    updated_at: str


class FeedbackRecentItem(BaseModel):
    trace_id: str
    question_preview: str
    question_full: str
    rating: str
    reason: str | None
    comment: str | None
    created_at: str
    user_email: str


class FeedbackSummaryResponse(BaseModel):
    days: int
    total: int
    up: int
    down: int
    up_rate: float
    by_reason: dict[str, int]
    recent: list[FeedbackRecentItem]