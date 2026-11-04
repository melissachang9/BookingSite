"""client photo categories can be free text

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("client_photos") as batch:
        batch.alter_column("kind", existing_type=sa.String(length=16), type_=sa.String(length=40), existing_nullable=False)


def downgrade() -> None:
    with op.batch_alter_table("client_photos") as batch:
        batch.alter_column("kind", existing_type=sa.String(length=40), type_=sa.String(length=16), existing_nullable=False)
