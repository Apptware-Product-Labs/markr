# Project: E-Commerce Platform

> A Next.js 15 + Supabase e-commerce platform with Stripe payments, real-time inventory, and multi-tenant storefronts.

---

## Commands

```bash
npm run dev          # Start dev server on :3000
npm run build        # Production build
npm run test         # Vitest unit tests
npm run test:e2e     # Playwright e2e tests
npm run lint         # ESLint + Prettier check
npm run typecheck    # TypeScript strict check
npm run db:migrate   # Run pending Supabase migrations
npm run db:seed      # Seed development database
```

## Tech Stack

- **Framework**: Next.js 15 App Router + React 19 + TypeScript 5 (strict)
- **Database**: Supabase (PostgreSQL 16, RLS, Edge Functions, Storage, Realtime)
- **Payments**: Stripe (Checkout Sessions, Webhooks, Connect for multi-vendor)
- **Styling**: Tailwind CSS 4 + Radix UI + shadcn/ui components
- **State**: Zustand (global UI state only) + SWR (server data)
- **Forms**: React Hook Form + Zod validation
- **Email**: Resend + React Email templates
- **Auth**: Supabase Auth (magic link + OAuth: Google, GitHub)
- **Uploads**: UploadThing (product images, max 4MB each)
- **Testing**: Vitest (unit) + Playwright (e2e) + MSW (API mocking)
- **CI**: GitHub Actions — lint → typecheck → test → build on every PR

## Project Structure

```
src/
├── app/                    Next.js App Router pages + layouts
│   ├── (auth)/             Auth routes (login, signup, magic-link)
│   ├── (shop)/             Customer-facing storefront
│   ├── (admin)/            Merchant dashboard
│   └── api/                API route handlers
├── components/
│   ├── ui/                 shadcn/ui primitives (never modify directly)
│   └── [feature]/          Feature-colocated components
├── lib/
│   ├── supabase/           client.ts, admin.ts, types.ts
│   ├── stripe/             client.ts, webhooks.ts
│   └── utils.ts            cn(), formatPrice(), etc.
├── hooks/                  Custom React hooks
├── schemas/                Zod validation schemas (one per domain)
├── services/               Business logic (no direct DB calls in components)
└── types/                  Shared TypeScript types
```

## Conventions

### Naming
- Files: `kebab-case.ts` for utilities, `PascalCase.tsx` for components
- Components: named exports only — no default exports except page.tsx/layout.tsx
- Hooks: `use` prefix, e.g. `useCart`, `useInventory`
- Services: `[domain]Service.ts`, e.g. `orderService.ts`
- Zod schemas: `[domain]Schema.ts`, match the domain model name

### TypeScript
- `strict: true` — no exceptions
- Avoid `any` — use `unknown` and narrow. ESLint will error on `any`.
- Prefer `type` over `interface` for object shapes
- All function parameters and return types must be explicitly typed
- Use `satisfies` operator for config objects

### Database
- All queries through `src/lib/supabase/client.ts` (never raw fetch)
- `admin.ts` (service-role key) is server-only — never import from `use client` files
- Every new table needs: `id`, `created_at`, `updated_at`, `tenant_id`
- RLS policies required on every user-facing table
- Migrations in `supabase/migrations/` — never edit existing migrations

### API Routes
- Every mutating route (POST/PUT/PATCH/DELETE) validates input via Zod `safeParse`
- Return `{ error: string }` on failure, never throw
- Auth check at the top of every route handler
- Rate limiting on public endpoints via `src/lib/rate-limit.ts`

## Review Guidelines

- PRs must pass lint, typecheck, and unit tests before review
- New components need a Storybook story (or skip with comment explaining why)
- Any change to payment flow requires a second reviewer from the payments team
- Database migrations need DBA sign-off before merging to main
- Performance budget: LCP < 2.5s, FID < 100ms, CLS < 0.1 (measured in CI)
- Accessibility: all interactive elements must be keyboard-navigable (axe-core in CI)

## Common Pitfalls

```typescript
// ❌ Don't import admin client in components
import { supabaseAdmin } from '@/lib/supabase/admin'; // Error in ESLint

// ✅ Use server actions or API routes for privileged operations
// In server action:
import { supabaseAdmin } from '@/lib/supabase/admin'; // Fine here

// ❌ Don't use any
const data: any = await fetchProducts(); // ESLint error

// ✅ Use the generated types
import type { Tables } from '@/lib/supabase/types';
const data: Tables<'products'>[] = await fetchProducts();
```
