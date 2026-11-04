"""record who filled in an internal form

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("form_responses", sa.Column("submitted_by_user_id", sa.String(length=36), nullable=True))
    op.add_column("form_responses", sa.Column("submitted_by_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("form_responses", "submitted_by_name")
    op.drop_column("form_responses", "submitted_by_user_id")
