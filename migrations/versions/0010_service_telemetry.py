"""Persist service request telemetry for operational health reporting.

Revision ID: 0010_service_telemetry
Revises: 0009_calendar_events
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0010_service_telemetry"
down_revision: str | None = "0009_calendar_events"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "service_telemetry",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("component", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=12), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("token_usage", sa.Integer(), nullable=True),
        sa.Column("failure_code", sa.String(length=120), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint(
            "status IN ('success', 'failure')",
            name="ck_service_telemetry_status",
        ),
        sa.CheckConstraint(
            "latency_ms >= 0",
            name="ck_service_telemetry_latency_nonnegative",
        ),
        sa.CheckConstraint(
            "token_usage IS NULL OR token_usage >= 0",
            name="ck_service_telemetry_token_usage_nonnegative",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_service_telemetry"),
    )
    op.create_index(
        "ix_service_telemetry_created_at",
        "service_telemetry",
        ["created_at"],
    )
    op.create_index(
        "ix_service_telemetry_component_created_at",
        "service_telemetry",
        ["component", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_service_telemetry_component_created_at",
        table_name="service_telemetry",
    )
    op.drop_index("ix_service_telemetry_created_at", table_name="service_telemetry")
    op.drop_table("service_telemetry")
