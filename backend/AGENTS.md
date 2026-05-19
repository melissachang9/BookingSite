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

### Errors
- Return structured HTTP errors.
- Do not swallow database, payment, or permission errors.

### Testing
- Every new route needs backend tests.
- Cover success path, validation failure, and tenant isolation.
- Add focused unit tests for pure state-machine, payment, and slot-hold rules.

## Current priorities

- Tenant-safe APIs
- Booking lifecycle and slot-hold integrity
- Unified forms model and response handling
- Payment correctness and auditability