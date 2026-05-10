# BookingSite

Modern, multi-tenant booking + intake platform for beauty studios, med spas, and wellness businesses.

## Status

**Phase 0 — foundations.** First tenant: Brow Beauty Lab. See [booking_platform_mvp_plan.md](booking_platform_mvp_plan.md) for v1 scope and [booking_platform_plan.md](booking_platform_plan.md) for the long-range vision.

## Repo layout

```
.
├── web/                          # Next.js 16 app (admin + booking site + customer dashboard)
├── booking_platform_plan.md      # Long-range vision (v14)
├── booking_platform_mvp_plan.md  # v1 first-tenant MVP plan (current source of truth for build)
├── alex-hormozi-booking-app-guiding-principles.md
├── booking-app-metrics-for-cac-ltv.md
└── cofounder_review_packet.md
```

## Getting started

```bash
cd web
cp .env.example .env.local   # then fill in Supabase + Stripe keys
npm install
npm run dev
```

App runs at http://localhost:3000.

## Tech stack (v1, locked)

- Next.js 16 (App Router) + TypeScript + Tailwind 4
- Supabase (Postgres + Auth + Storage + RLS)
- Stripe Checkout for deposits
- Resend for transactional email
- Twilio for SMS reminders
- Vercel hosting
- shadcn/ui, react-hook-form, zod

## URL structure (v1)

Path-based: `bookingsite.com/<tenant-slug>`. Custom domains land in v1.1.
