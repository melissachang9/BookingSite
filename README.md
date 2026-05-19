# Booking Platform

Multi-tenant booking, forms, and payments platform for beauty studios, med spas, and wellness businesses.

## Current State

This repository contains the greenfield v1 monorepo scaffold built around FastAPI, React/Vite, Next.js, PostgreSQL, and Docker. Product, workflow, testing, and architecture constraints live in [AGENTS.md](AGENTS.md) and the nearest repo-local `AGENTS.md` files.

## Docker Files

There is not a single root `Dockerfile`.

- Root orchestration: [docker-compose.yml](docker-compose.yml)
- Backend image: [backend/Dockerfile](backend/Dockerfile)
- Dashboard image: [apps/dashboard/Dockerfile](apps/dashboard/Dockerfile)
- Storefront image: [apps/storefront/Dockerfile](apps/storefront/Dockerfile)

The root Compose file is the main entry point for running the new stack.

## Repository Layout

```text
.
├── backend/                     # FastAPI backend
├── apps/
│   ├── dashboard/              # React/Vite staff app
│   └── storefront/             # Next.js public booking app
├── packages/
│   ├── shared-types/           # Shared frontend contracts
│   └── ui-components/          # Shared UI primitives
├── docker-compose.yml          # New stack orchestration
└── AGENTS.md
```

## Run The New V1 Stack With Docker

### Prerequisites

- Docker Desktop
- Git

### Start everything

Run from the repository root:

```bash
docker compose up --build -d
```

This starts:

- PostgreSQL on `localhost:5433`
- FastAPI backend on `http://localhost:8000`
- API docs on `http://localhost:8000/docs`
- React/Vite dashboard on `http://localhost:5173`
- Next.js storefront on `http://localhost:3001`

### Stop everything

```bash
docker compose down
```

## Run The New V1 Stack Without Docker

This is optional. Docker is the primary supported runtime model.

### Backend

```bash
cp backend/.env.example backend/.env
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend endpoints:

- Root: `http://localhost:8000/`
- Health: `http://localhost:8000/api/v1/health/live`
- Docs: `http://localhost:8000/docs`

### Dashboard

```bash
cp apps/dashboard/.env.example apps/dashboard/.env
cd apps/dashboard
npm install
npm run dev
```

Dashboard runs at `http://localhost:5173`.

### Storefront

```bash
cp apps/storefront/.env.example apps/storefront/.env
cd apps/storefront
npm install
npm run dev
```

Storefront runs at `http://localhost:3000` when started directly, or `http://localhost:3001` through Docker Compose.

## Verification Commands

### New backend

```bash
cd backend
source venv/bin/activate
pytest tests -q
```

### New dashboard

```bash
cd apps/dashboard
npm install
npm run typecheck
```

### New storefront

```bash
cd apps/storefront
npm install
npm run typecheck
```

### Browser end-to-end tests

The browser E2E suite uses Playwright from the repository root. It defaults to the Docker stack URLs: storefront at `http://127.0.0.1:3001` and API at `http://127.0.0.1:8000/api/v1`.

```bash
npm install
npm run test:e2e:install
npm run test:e2e
```

Playwright reuses a running storefront in local development. If one is not already available, it starts `docker compose up --build` and waits for the storefront URL. To run against an already managed stack, set `E2E_SKIP_WEB_SERVER=1`. Override URLs with `E2E_STOREFRONT_BASE_URL` and `E2E_API_BASE_URL` when needed.

## Product Workflow Summary

- Public booking flows move through service selection, provider or location selection where applicable, slot hold, required forms, payment, and confirmation.
- Operator booking flows begin from calendar context and preserve the same slot-hold and availability rules as public booking.
- Forms are unified but scoped: customer-facing forms and internal forms share field infrastructure without mixing permissions or timing.
- Payment and checkout history should be auditable through append-only events, including deposit collection, balance collection, refunds, and follow-up balances.
- Tenant settings drive cancellation windows, refund behavior, reminders, lead time, maximum advance booking, deposits, no-show fees, payment link expiry, and tax rates.

## Notes

- Docker Compose is the main way to run the new platform end-to-end.
