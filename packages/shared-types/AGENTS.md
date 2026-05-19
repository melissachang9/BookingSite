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