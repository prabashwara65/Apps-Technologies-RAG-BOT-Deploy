"""Add the local email-keyed avatar filename.

Revision ID: 0011_avatar_filename
Revises: 0010_trace_feedback
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0011_avatar_filename"
down_revision: str | None = "0010_trace_feedback"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "avatar_filename" not in columns:
        op.add_column("users", sa.Column("avatar_filename", sa.String(255), nullable=True))


def downgrade() -> None:
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("users")}
    if "avatar_filename" in columns:
        op.drop_column("users", "avatar_filename")
