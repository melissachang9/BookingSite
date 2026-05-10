# Booking Platform — Planning Document

*Last updated: May 3, 2026 · Version 14*
*Status: Phases 1–3 complete. Phase 4 (Data Model lockdown) and Phase 5 (Build Roadmap detail) ahead.*

> **Future-state note.** This document is the single source of truth for project planning. Once Phase 4 is complete and the tech stack is locked, the relevant sections will be split into:
> - **`README.md`** — project overview, getting started, architecture summary
> - **`AGENTS.md`** — comprehensive context for AI coding agents

---

## Table of Contents

1. Product Vision
2. Target Customers & Use Case Patterns
3. User Types
4. Pain Points in Existing Booking Software
5. Architectural Principles
6. Customer Experience Principles
7. Operator Experience Principles
8. Competitive Landscape
9. Feature Catalog (by user × tier)
10. Permissions System
11. Messaging Architecture
12. Transactional & Operational Automation
13. Marketing Campaigns
14. **Forms System (Unified)** *(new)*
15. Bot/Voice Integration Layer
16. Google Reviews Integration
17. Referral Program
18. Marketplace Path
19. Metrics & Unit Economics
20. Tenant Migration & Customer Import
21. Data Model Approach
22. Key UI Flows
23. Code Repository Structure
24. Tech Stack
25. Build Sequence
26. Pre-Launch Calendar Items
27. Open Decisions
28. Questions for the Co-Founder / Engineering Lead
29. Glossary
30. Next Phases

---

## 1. Product Vision

A modern, modular, multi-tenant SaaS booking and client-experience platform purpose-built for **beauty studios, med spas, and wellness businesses**. Combines online booking, front-desk tools, in-studio kiosk and waiting room experiences, two-way SMS + email messaging, transactional and marketing automation, voice and chat bot integration, telehealth-style virtual consultations, **a unified form builder for customer-facing intake and internal staff forms**, intake/charting/treatment-plan tooling, Google Reviews monitoring, a referral credit program, a wallet-first money architecture, a metrics layer that turns the product from a scheduler into a business operating system, and a migration experience that preserves historical truth.

Each tenant business gets a fully white-labeled customer experience. Architecture supports a future opt-in consumer marketplace layer (Tier 3).

---

## 2. Target Customers & Use Case Patterns

(Unchanged from v13.)

---

## 3. User Types

(Unchanged from v13.)

---

## 4. Pain Points in Existing Booking Software

(Mostly unchanged from v13. New section:)

### Forms & data capture
- **Form builders are clunky or absent.** Mangomint requires technical configuration to build forms. Mid-market alternatives have form builders but they're inconsistent — different surfaces for customer intake vs. staff-side notes vs. consent forms vs. internal records.
- **Mangomint's "Flows" feature is conceptually right but hard to set up.** Operators avoid it because the UI buries what's possible behind layers of configuration. The result: automation that should save staff time becomes shelf-ware.
- **No unified surface for customer-facing and internal forms.** Tenants who want a patch-test record, a color formulation form, an incident report, or a consultation worksheet typically resort to paper or external tools (Jotform, Google Forms) that don't link back to the customer profile.
- **Pre-booking screening is manual or absent.** Tenants who need to gate certain services behind a questionnaire (e.g., medical history before microneedling) typically email forms separately and chase responses.

---

## 5. Architectural Principles

(Principles 1–22 unchanged from v13.)

### Principle 23: Forms are a unified, first-class platform layer
A single form builder produces both customer-facing and internal staff forms. Same UI, same field types, same versioning, same response storage — the difference is just where the form is rendered and who can fill it. The builder is genuinely easy to use (drag-and-drop, immediate, Google-Forms-like) — *not* a configuration interface buried behind workflow logic. Form responses link to the customer profile and (where relevant) to specific bookings, making them part of the unified customer record.

This is a direct competitive win against Mangomint, whose Flows are conceptually right but operationally inaccessible because the configuration UI is too complex.

---

## 6. Customer Experience Principles

(Unchanged from v13.)

---

## 7. Operator Experience Principles

(Unchanged from v13.)

---

## 8. Competitive Landscape

(Unchanged from v13.)

### Where the platform wins (updated)

- vs Mangomint: matched UI + AI-as-primitive + clinical depth + unified communication + native marketing automation + multi-location architecture + unit economics + retention metrics that fit any business cycle + clean migration + **form builder that's actually easy to use, unified across customer-facing and internal needs**
- (Other entries unchanged from v13.)

---

## 9. Feature Catalog

(Mostly unchanged from v13. Updates to forms in Tier 1:)

### A. Customer (Tier 1) — added/changed
- Form completion in booking flow when required by the service (pre-booking gates)
- Form completion via link sent in pre-visit message (pre-visit forms)
- Form responses visible in customer's account
- Photo / file upload as form fields

### B. Internal Staff (Tier 1) — added/changed
- **Simplified form builder** — drag-and-drop field types (short text, long text, single-select, multi-select, yes/no, date, file/photo upload, basic signature), required/optional toggle, label and help text per field, save and version
- **Form scope toggle** — customer-facing OR internal-only
- **Form timing for customer-facing forms** — pre-booking gate / pre-visit / post-visit
- **Service attachment** — attach customer-facing forms to specific services (auto-shown when those services are booked)
- **Internal forms accessible from customer profile** — e.g., patch test record, incident report, consultation worksheet
- **Permission-gated form filling** — internal forms can be configured for specific staff permissions
- **Response viewer** — see all responses to a form, filter by date or customer, export to CSV
- **Customer profile shows all form responses** for that customer

### B. Internal Staff (Tier 2) — expanded forms
- Conditional logic (show/hide fields based on prior answers)
- Branching / skip logic
- Field validation rules (regex, ranges, custom)
- Auto-population from prior responses
- True e-signature with signed PDF artifact
- Multi-section forms with progress indicator
- Form template library (platform-provided starters for common use cases)
- Score-based outcome routing (e.g., "if score > 7, alert provider")
- Translation / multi-language support
- Auto-save in progress (customer can resume later)

### B. Internal Staff (Tier 3) — forms power contraindication engine
- Intake form responses feed the contraindication engine
- Auto-flagging or blocking of bookings based on form answers (e.g., Isotretinoin yes → block microneedling)
- AI-assisted form drafting from natural-language description

(All other tier features unchanged from v13.)

---

## 10. Permissions System

(Mostly unchanged from v13. Permission category updates:)

**Forms — expanded for unified system**
- `forms.create` — create a new form
- `forms.edit` — edit existing form (creates new version)
- `forms.archive` — archive a form (existing responses preserved, no new fills)
- `forms.attach_to_service` — attach a customer-facing form to a service (typically owner/manager only)
- `forms.fill_internal_own_clients` — fill internal forms about assigned clients only
- `forms.fill_internal_all_clients` — fill internal forms about any client
- `forms.view_responses_own_clients` — see responses to forms about assigned clients
- `forms.view_responses_all` — see all form responses for the business
- `forms.export_responses` — export form responses to CSV

The Provider role template gets `forms.fill_internal_own_clients` and `forms.view_responses_own_clients` by default. Studio Manager gets all forms permissions including building. Front Desk gets `forms.view_responses_all` (read-only) but typically not building permissions.

(All other permissions unchanged from v13.)

---

## 11. Messaging Architecture

(Unchanged from v13.)

---

## 12. Transactional & Operational Automation

(Unchanged from v13. Form-related transactional messages already covered: "Form completion prompt" — sent when a required form hasn't been completed.)

---

## 13. Marketing Campaigns

(Unchanged from v13.)

---

## 14. Forms System (Unified)

This section describes the form builder as a foundational platform layer. **A single builder produces all forms.** Customer-facing intake forms, internal staff forms, post-visit surveys, internal records, consent forms — all built with the same UI, stored in the same data model, just rendered in different contexts.

### Headline design

The form system is unified across:
- **Customer-facing forms** rendered to customers in booking flow, pre-visit messages, kiosk check-in, account dashboard
- **Internal forms** rendered to staff in customer profile, appointment detail screen, dedicated forms inbox

Same builder, same field library, same versioning, same response storage. The difference is just two configuration toggles: scope (customer-facing or internal) and timing (when it appears).

### Why this matters competitively

Mangomint's "Flows" feature is the closest equivalent in incumbents, and operators report it's hard to set up. The configuration UI buries what's possible behind layers of workflow logic. Operators avoid it.

The platform's commitment is the opposite: the builder feels like Google Forms or Typeform — drag a field, configure it inline, save. Anyone who's filled out a form online can build one in this system. **Easy to use is the feature**, not a side benefit. If the form builder isn't immediately accessible to a non-technical operator, it has failed regardless of what features it has.

### Tier 1 (v1) — simplified builder

#### Field types
- Short text (single line)
- Long text (paragraph)
- Single-select (radio buttons or dropdown)
- Multi-select (checkboxes)
- Yes/no toggle
- Date picker
- Number input
- File upload (with size limit)
- Photo upload (with image-only restriction)
- Basic signature (drawn, captured as image — no signed PDF in Tier 1)
- Section divider (visual organization)
- Static text block (instructions, disclaimers)

#### Field properties
- Label
- Required / optional
- Help text
- Default value (where applicable)
- Placeholder text

#### Form properties
- Title
- Description (shown to filler at top of form)
- Scope: **customer-facing** or **internal-only**
- For customer-facing forms — timing trigger:
  - **Pre-booking gate** — must be completed before booking can be confirmed
  - **Pre-visit** — sent ahead of appointment via SMS/email link, completion required for check-in
  - **Post-visit** — sent after appointment (Tier 1 supports basic post-visit; richer aftercare flows in Tier 2)
- For internal-only forms — permission requirement (which staff can fill)
- Service attachments — which services trigger this form (customer-facing only)

#### Form versioning
Editing a form creates a new version. Existing responses remain attached to the version they were filled against — so a tenant can update a form without invalidating historical data. Tenants can see all versions and which is currently active.

#### Response viewer
- All responses to a form, sortable, filterable by date and customer
- Each response shows: who filled it, when, all answers, link to associated customer/booking
- Export to CSV for any form
- Customer profile shows a list of all forms that customer has completed, expandable for full responses

#### Render contexts (Tier 1)
- **Customer-facing — booking flow:** form embedded in booking step, completion required before payment
- **Customer-facing — pre-visit link:** sent via email/SMS, opens in mobile-friendly web view, completion saves and triggers status update on the booking
- **Customer-facing — account dashboard:** customer can see and complete pending forms anytime
- **Internal — customer profile:** "Forms" tab shows internal forms relevant to this customer; staff click to fill
- **Internal — appointment detail:** during/after the appointment, staff can fill in-context forms tied to that booking

### Tier 2 — advanced features

- **Conditional logic** — show/hide fields based on prior answers ("if you answered yes to question 3, show questions 4–6")
- **Branching / skip logic** — different paths through a form based on answers
- **Field validation** — regex patterns, numeric ranges, custom rules with error messages
- **Auto-population** — fields auto-fill from prior responses (e.g., last visit's notes carry forward)
- **True e-signature** — legally compliant signature capture with signed PDF artifact stored as immutable
- **Multi-section forms** — paginated forms with progress indicator
- **Form template library** — platform-provided starters: medical history, photo consent, microneedling intake, brow consultation, etc. Tenant clones and customizes.
- **Score-based outcome routing** — form auto-calculates a score, can trigger alerts, gate bookings, or notify providers based on thresholds
- **Translation support** — multi-language rendering of the same form
- **Auto-save** — customer's in-progress responses saved as they go; can resume later
- **Form analytics** — completion rates, drop-off points, average time to complete

### Tier 3 — clinical depth and AI

- **Contraindication engine** — form responses automatically flag or block bookings based on configurable rules (e.g., "if Isotretinoin = yes, block microneedling and alert provider")
- **AI-assisted form drafting** — describe a form in plain language, AI generates a draft for review and edit
- **Audit trail surfacing** — for HIPAA-mode tenants, full audit log of who viewed/edited each response
- **Form-driven workflows** — completing a form can trigger automation (campaign send, staff task, booking modification)

### Storage and access control

- Form definitions and versions: `forms` and `form_versions` tables
- Form responses: `form_responses` table, with `customer_id`, `booking_id` (nullable), `filled_by_user_id` (for internal forms), `form_version_id`
- Photo/file uploads: Supabase Storage, with RLS policies tied to the customer-permission scope
- Internal-only form responses are not visible to customers, ever — even if the customer is filling adjacent forms
- Customer-facing form responses are visible to the customer in their account dashboard
- All responses subject to permission gates per Section 10

### The "easy to use" UX commitment

The form builder must pass this bar: a beauty/wellness operator who has never used a form builder before can create a working pre-booking form in under 5 minutes, on their first try, without reading documentation. If our builder doesn't pass that bar, it has failed regardless of feature completeness.

Specific UX principles:
- Drag fields from a sidebar onto a canvas
- Configure each field inline (no separate properties panel)
- Live preview of how the form will look to the filler — always visible, side-by-side with the builder
- Save creates a new version implicitly; no separate "publish" step required
- Pre-built field templates (e.g., "Standard photo consent paragraph + signature" as a single drag-and-drop block)

### Implementation cost

A real form builder is meaningful engineering work. Realistic estimate: **3–4 weeks** for the Tier 1 simplified builder (drag-and-drop UI, all field types listed, versioning, response storage, render contexts, permission integration). This becomes its own dedicated phase in the build sequence — Phase F.

The advanced Tier 2 features add another 4–5 weeks when shipped, primarily for the conditional logic engine, e-signature with PDF generation, and template library.

---

## 15. Bot/Voice Integration Layer

(Unchanged from v13 — was Section 14.)

---

## 16. Google Reviews Integration

(Unchanged from v13 — was Section 15.)

---

## 17. Referral Program

(Unchanged from v13 — was Section 16.)

---

## 18. Marketplace Path

(Unchanged from v13 — was Section 17.)

---

## 19. Metrics & Unit Economics

(Unchanged from v13 — was Section 18.)

---

## 20. Tenant Migration & Customer Import

(Unchanged from v13 — was Section 19. Note: form responses are not migrated in v1 — too source-specific. Each tenant rebuilds their forms in the new system. This is an honest tradeoff, called out in the migration section already.)

---

## 21. Data Model Approach

(Mostly unchanged from v13 — was Section 20. Form-related entities expanded:)

### Forms entities — expanded for unified system

| Entity | Purpose |
|---|---|
| `forms` | Form definitions (latest version + metadata) |
| `form_versions` | Immutable schema snapshots — JSON describing fields, types, validation, conditional logic |
| `form_service_attachments` | Junction: which services trigger a customer-facing form |
| `form_permission_requirements` | For internal forms — which permissions are required to fill |
| `form_responses` | Filled responses, linked to customer + (optional) booking + form_version |
| `form_response_attachments` | File/photo uploads attached to responses |
| `form_signatures` *(Tier 2)* | Signed PDF artifacts for e-signature responses |

### New fields on existing entities

**forms**
- `scope` — `customer_facing` or `internal_only`
- `timing` (for customer-facing only) — `pre_booking_gate` / `pre_visit` / `post_visit`
- `is_active` — only one version can be active at a time
- `latest_version_id` — pointer to current version

**bookings**
- `required_form_completions` — array of form IDs that must be completed before this booking can be confirmed
- `pre_visit_form_completions` — array of form responses received pre-visit

(All other data model entities unchanged from v13.)

---

## 22. Key UI Flows

(Flows 1–27 unchanged from v13. New flows:)

### Flow 28: Owner builds a customer-facing pre-booking form *(Tier 1)*
1. Owner opens Forms → New Form
2. Names form: "Microneedling Medical History"
3. Sets scope: **Customer-facing**
4. Sets timing: **Pre-booking gate**
5. Drags fields onto canvas:
   - Section divider: "Medical Information"
   - Yes/no: "Are you currently using Isotretinoin (Accutane)?"
   - Yes/no: "Do you have a history of keloid scarring?"
   - Long text: "List any current medications"
   - Section divider: "Consent"
   - Static text block (with consent paragraph)
   - Basic signature: "I agree to the above"
6. Each field configured inline (label, required toggle)
7. Live preview shows form rendering on the right
8. Saves form
9. Attaches form to "Microneedling" service (in the form's service attachment configuration)
10. From now on, customers booking microneedling complete this form before their booking is confirmed

### Flow 29: Customer fills pre-booking form *(Tier 1)*
1. Customer selects "Microneedling" in booking flow
2. After picking time and provider, instead of going to payment, sees: "Please complete the medical history form"
3. Form renders inline (mobile-responsive)
4. Customer fills, signs, submits
5. Response stored, linked to the booking-in-progress
6. Customer proceeds to deposit + confirmation

### Flow 30: Provider fills internal patch test form *(Tier 1)*
1. Provider opens customer's profile
2. Forms tab shows available internal forms; clicks "Patch Test Record"
3. Form opens with fields: product applied, area, time, observations, follow-up date
4. Provider fills, saves
5. Response stored on customer profile, visible to staff with appropriate permissions
6. Internal forms never appear in the customer's own account view

### Flow 31: Owner edits a form, creating a new version *(Tier 1)*
1. Owner opens existing "Microneedling Medical History"
2. Adds a new field: "Have you received Botox in the last 14 days?"
3. Saves — system creates Version 2
4. New bookings now use Version 2; existing responses against Version 1 remain valid and attached to that version
5. Owner can see version history and which is currently active

(Other flows unchanged.)

---

## 23. Code Repository Structure

(Mostly unchanged from v13 — was Section 22. New module:)

```
booking-platform/
├── apps/
│   └── web/
│       ├── lib/
│       │   ├── ...
│       │   ├── forms/             → form schema, builder logic, rendering, response storage
│       │   ├── form-validation/   → Tier 2 conditional logic + validation engine
│       │   └── ...
└── ...
```

---

## 24. Tech Stack

(Mostly unchanged from v13 — was Section 23. Form-builder addition:)

| Layer | Choice | Notes |
|---|---|---|
| **Form builder UI library** | **TBD with co-founder** — options: react-hook-form + custom drag-and-drop (lightweight), SurveyJS (mature but heavier), build entirely custom | Trade-off between speed of build and bundle size |
| **Form schema storage** | JSON in Postgres | Standard pattern; flexible for evolving field types |

(All other tech stack entries unchanged.)

---

## 25. Build Sequence (v1) — UPDATED

| Phase | Duration (part-time) | Deliverables |
|---|---|---|
| A. Foundation + migration tooling | 8–9 weeks | Tenant model, locations (geo), auth, permissions, admin shell, service catalog, rooms + qualifications, multi-view operator calendar, customer import tool |
| B. Wallet + booking core | 5–6 weeks | Wallet ledger, booking flow with resource conflicts, Stripe payments, deposits → wallet, smart cancellation |
| C. Provider scheduling | 3–4 weeks | Provider self-managed schedule + service availability, computed availability |
| D. Dynamic pricing | 1–2 weeks | Pricing rule builder, pricing engine, surge display |
| E. Customer accounts + messaging + transactional automation | 7–8 weeks | Account dashboard, view/reschedule/cancel, photo upload, two-way messaging (SMS + email), triage queue, Twilio number pool, push notifications, full transactional message suite |
| **F. Forms System** | **3–4 weeks** | **Simplified form builder, all field types, versioning, render contexts (customer-facing booking flow / pre-visit link / account dashboard / internal customer profile), response storage, permission integration, retroactive integration with bookings (pre-booking gates)** |
| G. Bot integration layer | 3–4 weeks | Bot identity, API endpoints, conversation storage, unified inbox display |
| H. Google Reviews | 2–3 weeks | OAuth, polling, matching engine, triage queue, response UI |
| I. Referral program | 3 weeks | Codes, attribution, credit issuance, anti-abuse, dashboards |
| J. Operator depth + waiting room | 5–6 weeks | LTV/CRM views, expanded reports, virtual waiting room (basic) |
| K. Metrics & Unit Economics | 4–5 weeks | Lead model, attribution, cost entries, definitions UI, Tier 1 reports, configurable retention |
| L. Marketing Foundations | 3 weeks | Tier 1 marketing campaigns: audience builder, composer, scheduling, delivery tracking, unsubscribe + frequency cap |
| M. Membership layer | 3–4 weeks | Subscription billing, credits → wallet, book-with-credits, pause/cancel |
| N. Polish + first tenant launch | 2–3 weeks | Email templates, edge cases, first tenant launch |

**Realistic v1 timeline solo: 14–18 months at 15–20 hrs/week.**
**With co-founder leading engineering at significant part-time hours: 9–12 months.**

Phase F is new (3–4 weeks). The Tier 1 form builder is genuine engineering work — drag-and-drop UI, schema management, multiple render contexts — but it's well-bounded and self-contained.

If timeline pressure mounts: Tier 1 forms could potentially ship with a *much* simpler initial version — e.g., a JSON-driven form definition that operators paste in (or that platform owner creates for them per request), with the visual builder coming in v1.5. This is honestly probably the right pragmatic path for first launch, with the full visual builder following 1–2 months later. **Worth a discussion with the co-founder during planning.**

---

## 26. Pre-Launch Calendar Items

(Unchanged from v13.)

---

## 27. Open Decisions

(Mostly unchanged from v13. New items:)

- [ ] **Form builder UI library** — react-hook-form + custom, SurveyJS, or fully custom build?
- [ ] **Tier 1 form builder scope** — full visual builder in v1, or JSON-config in v1 with visual builder in v1.5? (Honest answer for solo/two-person team is the latter.)
- [ ] **Default form templates to ship with the platform** — at minimum: photo consent, generic intake, basic medical history. What else?

(All other open decisions unchanged.)

---

## 28. Questions for the Co-Founder / Engineering Lead

(Mostly unchanged from v13. New items:)

34. **Form builder UI — react-hook-form + react-dnd, SurveyJS, or custom? Trade-offs for our use case?**
35. **Form schema storage — JSON in Postgres works for everything we need, or should we go more relational? Performance considerations as a tenant accumulates 50+ form versions across 20+ active forms?**
36. **E-signature compliance for Tier 2 — is the basic "drawn signature image" we ship in Tier 1 enough for most use cases, or is signed-PDF generation needed sooner?**

---

## 29. Glossary

(Mostly unchanged from v13. New entries:)

| Term | Meaning |
|---|---|
| **Form** | A questionnaire definition built in the platform's form builder, with scope (customer-facing or internal) and timing trigger |
| **Form Version** | An immutable schema snapshot — when a form is edited, a new version is created; existing responses stay attached to their original version |
| **Form Scope** | Whether a form is customer-facing (rendered to customers) or internal-only (rendered to staff) |
| **Form Timing** | For customer-facing forms — when the form is presented: pre-booking gate, pre-visit, or post-visit |
| **Pre-booking Gate** | A form that must be completed before a customer's booking can be confirmed (e.g., medical history before microneedling) |
| **Pre-visit Form** | A form sent to a customer ahead of their appointment via SMS/email link; completion required for check-in |
| **Internal Form** | A form filled out by staff, not visible to customers, used for records like patch tests, incident reports, consultations |
| **Form Response** | A specific customer's or staff member's submission of a form; linked to the form version, customer profile, and (optionally) a booking |
| **Form Builder** | The unified UI tenants use to create both customer-facing and internal forms |

(All other glossary entries unchanged.)

---

## 30. Next Phases

(Unchanged from v13.)

---

*This is a living document. Update as decisions are made or scope changes.*
