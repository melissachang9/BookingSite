"""client photos

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_photos",
        sa.Column("tenant_id", sa.String(length=36), nullable=False),
        sa.Column("customer_id", sa.String(length=36), nullable=False),
        sa.Column("booking_id", sa.String(length=36), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("stored_name", sa.String(length=80), nullable=False),
        sa.Column("original_file_name", sa.String(length=255), nullable=True),
        sa.Column("mime_type", sa.String(length=64), nullable=False),
        sa.Column("file_size_bytes", sa.Integer(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("uploaded_by_name", sa.String(length=255), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("deleted_by_name", sa.String(length=255), nullable=True),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["customer_id"], ["customers.id"]),
        sa.ForeignKeyConstraint(["booking_id"], ["bookings.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_client_photos_tenant_id"), "client_photos", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_client_photos_customer_id"), "client_photos", ["customer_id"], unique=False)
    op.create_index("ix_client_photos_tenant_customer", "client_photos", ["tenant_id", "customer_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_client_photos_tenant_customer", table_name="client_photos")
    op.drop_index(op.f("ix_client_photos_customer_id"), table_name="client_photos")
    op.drop_index(op.f("ix_client_photos_tenant_id"), table_name="client_photos")
    op.drop_table("client_photos")
