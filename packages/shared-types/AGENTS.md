# Shared Types Agent Guide

This package holds contracts shared across backend and frontend surfaces.

## Rules

- Put shared enums, DTOs, error envelopes, and workflow state types here.
- Do not duplicate booking states, form scope and timing enums, permission keys, or core response shapes in app-local code when they are truly cross-surface.
- Keep this package framework-light and free of app-specific UI concerns.
- Changes here are contract changes; update backend and frontend consumers together.
- Favor explicit, stable names over convenience aliases.

## High-priority shared shapes

- Booking lifecycle states
- Form scope and timing enums
- Permission keys and role-adjacent contract types
- Customer, appointment, payment, and health-check response shapes
- Error response envelopes used by backend APIs
- Tenant settings contracts
- Availability, slot hold, and booking draft contracts
- Checkout event and payment outcome contracts

## Canonical enum discipline

- Booking states: `draft`, `slot_held`, `awaiting_form`, `awaiting_payment`, `confirmed`, `completed`, `canceled`, `no_show`.
- Form scopes: customer-facing and internal-only concepts must remain distinct in shared contracts.
- Form timing: preserve pre-booking, pre-visit, and post-visit timing contexts.
- Form fields should use explicit field types such as short text, long text, single select, multi select, yes/no, date, number, file or photo upload, signature, section, static text, and checkbox.
- Payment outcomes should distinguish follow-up collection, cash, external POS, already paid, none due, and hosted checkout events when represented across surfaces.