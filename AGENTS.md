# Booking Platform Agent Guide

This file consolidates the planning and operating rules spread across the non-README project docs. It is the active instruction set for work in this repository.

## 1. Source Priority

When documents disagree, use this priority order:

1. This file and the nearest repo-local `AGENTS.md`
2. The active repo structure under `backend/`, `apps/`, `packages/`, and `docs/`
3. Product and workflow rules from:
	- `booking_platform_plan.md`
	- `booking_platform_mvp_plan.md`
	- `cofounder_review_packet.md`
	- `booking-app-metrics-for-cac-ltv.md`
	- `workflow-validation-checklist.md`
	- `docs/testing/workflow-matrix.md`
	- `alex-hormozi-booking-app-guiding-principles.md`
4. The legacy `web/` implementation as a behavior reference only

Important synthesis rules:

- Preserve the product workflows and data-model truths from the planning docs.
- Prefer the current greenfield rebuild architecture over older stack assumptions found in legacy planning docs.
- Treat legacy implementation details as reference material, not as a mandate to repeat the old structure.

## 2. Repo State

This repo currently has two tracks:

- The new greenfield v1 rebuild under `backend/`, `apps/`, `packages/`, and `docs/`
- The legacy `web/` monolith, retained for workflow reference and selective maintenance

Default behavior:

- New product work belongs in the greenfield stack.
- The `web/` app is not the target architecture unless the user explicitly asks to work there.

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

### Cross-cutting
- Dockerized runtime for backend, dashboard, storefront, database, and supporting services
- `docker compose` as the primary local orchestration entry point

Legacy docs may reference a different stack such as a Next.js and Supabase monolith or Tailwind-heavy implementation. Those are not the active architecture for this rebuild.

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

### Form requirements
- Form requirements should be modeled explicitly, not as an unstructured array stuffed onto a booking.
- Customer-facing timing contexts matter: pre-booking, pre-visit, and post-visit.
- Internal forms must remain distinct from customer-facing forms even when the field system is shared.

### Metrics and instrumentation
- Every important record needs a stable ID and timestamp.
- Maintain traceability across lead, customer, appointment, payment, staff, service, location, and campaign/source dimensions.
- Preserve attribution fields, booking method, source channel, and acquisition facts when modifying schemas or APIs.
- Imported customers must retain original acquisition timing and pre-platform lifetime truth.

### Scope interpretation
- The long-range plan includes advanced systems such as bots, marketing automation, referrals, marketplace support, and richer analytics.
- Do not expand into those by default when implementing core v1 flows.
- At the same time, do not hardcode the rebuild into dead-end assumptions that block those future systems.

## 7. Testing and Definition of Done

Every meaningful change should satisfy these checks:

1. It maps to an explicit workflow in the planning docs or documents the delta clearly.
2. Permission boundaries remain correct.
3. Booking and payment state transitions remain valid and auditable.
4. Required reporting and attribution fields are still captured.
5. Operator follow-up work is surfaced when the workflow requires it.
6. Targeted automated checks pass.
7. Manual actor-path testing is completed for workflow-heavy UI changes.

Minimum testing expectations:

- New backend routes: `pytest` coverage for success path, validation failure, and tenant isolation.
- New frontend features: component or integration coverage for rendering, permission states, and core interaction states.
- Workflow-critical changes: update or add API/integration/Playwright coverage from `docs/testing/workflow-matrix.md`.

Release blockers:

- Cross-tenant data leakage
- Silent payment failures
- Broken form versioning or response preservation
- Impossible booking state transitions
- Missing audit attribution on sensitive changes

## 8. What To Read Before Building

Use the smallest relevant set of docs for the task, not a broad full-doc reread every time.

- `booking_platform_plan.md`: long-range principles, permissions, unified forms, and future-state constraints
- `booking_platform_mvp_plan.md`: first-tenant wedge, canonical booking flow, state model, and cut-list reality checks
- `cofounder_review_packet.md`: architecture principles, strategic priorities, and non-negotiables
- `booking-app-metrics-for-cac-ltv.md`: IDs, timestamps, attribution, and unit-economics data requirements
- `workflow-validation-checklist.md`: definition of done and manual acceptance expectations
- `docs/testing/workflow-matrix.md`: workflow-level automated coverage targets
- `alex-hormozi-booking-app-guiding-principles.md`: outcome-focused positioning and go-to-market framing

## 9. Agent Workflow Expectations

When implementing a feature or change:

1. Identify whether the task belongs to the greenfield stack or the legacy `web/` app.
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
- `web/AGENTS.md` — legacy Next.js surface rules and limitations