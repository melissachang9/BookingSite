from __future__ import annotations

from datetime import datetime, time
from typing import Any, Optional

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IdMixin, TimestampMixin


class Tenant(Base, IdMixin, TimestampMixin):
    __tablename__ = "tenants"

    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    timezone: Mapped[str] = mapped_column(String(100), nullable=False)
    default_location_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("locations.id"), nullable=True)
    branding_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    settings_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    users: Mapped[list[User]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    customers: Mapped[list[Customer]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    locations: Mapped[list[Location]] = relationship(
        back_populates="tenant",
        cascade="all, delete-orphan",
        foreign_keys="Location.tenant_id",
    )
    services: Mapped[list[Service]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    providers: Mapped[list[Provider]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


class User(Base, IdMixin, TimestampMixin):
    __tablename__ = "users"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    tenant: Mapped[Tenant] = relationship(back_populates="users")


class Customer(Base, IdMixin, TimestampMixin):
    __tablename__ = "customers"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="customers")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="customer")


class Location(Base, IdMixin, TimestampMixin):
    __tablename__ = "locations"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    time_zone: Mapped[str] = mapped_column(String(100), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    address_line1: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address_line2: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    state: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="locations", foreign_keys=[tenant_id])
    provider_links: Mapped[list[ProviderLocation]] = relationship(back_populates="location", cascade="all, delete-orphan")
    service_links: Mapped[list[ServiceLocation]] = relationship(back_populates="location", cascade="all, delete-orphan")
    schedules: Mapped[list[ProviderSchedule]] = relationship(back_populates="location", cascade="all, delete-orphan")


class Service(Base, IdMixin, TimestampMixin):
    __tablename__ = "services"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    tenant: Mapped[Tenant] = relationship(back_populates="services")
    provider_links: Mapped[list[ProviderService]] = relationship(back_populates="service", cascade="all, delete-orphan")
    location_links: Mapped[list[ServiceLocation]] = relationship(back_populates="service", cascade="all, delete-orphan")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="service")


class Provider(Base, IdMixin, TimestampMixin):
    __tablename__ = "providers"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    tenant: Mapped[Tenant] = relationship(back_populates="providers")
    service_links: Mapped[list[ProviderService]] = relationship(back_populates="provider", cascade="all, delete-orphan")
    location_links: Mapped[list[ProviderLocation]] = relationship(back_populates="provider", cascade="all, delete-orphan")
    schedules: Mapped[list[ProviderSchedule]] = relationship(back_populates="provider", cascade="all, delete-orphan")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="provider")


class ProviderService(Base, IdMixin, TimestampMixin):
    __tablename__ = "provider_services"
    __table_args__ = (UniqueConstraint("provider_id", "service_id", name="uq_provider_service"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), index=True, nullable=False)

    provider: Mapped[Provider] = relationship(back_populates="service_links")
    service: Mapped[Service] = relationship(back_populates="provider_links")


class ProviderLocation(Base, IdMixin, TimestampMixin):
    __tablename__ = "provider_locations"
    __table_args__ = (UniqueConstraint("provider_id", "location_id", name="uq_provider_location"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id"), index=True, nullable=False)

    provider: Mapped[Provider] = relationship(back_populates="location_links")
    location: Mapped[Location] = relationship(back_populates="provider_links")


class ServiceLocation(Base, IdMixin, TimestampMixin):
    __tablename__ = "service_locations"
    __table_args__ = (UniqueConstraint("service_id", "location_id", name="uq_service_location"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), index=True, nullable=False)
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id"), index=True, nullable=False)

    service: Mapped[Service] = relationship(back_populates="location_links")
    location: Mapped[Location] = relationship(back_populates="service_links")


class ProviderSchedule(Base, IdMixin, TimestampMixin):
    __tablename__ = "provider_schedules"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    location_id: Mapped[str] = mapped_column(String(36), ForeignKey("locations.id"), index=True, nullable=False)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)

    provider: Mapped[Provider] = relationship(back_populates="schedules")
    location: Mapped[Location] = relationship(back_populates="schedules")


class BookingDraft(Base, IdMixin, TimestampMixin):
    __tablename__ = "booking_drafts"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    customer_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("customers.id"), nullable=True)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    location_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("locations.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    booking_method: Mapped[str] = mapped_column(String(32), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, nullable=False)

    tenant: Mapped[Tenant] = relationship(back_populates="booking_drafts")
    customer: Mapped[Optional[Customer]] = relationship(back_populates="booking_drafts")
    service: Mapped[Service] = relationship(back_populates="booking_drafts")
    provider: Mapped[Provider] = relationship(back_populates="booking_drafts")
    hold: Mapped[Optional[SlotHold]] = relationship(back_populates="booking_draft", cascade="all, delete-orphan", uselist=False)


class SlotHold(Base, IdMixin, TimestampMixin):
    __tablename__ = "slot_holds"
    __table_args__ = (
        UniqueConstraint("booking_draft_id", name="uq_slot_hold_draft"),
        UniqueConstraint("provider_id", "starts_at", "ends_at", name="uq_slot_hold_provider_window"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    booking_draft_id: Mapped[str] = mapped_column(String(36), ForeignKey("booking_drafts.id"), nullable=False)

    booking_draft: Mapped[BookingDraft] = relationship(back_populates="hold")