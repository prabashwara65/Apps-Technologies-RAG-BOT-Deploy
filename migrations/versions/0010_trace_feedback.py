"""Persist query traces and capture answer feedback."""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0010_trace_feedback"
down_revision: str | None = "0010_service_telemetry"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("query_traces"):
        op.create_table("query_traces",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("tenant_id", sa.String(120), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False))
    if not inspector.has_table("answer_feedback"):
        op.create_table("answer_feedback",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("trace_id", sa.Uuid(), sa.ForeignKey("query_traces.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("rating", sa.String(8), nullable=False),
            sa.Column("reason", sa.String(60)), sa.Column("comment", sa.Text()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("trace_id", "user_id", name="uq_answer_feedback_trace_user"),
            sa.CheckConstraint("rating IN ('up', 'down')", name="ck_answer_feedback_rating"))
    for table, name, columns in (
        ("query_traces", "ix_query_traces_user_id", ["user_id"]),
        ("query_traces", "ix_query_traces_tenant_id", ["tenant_id"]),
        ("query_traces", "ix_query_traces_created_at", ["created_at"]),
        ("answer_feedback", "ix_answer_feedback_trace_id", ["trace_id"]),
        ("answer_feedback", "ix_answer_feedback_rating_created", ["rating", "created_at"]),
    ):
        if name not in {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table)}:
            op.create_index(name, table, columns)

def downgrade() -> None:
    for table in ("answer_feedback", "query_traces"):
        inspector = sa.inspect(op.get_bind())
        if inspector.has_table(table):
            for index in inspector.get_indexes(table):
                op.drop_index(index["name"], table_name=table)
            op.drop_table(table)