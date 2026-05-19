# Workflow Test Matrix

This matrix captures the highest-risk workflows from the legacy product so the greenfield
v1 rebuild can preserve behavior without carrying over the old structure.

| Workflow | Primary actor | Minimum automated coverage | Notes |
| --- | --- | --- | --- |
| Public booking from service selection to payment | Customer | Playwright end-to-end, API integration tests | Includes provider selection, no-preference mode, and payment resume states. |
| Calendar-first manual booking creation | Staff | API integration tests, dashboard component tests | Booking creation must begin from calendar context, not a detached create-booking form. |
| Customer-facing forms by timing | Customer | API tests, Playwright end-to-end | Cover `pre_booking`, `pre_visit`, and `post_visit` timing transitions. |
| Internal form submission from customer profile | Provider or staff | API tests, dashboard component tests | Internal forms must remain separate from customer-facing forms. |
| Cancellation and refund decisioning | Customer or staff | Unit tests, API integration tests | Preserve refund window logic and append-only financial corrections. |
| Booking completion and balance collection | Staff | Unit tests, API integration tests, Playwright end-to-end | Cover cash, external POS, hosted card capture, and follow-up balances. |
| Multi-location availability and booking | Customer or staff | Unit tests, API integration tests | Location filters must constrain providers, services, and slot holds. |
| Tenant isolation and role gating | All actors | API tests for every domain | Cross-tenant reads or writes are release blockers. |

## First test slices

1. Backend health contract tests to verify the new service starts cleanly.
2. Tenant isolation fixtures shared across backend route tests.
3. Booking lifecycle state-machine tests for draft, confirmed, completed, canceled, and no-show transitions.
4. Payment ledger tests to guarantee append-only corrections.
5. Forms scope and timing tests to lock customer-facing versus internal behavior.