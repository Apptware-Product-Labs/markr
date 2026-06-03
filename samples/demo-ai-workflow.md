# CLAUDE.md — BenchMark Platform

> You are working on **BenchMark**, an employee resource management platform built with Next.js 16, Supabase, and Tailwind CSS. Read this file completely before writing any code.

---

## Project Context

BenchMark manages employee allocation, leave, timesheets, reimbursements, and org-chart visualisation for Apptware Labs and its clients. It is a multi-tenant SaaS product — every query must be scoped to `tenant_id`.

**Current sprint:** Phase 1 Foundation — hardening the engineering substrate before adding features.

---

## Architecture

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 16 App Router + React 19 | Server components by default |
| Database | Supabase (PostgreSQL) | 69 migrations, RLS enabled |
| Auth | Supabase Auth | Service-role key is server-only |
| Styling | Tailwind CSS 4 + shadcn/ui | Components in `src/components/ui/` |
| State | Zustand (sparingly) + SWR | SWR for all data fetching |
| Validation | React Hook Form + Zod | Every mutating route uses `safeParse` |
| Email | Resend | Transactional only |

---

## Critical Rules

### Multi-tenancy — never skip this
Every database query MUST include `tenant_id`:

```sql
-- ✅ Correct
SELECT * FROM employees WHERE tenant_id = current_tenant_id();

-- ❌ Wrong — leaks data across tenants
SELECT * FROM employees;
```

Every new table must include:
```sql
tenant_id UUID NOT NULL REFERENCES tenants(id)
```

### API route conventions

```typescript
// Every mutating route pattern
export async function POST(req: Request) {
  const body = await req.json();
  const parsed = MySchema.safeParse(body);
  if (!parsed.success) return ApiErrors.badRequest(parsed.error);

  // ... business logic

  return NextResponse.json({ ok: true });
}
```

### File structure
```
src/
├── app/           # Next.js App Router pages + API routes
├── components/    # Feature-based folders + ui/ for shadcn primitives
├── lib/           # Utilities, Supabase client, helpers
├── schemas/       # Zod schemas — one per domain
├── types/         # TypeScript types
└── services/      # Domain services (Phase 1 Sprint 4)
```

---

## What NOT to do

- Never import the service-role key in a `"use client"` file
- Never use `any` (ESLint will error after Sprint 1 lands)
- Never skip input validation on POST/PUT/PATCH/DELETE routes
- Never query `hq_*` prefixed tables — those belong to BenchMark HQ

---

## Current Sprint Tickets

| ID | Title | Status |
|----|-------|--------|
| F1.1 | CI pipeline (ESLint + TypeScript + Playwright) | 🟡 In progress |
| F1.2 | Self-host fonts (remove Google Fonts CDN call) | ⬜ Backlog |
| F1.3 | TypeScript strict mode | ⬜ Backlog |
| F1.5 | Regenerate database types via `supabase gen types` | ⬜ Backlog |
| F1.6 | ESLint `no-any` rule | ⬜ Backlog |
| T1.4 | Add `tenant_id` to all new tables | 🟡 In progress |

---

## Useful Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check
supabase start       # Local Supabase
supabase gen types typescript --local > src/types/database.ts
```

---

> [!IMPORTANT]
> The `public.tenants`, `public.audit_log`, and `provision_tenant()` RPC are consumed by BenchMark HQ. Renaming or changing their schema silently breaks the HQ admin app. Always file a paired HQ PR.
