# Decisions and deviations from IMPLEMENTATION_PLAN.md

Each entry: what changed, and why.

## Phase 0

- **zod 4 instead of zod 3 + `zod-to-json-schema`.** `npm audit` flags zod < 4.6.6 (memory exhaustion, GHSA-mrhx-c7xc-m3w5). Zod 4 ships `z.toJSONSchema`, so `zod-to-json-schema` is dropped. Same "one schema source" goal, one fewer dependency.
- **Tailwind v4 via `@tailwindcss/vite`.** Plan lists `tailwindcss` only; v4 needs no PostCSS config and the Vite plugin is the supported path.
- **Extra tooling deps (not runtime):** `typescript`, `@types/*` (type-checking is required by "strict mode"), `supertest` + `@types/supertest` (HTTP assertions in server tests; required to test `/api/integrations` without leaking secrets).
- **Vite 8 / Vitest 5 / Express 5 / React 19** are the current majors on npm at build time (2026-10-24); nothing in the plan pins older ones.
- **Engine is consumed as TypeScript source** (`main: src/index.ts`): `tsx` (server), Vite (client) and Vitest all compile it, so there is no engine build step.
- **Integration state in Phase 0 is `mock` | `configured`, never `live`.** "Live" requires a real successful request (plan Section 12); that check lands in Phase 6.
