"""Persisted, privacy-minimal request telemetry for service health reporting."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Index, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class ServiceTelemetryModel(Base):
    __tablename__ = "service_telemetry"
    __table_args__ = (
        CheckConstraint(
            "status IN ('success', 'failure')",
            name="ck_service_telemetry_status",
        ),
        CheckConstraint("latency_ms >= 0", name="ck_service_telemetry_latency_nonnegative"),
        CheckConstraint(
            "token_usage IS NULL OR token_usage >= 0",
            name="ck_service_telemetry_token_usage_nonnegative",
        ),
        Index("ix_service_telemetry_created_at", "created_at"),
        Index("ix_service_telemetry_component_created_at", "component", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    component: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(12), nullable=False)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    token_usage: Mapped[int | None] = mapped_column(Integer)
    failure_code: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
