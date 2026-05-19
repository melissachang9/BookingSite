# Backend Agent Guide

This directory is the active backend for the greenfield rebuild.

## Stack

- FastAPI
- Async SQLAlchemy
- Alembic
- PostgreSQL
- Pydantic

## Backend Rules

### Structure
- Keep database entities, request/response schemas, repositories, services, and routes separate.
- Avoid putting multi-step business logic directly in route handlers.
- Prefer a clear domain layout over one giant utility layer.

### Tenancy and auth
- Resolve authenticated actor and `tenant_id` through dependencies.
- Every tenant-scoped query must remain explicitly tenant-safe.
- Permission checks must be first-class and auditable.

### Transactions and state changes
- Booking promotion, cancellation, refund handling, and webhook reconciliation must be atomic.
- Idempotency matters for Stripe-style callbacks and retries.
- Do not allow hidden state jumps around the booking lifecycle.

### Data rules
- Keep stable IDs and timestamps on important records.
- Preserve attribution and reporting fields when evolving schemas.
- Favor immutable financial and response records over in-place mutation.

### Domain data specifics
- Tenant settings need explicit defaults and validation for cancellation windows, refund behavior, reminder timing, lead time, advance booking limits, deposits, no-show fees, payment link expiry, and tax rates.
- Slot hold release and abandoned draft cleanup should be idempotent so repeated sweeps produce the same result.
- Form definitions are versioned. Published form versions are immutable; edits create a new version and submitted responses stay linked to the version the customer or staff member saw.
- Provider service overrides may change price, deposit, duration, and service availability by provider/location context. Availability and booking summaries must use the resolved values consistently.
- Checkout state should be recorded as append-only events. Derive latest payment state from the event history and use compensating events for corrections.

### Errors
- Return structured HTTP errors.
- Do not swallow database, payment, or permission errors.

### Testing
- Every new route needs backend tests.
- Cover success path, validation failure, and tenant isolation.
- Add focused unit tests for pure state-machine, payment, and slot-hold rules.
- Add boundary tests for cancellation windows, payment math, availability buffers, hold expiry, form versioning, and idempotent payment/webhook handling.

## Current priorities

- Tenant-safe APIs
- Booking lifecycle and slot-hold integrity
- Unified forms model and response handling
- Payment correctness and auditability