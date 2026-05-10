# Co-Founder Review Packet

*Purpose: get you oriented to the project quickly so our first design session is productive.*
*Companion to: `booking_platform_plan.md` (v14 — the source of truth, ~30 sections, comprehensive).*
*Last updated: May 3, 2026*

---

## TL;DR — what we're building

A multi-tenant SaaS booking + client-experience platform for **beauty studios, med spas, and wellness businesses**. Replaces incumbents like Mangomint, Boulevard, Zenoti, and Mindbody with operator-first tooling, a unified customer record, native AI/bot integration, native marketing automation, a unified form builder, and a wallet-based money model.

Architecture is multi-tenant from day one with the explicit goal of selling to additional tenants over time. Optional consumer marketplace layer (Tier 3) is architected for but not built in v1. Two confirmed launch tenants (an established appointment-driven studio and a pre-launch membership wellness club) drive product validation.

---

## What I bring vs. what you bring

**I lead:** product, design, operator domain expertise (10 yrs running a permanent makeup studio on incumbents), customer-facing UX, business strategy, sales/onboarding when we have tenants.

**You lead:** engineering, AI integrations, technical architecture, infrastructure, code review.

**We co-decide:** scope cuts, hiring, timeline tradeoffs, anything customer-facing with technical implications.

---

## What's already decided (please push back if you disagree)

These are 23 architectural principles baked into the planning doc. The headline ones:

### 1. Multi-tenant from day one (Principle 2)
Every record scoped to `business_id`. Postgres row-level security enforces isolation. Non-negotiable for a sellable platform.

### 2. Wallet-first money architecture (Principle 1)
Every dollar a customer has with a business lives in their wallet — derived from an immutable append-only ledger. Deposits, package credits, membership credits, refunds-to-credit, gift cards, **referral credits** — all the same entity with different reason codes. Most important data model decision in the project.

### 3. Permissions are first-class — no hardcoded roles (Principle 7)
No `if (user.role === 'admin')` anywhere. Every privileged action checks `hasPermission(actor, permission_key, business_id)`. ~70+ atomic permissions seeded at install. 8 starter role templates that businesses can clone and customize per individual.

### 4. Bots are first-class actors (Principle 14)
Voice receptionists, chat bots authenticate via API token, have their own permission scope, and are audit-attributed. Specific bots live outside the platform; the platform provides the API surface they call. **My existing voice bot (Emma, on OpenAI Realtime) integrates via this API rather than being rebuilt.**

### 5. Unified customer record (Principle 15)
SMS, email, voice transcripts, bot chats, Google reviews, intake forms, charts, plans, photos, referrals — all on the same customer profile. The customer file is the source of truth for that relationship.

### 6. Provider-driven scheduling (Principle 5)
Providers self-manage their schedule and which services they offer in which windows. Service availability is **computed** from these rules, not stored.

### 7. Resources are first-class (Principle 8)
Bookings consider room and equipment availability, not just provider availability.

### 8. Platform-owned messaging infrastructure (Principle 13)
Platform owns SMS (Twilio number pool, A2P 10DLC at platform level) and email infrastructure centrally. Tenants don't pick numbers, register campaigns, or manage carriers — they experience messaging as "it just works."

### 9. AI as a primitive, not a bolt-on (Principle 16)
Built clean in 2026 with AI integration designed in from the start. Bot conversations, AI-drafted review responses, AI plan drafting (Tier 3), no-show prediction (Tier 3), demand forecasting (Tier 3), and contraindication engines (Tier 3) all share a common AI infrastructure layer.

### 10. Marketing automation is native, not bolted on (Principle 22)
Tenants don't need Mailchimp or Klaviyo. Source-of-truth is the platform; campaigns sent from where data lives. Tier 1 = manual segment sends. Tier 2 = full automation, recurring, attribution into metrics.

### 11. Forms are a unified, first-class platform layer (Principle 23)
Single drag-and-drop builder produces both customer-facing and internal staff forms. Same UI, same field types, same versioning. Direct competitive win against Mangomint's Flows (which are conceptually right but operationally inaccessible).

### 12. Retention metrics adapt to business cycle (Principle 20)
No hardcoded 30/60/90 day reporting like Mangomint. Per-business AND per-service configurable retention windows, cohort-based retention curves as the primary visualization. After 6+ months of data, the platform calculates **empirical return intervals** per service from real booking history.

### 13. Unit economics are first-class (Principle 18)
Lead identity separate from customer. UTM capture and source attribution on every entry point. Stable IDs and timestamps preserved at every funnel stage. Definitions of lead, qualified lead, new customer, and churn explicit per business.

### 14. Imported customers preserve their truth (Principle 21)
When tenants migrate from incumbents, customers carry their actual acquisition date and pre-platform lifetime data — not the import date. Reports distinguish imported vs. native customers everywhere. **This is one of the most important features for any tenant switching from another platform.**

### 15. Marketplace-ready data model (Principle 17)
The data model supports a future opt-in consumer marketplace (Tier 3) without re-architecture. Locations carry geographic data from day one; service taxonomy is structured for cross-tenant categorization; tenant marketplace opt-in flag exists from v1.

### 16. Provisional tech stack
- Next.js (subdomain routing for tenants)
- Supabase (Postgres + Auth + Storage + RLS + Realtime)
- Stripe (eventually Stripe Connect)
- Twilio (SMS) + Resend/SendGrid (email)
- Vercel + Supabase hosting
- Anthropic API for AI features
- For Tier 2: Daily.co or Twilio Video for telehealth
- For Tier 3: PostGIS for geo, Typesense or Meilisearch for marketplace search

**This is the part I most want your input on.** I picked these because they're what I know and they're a defensible default, but you should confirm or counter before we commit.

---

## The major platform pillars (each is a deep-dive section in the full doc)

The planning doc has dedicated sections for each of these systems:

| Pillar | Section | What it covers |
|---|---|---|
| Permissions | §10 | Catalog of ~70+ atomic permissions across 14 categories, 8 starter templates |
| Messaging | §11 | Two-way SMS/email, unified threads, triage queue, channel-per-message |
| Transactional automation | §12 | All operational messages — confirmations, reminders, receipts, post-visit, referral notifications |
| Marketing campaigns | §13 | Tier 1 manual segment sends, Tier 2 automation/triggers/attribution, Tier 3 sequences |
| Forms (unified) | §14 | Customer-facing + internal forms from one builder, 12 field types in v1 |
| Bot integration | §15 | API surface for voice/chat bots; bot identity, conversation storage, audit |
| Google Reviews | §16 | Polling, confidence-scored attribution to customers, triage queue, response UI |
| Referral program | §17 | Codes, attribution, credit issuance through wallet, anti-abuse, dashboards |
| Marketplace path | §18 | Tier 3 future, but data model accommodates it now |
| Metrics & unit economics | §19 | Lead model, attribution, cost entries, definitions UI, configurable retention |
| Tenant migration | §20 | CSV import with full historical data preservation, rollback window, duplicate detection |

Each section is self-contained — read what's relevant to your judgment.

---

## Where I want your input first

In rough order of impact:

### 1. Tech stack validation
Does Next.js + Supabase fit your mental model for this scope? Concerns about Supabase at multi-tenant scale, Postgres RLS at 70+ permissions, Realtime for messaging + waiting room, or any pieces of the stack worth replacing?

### 2. Bot API design (your wheelhouse)
The doc proposes a versioned REST API (`/api/v1/bot/*`) with token auth and scoped permissions. Want your read on:
- Token + permission patterns at scale
- REST vs. alternatives (gRPC? webhooks-out plus REST-in?)
- Long-running bot conversation handling
- Rate limiting and abuse prevention

### 3. Wallet ledger implementation
The "balance is always derived from sum of transactions" pattern. Standard but has gotchas (concurrency, indexing, reporting performance). Want your input on actual table structure, indexes, helper functions.

### 4. Permissions + RLS reconciliation
The planning doc proposes both Postgres RLS *and* application-level permission checks. That's belt-and-suspenders — and it's not obvious where each layer should be authoritative. Worth a real discussion.

### 5. Realtime architecture
Messaging and the virtual waiting room both need real-time updates. Supabase Realtime is proposed. Concerns at scale? Alternatives?

### 6. Analytics and metrics implementation
Materialized views vs. on-demand queries vs. dbt-style transformations? At what scale does each break? Cohort retention curves and per-tenant attribution computations have real performance implications.

### 7. Twilio number pool management
A2P 10DLC compliance, auto-replenishment patterns, recycling when tenants churn.

### 8. Form builder UI
react-hook-form + react-dnd, SurveyJS, or fully custom? Trade-offs?

### 9. Background worker architecture
Reliability requirements for transactional messaging are real (a missed appointment reminder costs the tenant money). Inngest, BullMQ, pg-boss?

### 10. Honest scope realism check
The full v1 (everything in Tier 1) is **9–12 months** for two people part-time, with you leading engineering. Where would you cut to ship sooner? My instinct on what's deferrable: Phase L (Marketing Foundations) → v1.5; Phase J (Operator Depth — full reports could be lighter); the Tier 1 form builder could ship as JSON-config first with visual builder in v1.5.

---

## Three concrete questions for our first session

1. **What's wrong with the architecture as written?** Be blunt. I'd rather adjust now than three months in.
2. **What's missing that you'd add?** Especially anything AI-related where my instincts are weaker than yours.
3. **What's the smallest possible first deployable slice?** I've been planning toward "complete v1." With a real engineering co-founder, you might see a smaller slice that ships earlier and validates the platform with real users.

---

## What we should decide together soon

- [ ] Project name (gates A2P 10DLC, Stripe approval, and Google OAuth verification — all of which take weeks of calendar time)
- [ ] Business entity (gates Stripe + A2P)
- [ ] Tech stack lock-in
- [ ] Equity / co-founder agreement (separate from this doc — get in writing before we build)
- [ ] Working cadence (sync schedule, async tools, code review process)
- [ ] First milestone definition

---

## Pre-launch calendar items that gate launch independently of code

These run in parallel with development but have minimum durations:

| Item | Duration | When to start |
|---|---|---|
| A2P 10DLC Brand + Campaign Registration | 2–6 weeks | Phase A — start as soon as platform name + entity set |
| Stripe account approval (esp. Stripe Connect) | 1–2 weeks | Phase B |
| Email domain authentication (DKIM/SPF/DMARC) | 1 week | Phase A |
| Twilio account approval + initial number pool | Immediate–1 week | Phase A |
| Google Cloud Console + OAuth verification (for Reviews) | 2–6 weeks | Phase H |
| Legal: Terms of Service, Privacy Policy, DPA | 2–4 weeks (with counsel) | Phase J |

The A2P registration is the longest pole. Worth filing applications as soon as the platform name and business entity are set, even if code isn't ready.

---

## What's already in motion

- 14 versions of the planning doc, refined over many sessions
- Competitive teardown (real SaaS competitors: Boulevard, Mangomint, Phorest, Zenoti, Mindbody. Best-in-class operator references: Heyday, Peachy, Glowbar — who all custom-built their own software)
- ~70 permissions catalogued with 8 starter role templates
- Data model entity sketch (~60+ entities across Tier 1–3)
- Build sequence draft (Phases A–N, ~14 phases for v1)
- 31 UI flows documented
- Pre-launch calendar items identified

---

## How to read the full planning doc

It's long (~50 pages). Suggested reading order for a first pass:

1. **Sections 1–3** — vision, target customers, user types (5 min)
2. **Section 5** — 23 architectural principles (15 min) — *the most important section*
3. **Section 9** — feature catalog by user × tier (15 min)
4. **Sections 11–14** — deep dives on messaging, transactional automation, marketing campaigns, forms (30 min)
5. **Sections 15–17** — bot integration, Google Reviews, referrals (20 min)
6. **Sections 19–21** — metrics, migration, data model approach (25 min)
7. **Section 28** — questions for the consulting programmer (now: questions for you) (5 min)

Skip on first pass: Sections 6–8 (philosophy / competitive landscape — useful but not load-bearing), Section 18 (marketplace — Tier 3), Section 22 (UI flows — better as reference), Section 29 (glossary — use as needed).

**Total time investment for a productive first review: ~2 hours.**

---

## Bottom line

We have a comprehensive plan. What's missing is your engineering judgment overlaid on it — what's right, what's wrong, what's missing, what's overscoped. I want our first design session to be a real working session, not me presenting at you. Come with reactions, alternatives, and your own priorities for what we tackle first.

Excited to build this with you.
