# Dashboard Agent Guide

This directory is the operator-facing application for the greenfield rebuild.

## Purpose

The dashboard is for staff and operators. It should optimize for dense operational workflows, fast data entry, and permission-aware UI.

## Rules

### Workflow
- Booking creation for staff must begin from calendar context.
- Do not add a detached booking-creation flow that ignores time context.
- Customer profile, forms, payments, and follow-up work should support operator efficiency.

### Data and state
- Keep business logic in backend APIs, not duplicated in UI state.
- Use typed contracts from `packages/shared-types`.
- Prefer localized state and explicit loading/error handling.

### UI
- Use Vanilla CSS or CSS Modules.
- Optimize for clarity, dense information, and quick operator actions.
- Permission-gate controls in the UI, but do not rely on client gating as the only enforcement.

### Testing
- Add component or integration tests for workflow-heavy controls.
- Cover permission states, empty states, and error states.
- Calendar interactions and checkout-related flows deserve extra scrutiny.

## High-value flows

- Calendar-first manual booking
- Customer lookup and profile access
- Internal form access and response viewing
- Booking completion, payment collection, and follow-up queues