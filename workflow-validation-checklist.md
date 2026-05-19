# Workflow Validation Checklist (Docs-First)

Purpose: keep implementation aligned with the uploaded planning docs and ensure workflows are tested before considering a change done.

## Source of truth

- booking_platform_plan.md (primary product/workflow source)
- cofounder_review_packet.md (architecture and operating constraints)
- alex-hormozi-booking-app-guiding-principles.md (positioning and business outcome framing)
- booking-app-metrics-for-cac-ltv.md (measurement and economics instrumentation)

## Definition of done for workflow changes

A workflow change is only done when all items below are true:

1. The change maps to an explicit workflow in the planning docs, or adds a documented delta to the plan.
2. Permission boundaries are preserved (owner/manager/staff/provider behavior remains correct).
3. Booking/payment state transitions are valid and auditable.
4. Required data for reporting is captured (timestamps, source fields, payment details where applicable).
5. Operator-facing queues and dashboards surface any required follow-up work.
6. Automated checks pass (lint + targeted tests).
7. Manual path testing is completed for the affected actor flow(s).

## Required test pass for admin booking/checkout changes

Run this whenever admin booking, calendar, completion, payments, or settings are changed.

1. Admin calendar path
- Open calendar
- Click customer appointment
- Verify completion drawer opens from booking page

2. Completion drawer path
- Verify amount owing is shown correctly
- Verify payment outcomes work: follow_up, collected_cash, collected_external, already_paid, none_due
- Verify notes are appended and booking status updates correctly
- Verify successful completion offers a rebooking handoff for the same customer

3. External POS path
- Set tax in admin settings
- Confirm amount owing is computed from full service price plus tax, then reduced by deposit/refunds
- Select collected_external and enter exact paid amount
- Verify validation blocks underpayment
- Verify successful closeout marks booking paid in full and records payment note details

4. Stripe card collection path
- Click collect card now
- Confirm checkout opens and returns correctly
- Confirm successful return updates the booking payment state consistently, even if webhook delivery is delayed
- Confirm canceled return leaves the booking awaiting payment and shows clear retry guidance
- Confirm webhook still closes balance correctly when it is delivered normally

5. Balance follow-up recovery path
- Complete a booking with payment outcome set to follow_up
- Confirm it appears in Payments under Balance follow-up
- Confirm Collect card now opens hosted checkout from the payments table
- Confirm the same remaining-balance action is visible on the completed booking detail page

6. Booking payment detail visibility
- Confirm payment card shows price, tax, total with tax, deposit, amount owing, and status

7. Operator reporting visibility
- Confirm Recent payment activity shows external POS and Stripe balance events distinctly
- Confirm the admin dashboard Payments card reflects both awaiting-payment drafts and completed-booking balance follow-up work when present

8. Rebooking handoff path
- Complete a booking from the booking detail page
- Confirm Book next appointment links to the calendar
- Confirm the calendar booking drawer opens automatically with the same customer already prefilled

9. Permission boundary path
- Verify owner/manager/staff roles can still open checkout, complete appointments, mark no-show, and refund payments where applicable
- Verify provider-role users cannot collect payment, refund payments, or use completion checkout controls from bookings, customers, or payments screens

10. Checkout correction path
- Complete a booking with tip and guest wallet applied
- Reopen checkout from the completed booking detail page
- Confirm applied wallet credit is returned to the customer balance and the booking returns to confirmed status
- Confirm the completion drawer reopens with tip and wallet reset so checkout can be redone

## Required test pass for form-related flow changes

Use planning doc Key UI Flows 28 to 31 as acceptance paths.

1. Owner can build customer-facing pre-booking form and attach to service
2. Customer booking flow enforces required pre-booking form completion
3. Provider can fill internal form from customer profile
4. Form versioning preserves old responses and applies new version to new bookings

## Command baseline

Run from web/:

- npm run lint
- npm run test:calendar
- npm run test:checkout

Add targeted tests for any new logic branch introduced by the change.

## Review gate

Before merging, include in PR summary:

1. Which source doc section/flow the change implements
2. What was tested (automated + manual)
3. Any intentional deviation from docs and why
