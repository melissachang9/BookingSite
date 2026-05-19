# Booking Platform

Multi-tenant booking, forms, and payments platform for beauty studios, med spas, and wellness businesses.

## Current State

This repository currently contains two tracks:

- A new greenfield v1 monorepo scaffold built around FastAPI, React/Vite, Next.js, PostgreSQL, and Docker.
- The legacy `web/` Next.js and Supabase application, kept as a workflow reference while the new stack is rebuilt.

The long-range product direction is documented in [booking_platform_plan.md](booking_platform_plan.md), and the near-term rebuild constraints live in [AGENTS.md](AGENTS.md).

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
├── docs/testing/               # Workflow test inventory for the rebuild
├── web/                        # Legacy Next.js + Supabase app
├── docker-compose.yml          # New stack orchestration
├── booking_platform_plan.md
├── booking_platform_mvp_plan.md
├── workflow-validation-checklist.md
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

## Run The Legacy App

The legacy monolith remains under [web](web) and is not part of the new v1 Compose stack.

```bash
cd web
cp .env.example .env.local
npm install
npm run dev
```

Legacy app runs at `http://localhost:3000`.

Use it as a reference surface while rebuilding the new stack.

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

### Legacy app

Run from `web/`:

```bash
npm run lint
npm run test:calendar
npm run test:checkout
```

## Workflow References

- [docs/testing/workflow-matrix.md](docs/testing/workflow-matrix.md) defines the first workflow-preservation test inventory for the greenfield rebuild.
- [workflow-validation-checklist.md](workflow-validation-checklist.md) contains the manual acceptance checklist for booking, checkout, and form workflows.
- [booking_platform_mvp_plan.md](booking_platform_mvp_plan.md) covers the first-tenant MVP scope.
- [booking_platform_plan.md](booking_platform_plan.md) covers the long-range product plan.

## Notes

- The new v1 stack is intentionally separate from the legacy `web/` app.
- Docker Compose is the main way to run the new platform end-to-end.
- The old Supabase migrations and structure are legacy reference material, not the target architecture for the rebuild.
