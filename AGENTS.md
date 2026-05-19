# Booking Platform Agent Guide

This file is the active instruction set for work in this repository. It preserves the durable product, workflow, testing, and architecture rules from the prior planning docs and legacy implementation notes.

## 1. Source Priority

When documents disagree, use this priority order:

1. This file and the nearest repo-local `AGENTS.md`
2. The active repo structure under `backend/`, `apps/`, `packages/`, and `docs/`
3. Active code, tests, schemas, migrations, and API contracts

Important synthesis rules:

- Preserve the product workflows and data-model truths recorded here.
- Prefer the current greenfield architecture over older implementation assumptions.
- If code and this guide disagree, pause and reconcile the workflow rule before expanding behavior.

## 2. Repo State

This repo is the greenfield v1 rebuild under `backend/`, `apps/`, and `packages/`. New product work belongs in that stack.

## 3. Product Intent

This product is not just calendar software. It is a revenue, retention, and client-experience system for beauty studios, med spas, and wellness businesses.

Keep these positioning truths in mind when making product or technical decisions:

- Optimize for more booked customers, faster follow-up, fewer lost leads, fewer no-shows, and higher repeat visits.
- The first valuable wedge is booking + required intake/consent + deposit + operator visibility before the visit.
- The unified customer record matters: booking, communication, forms, payments, and history should converge on the customer profile.
- Imported historical data must preserve business truth, not overwrite it with import-time assumptions.

## 4. Current Active Stack

Use this stack for the active rebuild unless the user explicitly changes direction:

### Backend
- FastAPI
- PostgreSQL
- Async SQLAlchemy
- Alembic
- Pydantic
- JWT-based auth and dependency-injected tenant context

### Frontend
- Storefront: Next.js App Router
- Internal dashboard: React + Vite
- Shared contracts: `packages/shared-types`
- Styling: Vanilla CSS or CSS Modules

### Cross-Cutting
- Dockerized runtime for backend, dashboard, storefront, database, and supporting services
- `docker compose` as the primary local orchestration entry point

## 5. Non-Negotiable Platform Rules

### Multi-tenancy
- Every tenant-scoped record must carry `tenant_id`.
- Every query, API route, service action, and background job must be tenant-safe.
- Cross-tenant reads or writes are release blockers.
- Defense in depth is preferred: schema constraints, application checks, and tests should all reinforce tenant isolation.

### Permissions
- Permissions are first-class. Avoid hardcoded role checks as the primary access model.
- Privileged actions should map to explicit permission keys and remain auditable.
- Role templates are acceptable as defaults, but the system should not assume a fixed role matrix is the final authority.

### Calendar-first operator workflow
- Staff-created bookings must originate from calendar context.
- Do not introduce a detached standalone operator booking creation flow that bypasses calendar time context.

### Unified forms
- Forms are a unified, first-class system.
- Support a shared core model for customer-facing and internal forms.
- Preserve form scope separation and permission-gated access.
- Preserve versioned form definitions and immutable submitted responses.
- Builder UX can be staged, but the underlying data model must not fork into separate systems.

### Financial integrity
- Financial events must be immutable and auditable.
- Never implement direct balance mutation logic.
- Long-term direction is wallet-ledger semantics; shorter-term deposit flows may be simpler, but they still must remain append-only in spirit and migration-safe.
- Refunds and corrections should be represented as explicit compensating events, not silent edits.
- Checkout/payment actions should append immutable event records. The latest payment state should be derivable from the event history, not maintained as an untraceable overwrite.
- V1 checkout event kinds include `admin_completion` and `stripe_balance_checkout`; future wallet, gift card, and correction events should follow the same append-only pattern.

### Auditability
- No soft deletes without audit attribution.
- Record who performed sensitive actions and when.
- Preserve historical truth for imports, financial events, and form responses.

### Error handling
- No silent failures.
- FastAPI endpoints must return structured errors.
- Frontend surfaces must handle loading, empty, and error states intentionally.

## 6. Workflow and Data Model Constraints

### Booking lifecycle
Preserve an explicit, auditable state model. The planning docs converge on this core lifecycle:

`draft -> slot_held -> awaiting_form -> awaiting_payment -> confirmed -> completed | canceled | no_show`

Rules:

- State transitions must be deliberate and testable.
- Payment-confirmation promotion and hold release must be atomic.
- Avoid impossible or hidden state jumps.

### Slot holds
- Slot holds need TTL semantics.
- Availability queries must exclude non-expired holds.
- Expired holds must be swept or released predictably.
- Manual and public booking flows must respect the same hold rules.

### Availability
- Default slot granularity is 15 minutes unless an explicit tenant or service rule says otherwise.
- Services may define setup and cleanup buffers; availability must block the full buffered interval, not just visible service duration.
- Apply constraints in this order where relevant: provider schedule, provider time off, confirmed bookings, active slot holds, tenant minimum lead time, tenant maximum advance window.

### Form requirements
- Form requirements should be modeled explicitly, not as an unstructured array stuffed onto a booking.
- Customer-facing timing contexts matter: pre-booking, pre-visit, and post-visit.
- Internal forms must remain distinct from customer-facing forms even when the field system is shared.

### Metrics and instrumentation
- Every important record needs a stable ID and timestamp.
- Maintain traceability across lead, customer, appointment, payment, staff, service, location, and campaign/source dimensions.
- Preserve attribution fields, booking method, source channel, and acquisition facts when modifying schemas or APIs.
- Imported customers must retain original acquisition timing and pre-platform lifetime truth.

### Tenant Settings
Tenant settings should remain explicit, validated, and portable across API/frontend contracts. Core settings include cancellation window hours, refund-inside-window behavior, reminder timing, minimum lead time, maximum advance booking window, default deposit cents, no-show fee cents, automatic no-show charging, payment link expiry minutes, and tax rate percent.

Rules:

- Use bounded validation for money, percentages, windows, and lead-time values.
- Use stable defaults for seeded tenants and migrations.
- Do not hide tenant policy in frontend-only constants.

### Cancellation and refunds
- Cancellation policy must be based on the tenant cancellation window and refund settings.
- Refunds and cancellation decisions must record who/what canceled, when it happened, the reason if supplied, refunded amount cents, and external refund identifiers when applicable.
- Inside-window and outside-window behavior must be testable at the boundary.

### Payment calculations
- Tax applies to the service subtotal unless a future explicit tax rule says otherwise.
- Balance due should account for subtotal, tax, tip, paid deposit, refunded amount, and wallet/credit application.
- Deposit states should remain explicit enough to distinguish unpaid, deposit paid, and paid in full.

### Scope interpretation
- The long-range plan includes advanced systems such as bots, marketing automation, referrals, marketplace support, and richer analytics.
- Do not expand into those by default when implementing core v1 flows.
- At the same time, do not hardcode the rebuild into dead-end assumptions that block those future systems.

## 7. Testing and Definition of Done

Every meaningful change should satisfy these checks:

1. It maps to an explicit workflow in this guide or documents the delta clearly.
2. Permission boundaries remain correct.
3. Booking and payment state transitions remain valid and auditable.
4. Required reporting and attribution fields are still captured.
5. Operator follow-up work is surfaced when the workflow requires it.
6. Targeted automated checks pass.
7. Manual actor-path testing is completed for workflow-heavy UI changes.

Minimum testing expectations:

- New backend routes: `pytest` coverage for success path, validation failure, and tenant isolation.
- New frontend features: component or integration coverage for rendering, permission states, and core interaction states.
- Workflow-critical changes: update or add API, integration, component, or Playwright coverage for the affected actor path.

Release blockers:

- Cross-tenant data leakage
- Silent payment failures
- Broken form versioning or response preservation
- Impossible booking state transitions
- Missing audit attribution on sensitive changes

## 8. Workflow Test Matrix

Prioritize coverage for these actor paths as the rebuild grows:

| Workflow | Primary actor | Minimum automated coverage |
| --- | --- | --- |
| Public booking from service selection to payment | Customer | Playwright end-to-end and API integration tests |
| Calendar-first manual booking creation | Staff | API integration tests and dashboard component tests |
| Customer-facing forms by timing | Customer | API tests and Playwright end-to-end coverage |
| Internal form submission from customer profile | Provider or staff | API tests and dashboard component tests |
| Cancellation and refund decisioning | Customer or staff | Unit tests and API integration tests |
| Booking completion and balance collection | Staff | Unit tests, API integration tests, and Playwright end-to-end coverage |
| Multi-location availability and booking | Customer or staff | Unit tests and API integration tests |
| Tenant isolation and role gating | All actors | API tests for every domain |

First slices to preserve:

1. Backend health contract tests.
2. Tenant isolation fixtures shared across backend route tests.
3. Booking lifecycle tests for draft, confirmed, completed, canceled, and no-show transitions.
4. Payment ledger tests that guarantee append-only corrections.
5. Forms scope and timing tests that lock customer-facing versus internal behavior.

## 9. Agent Workflow Expectations

When implementing a feature or change:

1. Identify the owning layer in `backend/`, `apps/`, or `packages/`.
2. Identify the governing workflow and constraints before changing structure or schema.
3. For schema or API work, define tenant, permission, audit, timestamp, and state-transition implications up front.
4. Build in narrow vertical slices with tests, not broad speculative scaffolding.
5. Keep business logic close to the owning backend domain, not duplicated across frontends.
6. Use the nearest repo-local `AGENTS.md` for layer-specific rules.

## 10. Repo-Local Guides

- `backend/AGENTS.md` — backend architecture, transactions, tenancy, permissions, and testing
- `apps/dashboard/AGENTS.md` — operator UI and calendar-first workflow rules
- `apps/storefront/AGENTS.md` — customer-facing booking flow rules
- `packages/shared-types/AGENTS.md` — shared contracts and enum discipline