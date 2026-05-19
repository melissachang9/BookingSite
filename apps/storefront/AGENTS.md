# Storefront Agent Guide

This directory is the customer-facing application for the greenfield rebuild.

## Purpose

The storefront handles public booking, intake, payment, confirmation, and customer self-service paths.

## Rules

### Rendering and UX
- Optimize for SEO, speed, and mobile responsiveness.
- Keep the booking flow simple, legible, and outcome-oriented.
- Treat loading, validation, expiry, and recovery states as first-class UX cases.

### Booking flow
- Preserve the core sequence of service selection, provider or location selection where applicable, slot selection, required forms, payment, and confirmation.
- Customer-facing forms must respect timing and scope rules.
- Cancellation and manage-booking links should remain part of the customer flow when implemented.

### Data discipline
- Use backend APIs as the source of business logic.
- Preserve attribution and source fields from entry through booking.
- Use shared contracts from `packages/shared-types` instead of redefining workflow enums locally.

### UI
- Use Vanilla CSS or CSS Modules.
- Avoid overengineering state that belongs on the server.

### Testing
- Add component and end-to-end coverage for public booking flows.
- Cover form gating, payment handoff, confirmation, and recovery after interruption.