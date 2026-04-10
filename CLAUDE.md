# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Philosophy

Jimbro (aka gymbro) is a **workout tracking PWA built intentionally without a frontend framework**. It's a learning project: the goal is to use only native browser APIs + TypeScript + Tailwind. When suggesting changes, respect this constraint.

- **No React/Vue/Svelte/etc.** Use vanilla DOM APIs, `<dialog>`, `<details>`, Custom Events.
- **No runtime dependencies** beyond Tailwind and chart.js. Do not introduce state management libs, routers, utility libs, etc.
- **No SPA router**. Navigation is plain full-page loads between `index.html` files under `/`, `/exercises/`, `/programs/`, `/workouts/`, `/gymtime/`, `/settings/`. Each page has its own entry in `vite.config.ts` `rolldownOptions.input`.

## Tooling (Vite+)

This project uses **Vite+** (`vp`), a unified toolchain wrapping Vite/Rolldown/Vitest/Oxlint. Do **not** invoke pnpm/npm/vitest/oxlint directly — use `vp` commands. Package manager calls are wrapped automatically via the `packageManager` field.

### Common commands

| Task                      | Command                                              |
| ------------------------- | ---------------------------------------------------- |
| Install deps              | `vp install`                                         |
| Dev server                | `vp dev` (or `pnpm dev`)                             |
| Format + lint + typecheck | `vp check`                                           |
| Lint only                 | `vp lint`                                            |
| Format                    | `vp fmt`                                             |
| Unit tests (Vitest)       | `pnpm test:unit` → `vp test run "**/*.unit.test.ts"` |
| Single unit test file     | `vp test run tests/dateUtils.unit.test.ts`           |
| E2E tests (Playwright)    | `pnpm test` → `playwright test`                      |
| Single E2E spec           | `playwright test tests/gymtime.spec.ts`              |
| Single E2E project        | `playwright test --project=chromium`                 |
| Build                     | `pnpm build` → `tsc && vp build`                     |
| Preview prod build        | `vp preview`                                         |

Unit tests use `*.unit.test.ts` and import from `vite-plus/test` (not `vitest`). E2E tests use `*.spec.ts` and Playwright auto-starts the dev server (`vp run dev` on port 5173).

Note: TypeScript typechecking is part of the production build (`tsc && vp build`). `vp check` also runs it.

## Architecture

### Layered structure under `src/`

```
db/       — Persistence (IndexedDB)
state/    — Reactive in-memory state + actions (optimistic updates)
pages/    — UI layer; one folder per route
features/ — Cross-cutting UI (toasts, confetti, hapticFeedback)
```

The three layers flow **page → state → db**. Pages never talk to IndexedDB directly; they go through a `*State` class which wraps optimistic updates + rollback and persists via `db.exercises` / `db.programs` / workout session store.

### Persistence layer (`src/db/`)

- `storage.ts` — single shared `IDBDatabase` connection (singleton). All stores share it.
- `baseStore.ts` — abstract `BaseStore<T extends Entity>` with generic CRUD against a named object store.
- `stores/` — concrete stores (`exercisesStore`, `programsStore`, `workoutSessionsStore`), exported as singletons.
- `index.ts` — exposes `db.exercises` and `db.programs` namespace.
- `migrations.ts` — versioned IDB migrations; `getLatestDbVersion()` drives the `IDBDatabase.open(_, version)` call. Current schema is v4 with stores `exercises`, `programs`, `workoutSessions` (the latter keyed by UUID with indexes on `date` and `programId`).
- `export.ts` / `import.ts` — JSON v2 export/import; import merges by ID and is backward-compatible with v1. Uses unfiltered reads so soft-deleted rows don't collide.
- `reactiveStore.ts` — small generic `ReactiveStore<T>` (get/set/update/subscribe) used by the state layer.

**Dates are stored as ISO strings**, not `Date` objects. Soft-delete is via an `isDeleted` flag — `BaseStore.getAll` typically returns only non-deleted entities; imports/exports need the unfiltered variant.

### State layer (`src/state/`)

`ExercisesState`, `ProgramsState`, and `GymtimeSessionState` are **static singleton classes** wrapping a `ReactiveStore`. They:

1. Apply optimistic updates to local state immediately.
2. Persist to IDB via `db.*`.
3. On failure, roll back (for simple ops) or re-`initialize()` from disk (for updates).

Pages subscribe to state changes via `ExercisesState.subscribe(cb)` etc. Call `initialize()` on page load to hydrate from IDB before rendering.

### Event emitter (`src/eventEmitter.ts`)

Generic `EventEmitter<EventMap>` extending `EventTarget`, used for typed custom events. Prefer this + the state subscribe pattern over ad-hoc DOM events for cross-module communication.

### Pages (`src/pages/<route>/`)

Each route has its own entry module (e.g. `src/pages/gymtime/index.ts`) bootstrapped from its `index.html`. Pages are typically composed of:

- A top-level page class/module (e.g. `GymtimePage.ts`) that owns lifecycle + rendering.
- Per-component classes for cards, dialogs, forms (e.g. `ExerciseCard.ts`, `BreakTimerDialog.ts`).
- Procedural entry in `index.ts` that calls `*.initialize()` / mounts the DOM.

The gymtime page is the most complex — it preserves scroll position and open `<details>` across re-renders, handles break timer + notifications + wake lock + geolocation, and triggers auto-export on workout completion.

## TypeScript conventions

- Strict mode, ES2022 target.
- **Derive types from `as const` arrays** instead of enums:
  ```ts
  export const MUSCLE_GROUPS = ['Quads', 'Calves', ...] as const
  export type MuscleGroup = typeof MUSCLE_GROUPS[number]
  ```
- Prefer `unknown` over `any`.
- Interfaces for data shapes (`Exercise`, `Program`, `WorkoutSession`, etc.).

## Formatting

Configured in `vite.config.ts` `fmt:` — single quotes, no semicolons, no trailing commas, printWidth 120. Run `vp fmt` to apply.

## Testing notes

- E2E tests cover pages end-to-end (exercises, programs, workouts, gymtime, settings, home) plus XSS mitigation/repro specs. Playwright runs chromium, webkit, and Mobile Safari (iPhone 12) projects in parallel.
- Unit tests live alongside e2e specs in `tests/` but use the `.unit.test.ts` suffix so they're routed to Vitest via the `vite.config.ts` `test.include`.
