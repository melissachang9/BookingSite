# Booking Platform — First-Tenant MVP Plan

*Created: May 9, 2026 · Version 1*
*Status: Companion to `booking_platform_plan.md` (v14). This doc replaces the v1 build sequence with a tighter first-tenant launch plan.*

> **Purpose.** `booking_platform_plan.md` is the long-range product vision and the single source of truth for the platform we eventually want to build. This doc is the opposite: it answers the question "what is the smallest, most defensible thing we can put in front of one paying tenant, and how do we get there in weeks, not quarters?"
>
> Anything not in this doc is explicitly **out of scope for first launch**. We come back to the long-range plan after the first tenant is live, paying, and giving us feedback.

---

## Table of Contents

1. Why a Separate MVP Plan
2. The Wedge: What We're Actually Selling First
3. First-Tenant Profile
4. Cut List — What's Out of Scope for v1
5. In-Scope Capabilities (v1)
6. Core State Model
7. Data Model — Locked for v1
8. The Canonical Flow (End-to-End)
9. Tech Stack — Locked for v1
10. Build Sequence (6–8 Weeks)
11. Definition of Done for First Launch
12. Risks & Mitigations
13. Open Decisions Before We Start
14. Post-Launch Roadmap (v1.1 → v2)

---

## 1. Why a Separate MVP Plan

The long-range plan (v14) lays out a full client-experience platform: wallet, dynamic pricing, marketing automation, bots, reviews, referrals, metrics, membership, marketplace, and a unified form builder. That's the right destination. It's the wrong starting point.

Three problems with shipping straight from the v14 build sequence:

1. **No launch wedge.** Phases A–N must all ship before first tenant launch in Phase N. That's 50+ weeks of work before a single dollar of revenue.
2. **Form builder is on the critical path.** A drag-and-drop form builder is real engineering and isn't required to validate the core booking + intake thesis.
3. **Compliance, billing, and messaging decisions are deferred too long.** They will block launch later if not decided now.

The fix: pick one wedge, ship a runtime instead of a builder, and defer everything that doesn't directly serve the first tenant's first 30 days.

---

## 2. The Wedge: What We're Actually Selling First

**The promise to the first tenant:**

> "Your customers can book a service online, complete the medical-history or consent form you require for that service, and pay a deposit — all in one flow. You see the response on their profile before they walk in. We migrate your existing customer list. You're live in two weeks."

That's it. That is the entire v1 product proposition.

Everything else in v14 — wallet, dynamic pricing, two-way SMS, marketing campaigns, bots, reviews, referrals, metrics, membership — is a post-launch upgrade.

**Why this wedge wins:**
- It's the single most painful workflow in beauty/med-spa today (paper forms, email chasing, no-show deposits).
- It exercises the hardest parts of the architecture (multi-tenant, bookings, forms, payments) without requiring the easiest-to-defer parts (campaigns, metrics, bots).
- It's demoable in a 10-minute screenshare.

---

## 3. First-Tenant Profile

We pick **one** design partner that fits this profile:

- Single-location beauty studio or small med spa (1–8 providers)
- Currently using paper or Google Forms for intake
- Currently using a basic scheduler (Square, Acuity, Vagaro) and willing to dual-run during transition
- Owner is technically literate enough to define their own forms via JSON or a config UI
- Located in a single state/jurisdiction (defers multi-state compliance)
- Willing to be on a weekly call during the first month

**One tenant. Not three. Not ten.** The whole point is to learn fast.

---

## 4. Cut List — What's Out of Scope for v1

Anything in v14 not on the in-scope list (Section 5) is out. To be explicit:

| Out of v1 | Why deferred |
|---|---|
| Drag-and-drop form builder | Use JSON-config + 3 starter templates; visual builder is v1.1 |
| Wallet ledger | Stripe handles deposit + refund directly in v1 |
| Dynamic pricing | Static service prices only |
| Two-way SMS / Twilio number pool | Transactional email + one-way SMS reminders only |
| Marketing campaigns | Out entirely |
| Bot / voice integration | Out entirely |
| Google Reviews integration | Out entirely |
| Referral program | Out entirely |
| Metrics & unit economics layer | Out entirely (basic Stripe + Postgres dashboards only) |
| Membership / subscriptions | Out entirely |
| Marketplace | Out entirely |
| Multi-location per tenant | Single location per tenant in v1 |
| Provider self-managed schedules | Owner sets schedules in admin in v1 |
| Telehealth / virtual consultations | Out entirely |
| Tier 2 form features (conditional logic, e-sig PDF, etc.) | Post-v1 |
| Contraindication engine | Post-v1 |

We do not build "stubs" or "scaffolding" for these. Their absence is the design.

---

## 5. In-Scope Capabilities (v1)

**Operator (admin web app):**
- Sign up tenant, set business name, timezone, branding (logo + 1 color)
- Define services (name, duration, price, deposit amount, optional required intake form)
- Define providers (name, email, services they offer, weekly schedule)
- Import customer list from CSV (name, email, phone)
- View calendar (day + week, single location)
- View customer profile (contact info + form responses + booking history)
- Manually create/cancel/reschedule a booking
- Mark booking as completed / no-show

**Customer (booking site):**
- Browse services, pick service → provider → time
- Complete required pre-booking intake form (rendered from JSON schema)
- Pay deposit via Stripe Checkout
- Receive confirmation email + calendar invite
- Receive 24h reminder email + SMS
- Cancel via link in confirmation email (refund logic per service policy)

**Forms (runtime only — no builder yet):**
- JSON schema definition stored in Postgres
- Field types: short text, long text, single-select, multi-select, yes/no, date, number, file/photo upload, basic drawn signature, section divider, static text
- Per-field: label, required, help text
- Form-level: title, description, attached services, pre-booking-gate timing only
- Versioning: editing creates a new immutable version; responses link to the version filled
- Responses stored, viewable in customer profile, exportable to CSV
- 3 starter templates ship in code: Generic Intake, Photo Consent, Microneedling Medical History

**Payments:**
- Stripe Checkout for deposits
- Refund on customer-initiated cancellation outside the cancellation window
- No refund inside the cancellation window (configurable per tenant)

**Auth:**
- Operator: email + password (Supabase Auth)
- Customer: magic-link email login for managing/canceling bookings (no password)

That's the entire v1 surface area.

---

## 6. Core State Model

The single most important thing to lock before any code is written: the lifecycle of a booking and how forms intersect it.

### Booking states

```
draft → slot_held → awaiting_form → awaiting_payment → confirmed
                                                          ↓
                                              completed | canceled | no_show
```

- **draft** — customer picked a service, no slot reserved yet
- **slot_held** — time slot reserved with a TTL (15 minutes); blocks other bookings
- **awaiting_form** — slot held, required forms not yet completed
- **awaiting_payment** — forms complete, Stripe Checkout pending
- **confirmed** — deposit paid, calendar invite sent
- **completed** — provider marked as done after appointment
- **canceled** — customer or staff canceled (refund per policy)
- **no_show** — customer didn't show up

### Slot hold semantics

- A `slot_hold` is a row in the `slot_holds` table with `(provider_id, starts_at, ends_at, expires_at, booking_draft_id)`.
- Availability queries exclude any slot covered by a non-expired hold.
- Holds expire automatically; a background job sweeps expired holds every minute and marks the associated draft as abandoned.
- A booking transitions out of `slot_held` only when forms are submitted and payment succeeds. On payment success, the hold is upgraded to a confirmed booking atomically in one transaction.

### Form requirement semantics

- A required form is a *requirement*, not a stored array on the booking. We have a `booking_form_requirements` table that records: this booking needs response to this form (at this version) before it can be confirmed.
- A `form_response` is created when the customer submits. It links to the form version, the customer, and the booking (or booking draft).
- Confirming a booking checks: every requirement has a matching response. If not, transition is rejected.

This solves the race-condition and abandoned-cart issues from v14's array-on-booking approach.

---

## 7. Data Model — Locked for v1

Postgres on Supabase. All tables have `tenant_id` for RLS. All `id` are UUID. All tables have `created_at`, `updated_at`.

### Tenancy & users

- `tenants` (id, name, slug, timezone, branding_json, settings_json)
  - `settings_json` holds per-tenant configurable policies: cancellation window, refund rules, deposit defaults, reminder timing, no-show fee, booking lead time, max advance booking days, etc. All have platform defaults; tenant overrides in admin.
- `users` (id, tenant_id, email, role, name) — operator/staff users
- `customers` (id, tenant_id, email, phone, name, notes)

### Service catalog

- `services` (id, tenant_id, name, description, duration_minutes, price_cents, deposit_cents, is_active)
- `providers` (id, tenant_id, user_id nullable, name, is_active)
- `provider_services` (provider_id, service_id) — junction
- `provider_schedules` (id, provider_id, weekday, start_time, end_time) — recurring weekly availability
- `provider_time_off` (id, provider_id, starts_at, ends_at, reason)

### Bookings

- `booking_drafts` (id, tenant_id, customer_id nullable, service_id, provider_id, starts_at, ends_at, status, expires_at, created_at)
- `slot_holds` (id, tenant_id, provider_id, starts_at, ends_at, expires_at, booking_draft_id)
- `bookings` (id, tenant_id, customer_id, service_id, provider_id, starts_at, ends_at, status, deposit_cents, stripe_payment_intent_id, canceled_at, canceled_by, completed_at)
- `booking_form_requirements` (id, booking_id, form_id, form_version_id, satisfied_by_response_id nullable)

### Forms

- `forms` (id, tenant_id, name, scope, timing, latest_version_id, is_active)
  - scope: `customer_facing` | `internal_only` (v1 ships customer_facing only; internal is plumbed but unused)
  - timing: `pre_booking_gate` only in v1
- `form_versions` (id, form_id, version_number, schema_json, created_at) — schema_json is the field definition, immutable
- `form_service_attachments` (form_id, service_id) — which services trigger this form
- `form_responses` (id, tenant_id, form_version_id, customer_id, booking_id nullable, booking_draft_id nullable, answers_json, submitted_at, submitted_by_user_id nullable)
- `form_response_attachments` (id, form_response_id, storage_path, mime_type, file_size_bytes)

### Notifications

- `notification_log` (id, tenant_id, customer_id, channel, template_key, sent_at, status, provider_message_id)

That's the v1 schema. ~17 tables. We don't add a table without a written justification tied to v1 scope.

### RLS policy summary

- Every table policy: `tenant_id = (auth.jwt() ->> 'tenant_id')::uuid` for staff users.
- Customer-facing policies: customer can read their own `bookings`, `form_responses`, `customers` row, scoped by `customer_id = auth.uid()`.
- Public read: services, providers, provider_schedules, forms, form_versions (the booking site needs them anonymously).

---

## 8. The Canonical Flow (End-to-End)

We design every screen and API around this single flow. If a feature isn't on this path, it's deferred.

1. **Customer lands on `book.<tenant>.com/services`.** Sees list of active services.
2. **Customer picks service** → sees calendar of available slots for the next 30 days. Availability = provider schedule minus existing bookings minus active slot holds minus time off.
3. **Customer picks a slot** → server creates a `booking_draft` and `slot_hold` (15 min TTL). Returns draft ID.
4. **Customer enters email + name + phone.** Server upserts a `customer` row.
5. **If service has attached forms** → server creates `booking_form_requirements` rows. Customer is shown the first required form, rendered from `form_versions.schema_json`.
6. **Customer completes form.** Server stores `form_response` linked to the draft. Marks the matching requirement as satisfied. Repeats for each required form.
7. **All requirements satisfied** → customer sent to Stripe Checkout for the deposit.
8. **Stripe webhook fires `checkout.session.completed`** → server, in one transaction:
   - Creates `bookings` row from the draft
   - Marks draft as completed
   - Re-attaches form responses to the booking ID
   - Deletes/expires the slot hold
   - Enqueues confirmation email + calendar invite
9. **Confirmation email** sent with `.ics` attachment and a magic-link cancel URL.
10. **24h before appointment** → reminder email + SMS sent.
11. **At appointment time** → operator marks completed/no-show in admin.

Failure modes we handle explicitly:
- Slot hold expires while customer is filling form → show "your time has been released; pick a new slot" and re-create hold if still available.
- Stripe Checkout abandoned → draft cleans up via the same hold-expiry sweep job.
- Customer cancels via magic link → check cancellation window, refund or not, free the slot.

---

## 9. Tech Stack — Locked for v1

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind | Single framework for marketing site, booking site, and admin |
| UI components | shadcn/ui | Free, owned in repo, no lock-in |
| Forms runtime | `react-hook-form` + `zod` for validation, custom JSON-schema renderer | No SurveyJS — we control the rendering |
| Database | Supabase Postgres | RLS, auth, storage, realtime in one |
| Auth | Supabase Auth (email/password for staff, magic link for customers) | Built in |
| File storage | Supabase Storage | Photo + signature uploads |
| Payments | Stripe Checkout + webhooks | Lowest-friction deposit flow |
| Email | Resend + React Email templates | Cheap, good DX |
| SMS | Twilio (one number for the whole platform in v1, not per-tenant) | Defer the number pool until v1.x |
| Hosting | Vercel | Native Next.js |
| Background jobs | Vercel Cron + Postgres job queue (`graphile-worker` or similar) | Slot-hold sweep, reminder dispatch |
| Analytics | PostHog | One pixel, free tier |
| Error tracking | Sentry | Free tier |

**Decisions deferred (do not block v1):** form-builder UI library, Twilio per-tenant number pool, marketing automation infra, bot platform, metrics warehouse.

---

## 10. Build Sequence (6–8 Weeks)

Ordered for ruthlessly fast end-to-end demoability. Every phase ships something runnable.

| Wk | Phase | Deliverables |
|---|---|---|
| 1 | **0. Foundations** | Repo, Next.js app, Supabase project, Tailwind + shadcn, CI, Sentry, Vercel deploy. Schema migrations for tenants, users, customers. RLS scaffolding. Operator login. |
| 2 | **1. Service catalog + providers** | Admin CRUD for services, providers, provider schedules, time off. Public read API for booking site. |
| 3 | **2. Availability + booking draft** | Availability engine (schedule − bookings − holds − time off). Booking-site service list, slot picker. `booking_drafts` + `slot_holds` with TTL sweep job. End-to-end: customer reaches "review" without payment yet. |
| 4 | **3. Forms runtime** | `forms`, `form_versions`, `form_service_attachments`, `form_responses` tables. JSON-schema renderer with all v1 field types. 3 starter templates seeded. Booking flow gates on required forms. Admin viewer for responses on customer profile. |
| 5 | **4. Payments + confirmation** | Stripe Checkout integration. Webhook handler that promotes draft → booking atomically. Confirmation email with `.ics`. Magic-link cancel. Cancellation refund logic. |
| 6 | **5. Admin calendar + customer import** | Day/week calendar view. Manual booking create/cancel/reschedule. Mark completed/no-show. CSV customer import. Customer profile page with bookings + form responses. |
| 7 | **6. Reminders + polish** | 24h email + SMS reminder cron. Email template polish. Mobile responsive pass. Empty/error states. End-to-end QA on a staging tenant. |
| 8 | **7. Tenant onboarding + launch** | Onboarding script (provision tenant, seed services, import customers, configure forms via JSON). First tenant goes live. Weekly check-in cadence starts. |

If anything slips, **the cut comes from the cut list, not from the in-scope list**. Reminders can ship as email-only if SMS is unstable. Admin calendar can ship as a list view if the calendar widget bogs down. Forms cannot be cut — they're the wedge.

---

## 11. Definition of Done for First Launch

The first tenant is "live" when all of these are true:

- [ ] Tenant's services, providers, schedules, and customers are imported and visible in admin
- [ ] At least one required pre-booking form is configured and attached to a service
- [ ] A real customer can complete the canonical flow end-to-end on production
- [ ] Deposit lands in the tenant's connected Stripe account (or platform account, depending on payouts decision)
- [ ] Confirmation email + calendar invite arrive within 60 seconds of payment
- [ ] 24h reminder fires reliably for at least 5 consecutive bookings
- [ ] Operator can cancel/reschedule and refund correctly
- [ ] Tenant has signed an order form and paid first month's invoice
- [ ] We have a weekly call scheduled for the first 4 weeks post-launch

We do not call it "launched" until all 9 are checked.

---

## 12. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Forms-via-JSON is too painful for the first tenant to author themselves | High | We author their forms for them, by hand, for v1. Visual builder ships in v1.1 (4–6 weeks post-launch). |
| Stripe payouts / Connect setup blocks launch | Medium | For v1, deposits land in our platform account; we Venmo/ACH the tenant weekly. Stripe Connect is v1.1. |
| Slot-hold race conditions (double-booking) | Medium | Wrap hold creation in a serializable transaction; integration tests for concurrent booking attempts. |
| Compliance scope creep from a med-spa first tenant | Medium | Pick a beauty studio, not a med spa, for the first tenant. Med spa = v1.1+ when e-signature PDF and audit trail ship. |
| 6–8 week timeline slips to 12+ | High | Cut from the cut list (Section 4 already cuts aggressively); enforce a weekly demo to surface slippage early. |
| Building auth/RLS wrong on day 1 poisons everything | High | Phase 0 includes RLS-from-day-1 with policy tests; do not defer this. |

---

## 13. Open Decisions Before We Start

These block starting code. Everything else (refund policies, deposit amounts, pricing tiers, no-show fees) is **per-tenant configuration** with platform defaults — not a platform-level decision to be made up front.

1. **Platform codename** — needed for repo name, package name, Supabase project. Doesn't have to be final-final.
2. **First-tenant identity** — who, specifically? Drives seed data, form content, services list.
3. **Tenant URL structure** — `<platform>.com/<tenant-slug>` (path-based) vs `<tenant>.<platform>.com` (subdomain). *Recommended: path-based for v1; custom domains in v1.1.*

### Deferred to the phase that actually needs them

- **Stripe payouts model** (Connect vs platform-collected) — decide in week 5 when payments get wired.
- **Default refund / cancellation policy values** — schema is configurable from day 1; pick the platform defaults during admin-settings UI work.
- **Operator pricing** — irrelevant until first tenant signs an order form. Tenant billing of the platform itself is post-launch ops, not v1 product.

---

## 14. Post-Launch Roadmap (v1.1 → v2)

Once the first tenant is live and stable, we re-open the v14 plan. Suggested order, each ~2–4 weeks:

- **v1.1** — Visual form builder (drag-and-drop), Stripe Connect, custom domains, two-way SMS via Twilio number pool
- **v1.2** — Wallet ledger + credits, smart cancellation rules, multi-location per tenant
- **v1.3** — Provider self-managed schedules, dynamic pricing, marketing campaigns (Tier 1)
- **v1.4** — Tier 2 forms (conditional logic, e-sig PDF, template library)
- **v1.5** — Google Reviews, referral program
- **v2.0** — Bot/voice integration, contraindication engine, metrics & unit economics layer
- **v2.x** — Membership, marketplace

The v14 plan is the destination. This MVP plan is how we earn the right to build it.

---

*This is a living document. Update only when v1 scope changes. The long-range vision lives in `booking_platform_plan.md`; do not duplicate it here.*
