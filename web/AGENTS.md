<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Legacy Web Guide

This directory is the legacy Next.js and Supabase application. It is no longer the target architecture for the rebuild.

## Default stance

- Treat `web/` as a behavior reference, parity reference, or maintenance surface.
- Do not automatically add new greenfield platform features here when they belong in `backend/`, `apps/dashboard/`, or `apps/storefront/`.

## When you should work here

- The user explicitly asks for a legacy fix or enhancement in `web/`
- You need to inspect or preserve existing workflow behavior while rebuilding the new stack
- You need parity notes, edge cases, or test expectations from the current live behavior

## Rules

- Respect current production-like behavior; avoid speculative refactors in this directory.
- Use this app to harvest workflow details, not to define the long-term architecture.
- If a change affects booking, forms, payments, permissions, or tenant boundaries, capture the behavior clearly so the greenfield rebuild can preserve what matters.
