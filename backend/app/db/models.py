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
    bookings: Mapped[list[Booking]] = relationship(back_populates="tenant", cascade="all, delete-orphan")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="tenant", cascade="all, delete-orphan")


class User(Base, IdMixin, TimestampMixin):
    __tablename__ = "users"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="users")


class UserPermissionOverride(Base, IdMixin, TimestampMixin):
    __tablename__ = "user_permission_overrides"
    __table_args__ = (
        UniqueConstraint("user_id", "permission_key", name="uq_user_permission_override"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True, nullable=False)
    permission_key: Mapped[str] = mapped_column(String(64), nullable=False)
    allowed: Mapped[bool] = mapped_column(Boolean, nullable=False)


class Customer(Base, IdMixin, TimestampMixin):
    __tablename__ = "customers"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    owner_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    wallet_balance_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")

    tenant: Mapped[Tenant] = relationship(back_populates="customers")
    bookings: Mapped[list[Booking]] = relationship(back_populates="customer")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="customer")
    payments: Mapped[list[Payment]] = relationship(back_populates="customer")


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
    phone: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)

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
    setup_buffer_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    cleanup_buffer_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    deposit_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    category_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("service_categories.id"), nullable=True, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    slug: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    outcome_headline: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subheadline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    compare_at_price_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    featured_label: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    value_stack: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    bonuses: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    guarantee_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    social_proof: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    scarcity_hint: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_alt_text: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    before_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    before_image_alt: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    after_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    after_image_alt: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    meta_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    tenant: Mapped[Tenant] = relationship(back_populates="services")
    category: Mapped[Optional["ServiceCategory"]] = relationship(back_populates="services")
    provider_links: Mapped[list[ProviderService]] = relationship(back_populates="service", cascade="all, delete-orphan")
    location_links: Mapped[list[ServiceLocation]] = relationship(back_populates="service", cascade="all, delete-orphan")
    bookings: Mapped[list[Booking]] = relationship(back_populates="service")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="service")
    form_attachments: Mapped[list[ServiceFormAttachment]] = relationship(back_populates="service", cascade="all, delete-orphan")


class ServiceCategory(Base, IdMixin, TimestampMixin):
    __tablename__ = "service_categories"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="1")
    slug: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    outcome_headline: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subheadline: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hero_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    hero_image_alt: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    value_stack: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    bonuses: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)
    guarantee_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    social_proof: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    scarcity_hint: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    featured_label: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    meta_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    faqs: Mapped[Optional[list[dict[str, Any]]]] = mapped_column(JSON, nullable=True)

    services: Mapped[list[Service]] = relationship(back_populates="category")


class Provider(Base, IdMixin, TimestampMixin):
    __tablename__ = "providers"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_bookable_online: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, server_default="1")

    tenant: Mapped[Tenant] = relationship(back_populates="providers")
    user: Mapped[Optional[User]] = relationship(foreign_keys=[user_id], lazy="raise_on_sql")
    service_links: Mapped[list[ProviderService]] = relationship(back_populates="provider", cascade="all, delete-orphan")
    location_links: Mapped[list[ProviderLocation]] = relationship(back_populates="provider", cascade="all, delete-orphan")
    schedules: Mapped[list[ProviderSchedule]] = relationship(back_populates="provider", cascade="all, delete-orphan")
    bookings: Mapped[list[Booking]] = relationship(back_populates="provider")
    booking_drafts: Mapped[list[BookingDraft]] = relationship(back_populates="provider")


class ProviderService(Base, IdMixin, TimestampMixin):
    __tablename__ = "provider_services"
    __table_args__ = (UniqueConstraint("provider_id", "service_id", name="uq_provider_service"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), index=True, nullable=False)
    price_cents_override: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    duration_minutes_override: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    deposit_cents_override: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    commission_flat_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    commission_basis_points: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

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


class ProviderTimeOff(Base, IdMixin, TimestampMixin):
    __tablename__ = "provider_time_off"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class Booking(Base, IdMixin, TimestampMixin):
    __tablename__ = "bookings"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), index=True, nullable=False)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    location_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("locations.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    booking_method: Mapped[str] = mapped_column(String(32), nullable=False)
    deposit_status: Mapped[str] = mapped_column(String(32), nullable=False)
    payment_resolution: Mapped[str] = mapped_column(String(32), nullable=False)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_form_reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    tenant: Mapped[Tenant] = relationship(back_populates="bookings")
    customer: Mapped[Customer] = relationship(back_populates="bookings")
    service: Mapped[Service] = relationship(back_populates="bookings")
    provider: Mapped[Provider] = relationship(back_populates="bookings")
    payments: Mapped[list[Payment]] = relationship(back_populates="booking")
    payment_events: Mapped[list[BookingPaymentEvent]] = relationship(
        back_populates="booking",
        cascade="all, delete-orphan",
    )
    source_draft: Mapped[Optional[BookingDraft]] = relationship(back_populates="confirmed_booking", uselist=False)


class BookingPaymentEvent(Base, IdMixin, TimestampMixin):
    __tablename__ = "booking_payment_events"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    booking_id: Mapped[str] = mapped_column(String(36), ForeignKey("bookings.id"), index=True, nullable=False)
    event_kind: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    booking: Mapped[Booking] = relationship(back_populates="payment_events")


class Payment(Base, IdMixin, TimestampMixin):
    __tablename__ = "payments"
    __table_args__ = (UniqueConstraint("checkout_session_id", name="uq_payment_checkout_session"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    booking_draft_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("booking_drafts.id"), nullable=True)
    booking_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("bookings.id"), nullable=True)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    deposit_status: Mapped[str] = mapped_column(String(32), nullable=False)
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), default="USD", nullable=False)
    payment_method_type: Mapped[str] = mapped_column(String(32), nullable=False)
    checkout_session_kind: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    checkout_session_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    checkout_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    checkout_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    success_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    cancel_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    customer: Mapped[Customer] = relationship(back_populates="payments")
    booking: Mapped[Optional[Booking]] = relationship(back_populates="payments")
    booking_draft: Mapped[Optional[BookingDraft]] = relationship(back_populates="payments")
    events: Mapped[list[PaymentEvent]] = relationship(back_populates="payment", cascade="all, delete-orphan")


class PaymentEvent(Base, IdMixin, TimestampMixin):
    __tablename__ = "payment_events"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    payment_id: Mapped[str] = mapped_column(String(36), ForeignKey("payments.id"), index=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(32), nullable=False)
    actor_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amount_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    stripe_session_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stripe_payment_intent_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    payment: Mapped[Payment] = relationship(back_populates="events")


class BookingDraft(Base, IdMixin, TimestampMixin):
    __tablename__ = "booking_drafts"
    __table_args__ = (UniqueConstraint("confirmed_booking_id", name="uq_booking_draft_confirmed_booking"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    customer_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("customers.id"), nullable=True)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), index=True, nullable=False)
    provider_id: Mapped[str] = mapped_column(String(36), ForeignKey("providers.id"), index=True, nullable=False)
    location_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("locations.id"), nullable=True)
    confirmed_booking_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("bookings.id"), nullable=True)
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
    confirmed_booking: Mapped[Optional[Booking]] = relationship(back_populates="source_draft", uselist=False)
    payments: Mapped[list[Payment]] = relationship(back_populates="booking_draft")
    form_requirements: Mapped[list[BookingDraftFormRequirement]] = relationship(
        back_populates="booking_draft",
        cascade="all, delete-orphan",
    )
    hold: Mapped[Optional[SlotHold]] = relationship(back_populates="booking_draft", cascade="all, delete-orphan", uselist=False)
    intake_plan: Mapped[Optional[BookingDraftIntakePlan]] = relationship(
        back_populates="booking_draft",
        cascade="all, delete-orphan",
        uselist=False,
    )


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


class BookingDraftIntakePlan(Base, IdMixin, TimestampMixin):
    __tablename__ = "booking_draft_intake_plans"
    __table_args__ = (UniqueConstraint("booking_draft_id", name="uq_booking_draft_intake_plan_draft"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    booking_draft_id: Mapped[str] = mapped_column(String(36), ForeignKey("booking_drafts.id"), nullable=False)
    completion_timing: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    email_reminder_scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    email_reminder_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sms_reminder_scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    booking_draft: Mapped[BookingDraft] = relationship(back_populates="intake_plan")


class FormDefinition(Base, IdMixin, TimestampMixin):
    __tablename__ = "forms"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_prompt_timing: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    review_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    versions: Mapped[list[FormVersion]] = relationship(back_populates="form", cascade="all, delete-orphan")
    service_attachments: Mapped[list[ServiceFormAttachment]] = relationship(
        back_populates="form",
        cascade="all, delete-orphan",
    )


class FormVersion(Base, IdMixin, TimestampMixin):
    __tablename__ = "form_versions"
    __table_args__ = (UniqueConstraint("form_id", "version_number", name="uq_form_version_number"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    form_id: Mapped[str] = mapped_column(String(36), ForeignKey("forms.id"), index=True, nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    form: Mapped[FormDefinition] = relationship(back_populates="versions")


class ServiceFormAttachment(Base, IdMixin, TimestampMixin):
    __tablename__ = "service_form_attachments"
    __table_args__ = (UniqueConstraint("service_id", "form_version_id", name="uq_service_form_attachment_version"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    service_id: Mapped[str] = mapped_column(String(36), ForeignKey("services.id"), index=True, nullable=False)
    form_id: Mapped[str] = mapped_column(String(36), ForeignKey("forms.id"), index=True, nullable=False)
    form_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("form_versions.id"), index=True, nullable=False)
    customer_prompt_timing: Mapped[str] = mapped_column(String(32), nullable=False)

    service: Mapped[Service] = relationship(back_populates="form_attachments")
    form: Mapped[FormDefinition] = relationship(back_populates="service_attachments")
    form_version: Mapped[FormVersion] = relationship()


class FormResponse(Base, IdMixin, TimestampMixin):
    __tablename__ = "form_responses"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    form_id: Mapped[str] = mapped_column(String(36), ForeignKey("forms.id"), index=True, nullable=False)
    form_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("form_versions.id"), index=True, nullable=False)
    customer_id: Mapped[str] = mapped_column(String(36), ForeignKey("customers.id"), index=True, nullable=False)
    booking_draft_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("booking_drafts.id"), nullable=True)
    booking_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("bookings.id"), nullable=True)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_prompt_timing: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    answers_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    form_version: Mapped[FormVersion] = relationship()


class BookingDraftFormRequirement(Base, IdMixin, TimestampMixin):
    __tablename__ = "booking_draft_form_requirements"
    __table_args__ = (UniqueConstraint("booking_draft_id", "form_version_id", name="uq_booking_draft_form_requirement"),)

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    booking_draft_id: Mapped[str] = mapped_column(String(36), ForeignKey("booking_drafts.id"), index=True, nullable=False)
    booking_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("bookings.id"), nullable=True)
    form_id: Mapped[str] = mapped_column(String(36), ForeignKey("forms.id"), index=True, nullable=False)
    form_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("form_versions.id"), index=True, nullable=False)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    customer_prompt_timing: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    satisfied_by_response_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("form_responses.id"), nullable=True)

    booking_draft: Mapped[BookingDraft] = relationship(back_populates="form_requirements")
    form_version: Mapped[FormVersion] = relationship()
    satisfied_by_response: Mapped[Optional[FormResponse]] = relationship()


class Resource(Base, IdMixin, TimestampMixin):
    __tablename__ = "resources"

    tenant_id: Mapped[str] = mapped_column(String(36), ForeignKey("tenants.id"), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False, default="room")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    location_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("locations.id"), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)