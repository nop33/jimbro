# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project philosophy

Jimbro (aka gymbro) is a **workout tracking PWA built intentionally without a frontend framework**. It's a learning project: the goal is to use only native browser APIs + TypeScript + Tailwind. When suggesting changes, respect this constraint.

- **No React/Vue/Svelte/etc.** Use vanilla DOM APIs, `<dialog>`, `<details>`, Custom Events.
- **No runtime dependencies** beyond Tailwind and chart.js. Do not introduce state management libs, routers, utility libs, etc.
- **No SPA router**. Navigation is plain full-page loads between `index.html` files under `/`, `/exercises/`, `/programs/`, `/workouts/`, `/gymtime/`, `/stats/`, `/settings/`. Each page has its own entry in `vite.config.ts` `rolldownOptions.input`.

Data lives in IndexedDB. Once the user saves credentials, it syncs with the Cloudflare Worker in `worker/`, which stores rows in D1. README.md is the reference for product behaviour: features, data model, sync design, worker API and IndexedDB schema.

## Tooling (Vite+)

This project uses **Vite+** (`vp`), a unified toolchain wrapping Vite/Rolldown/Vitest/Oxlint/Oxfmt. Use `vp` commands instead of calling pnpm, npm, vitest or oxlint directly. The root and `worker/` are separate packages with their own dependencies, so run worker commands from `worker/`.

### Common commands

| Task                       | Command                                                |
| -------------------------- | ------------------------------------------------------ |
| Install deps               | `vp install`, then `cd worker && vp install`           |
| Dev server                 | `vp dev` (port 5173)                                   |
| Format + lint              | `vp check` (`vp check --fix` to fix)                   |
| Typecheck                  | `vp run typecheck` and `cd worker && vp run typecheck` |
| Unit tests                 | `vp test run`                                          |
| Single unit test file      | `vp test run tests/dateUtils.unit.test.ts`             |
| Worker tests               | `cd worker && vp run test`                             |
| E2E tests (Playwright)     | `vp run test`                                          |
| Single E2E spec or project | `vp run test tests/gymtime.spec.ts --project=chromium` |
| Build                      | `vp run build` (`tsc && vp build`)                     |
| Preview prod build         | `vp preview`                                           |

- `vp check` runs the format check and the linter, and never typechecks. The root `typecheck` script covers `src/`, `tests/` and the root config files, and the worker's covers `worker/src`, `worker/test` and `worker/vitest.config.mts`. The build typechecks `src/` only. Run both typecheck scripts before committing, as CI does.
- `vp test` is Vite+'s built-in Vitest, so the package.json `test` script (Playwright) runs as `vp run test`. Arguments after it go to Playwright.
- Unit tests import from `vite-plus/test`. Worker tests import from `vitest` and `cloudflare:test`, because the worker has its own Vitest 3.2 with `@cloudflare/vitest-pool-workers`.
- The pre-commit hook runs `vp staged`, which runs `vp check --fix` on the staged files.
- Before changing the worker, D1 or `wrangler.jsonc`, read the current Cloudflare docs (`worker/AGENTS.md`).
- Without `VITE_API_BASE`, the app syncs with the production worker at `https://api.jimbro.nop33.com`. For a manual test with cloud credentials, run the worker locally and point `VITE_API_BASE` at it (README.md, "Run the worker locally").

## Architecture

### Layered structure under `src/`

```
db/       Persistence (IndexedDB) and the in-memory state pages subscribe to
sync/     Cloud sync: outbox push, cursor pull, notices between tabs
pages/    UI layer; one folder per route
features/ Cross-cutting UI (toasts, confetti, hapticFeedback)
```

Pages read and write through the modules in `db/`, which own all IndexedDB access. Every page also loads `src/navigation.ts`, which draws the bottom bar and triggers syncs.

### Persistence layer (`src/db/`)

- `connection.ts` opens the single shared `IDBDatabase` and runs the generic reads. `write.ts` holds `writeRows`, the one write path for local edits. In one transaction it writes the rows, an outbox entry per row and, for sets, the `setGroups` cache. Then it fires `jimbro:rows-written`. `write.ts` also holds the first-sync and pull-page commits. `storage.ts` exposes all of it through the `storage` singleton. Route every write through `storage.writeRows`, since nothing else reaches the outbox or the server.
- `types.ts` declares the row types (`ExerciseRow`, `ProgramRow`, `SessionHeader`, `SetRow`), `Row`, `RowTable` and the export shapes. Import them from there, not through another module.
- `baseStore.ts` is the abstract `BaseStore<T>` (`getAll`, `getById`, `create`, `update`). In `stores/`, `exercisesStore` and `programsStore` drop soft-deleted rows from `getAll` and load the JSON seeds in `seed()`. Each also keeps the live rows in a `ReactiveStore`: pages call `initialize()` on load, `subscribe(cb)` to re-render, and `createExercise`, `updateExercise` and `softDeleteExercise` (or the program versions) to write. Those apply the change in memory first, then persist through `create` or `update`. A failed create rolls back, and a failed update re-`initialize()`s from IndexedDB.
- `workoutSessionsStore` builds a `WorkoutSession` from a session header and its set rows, whose IDs are `sessionId:exerciseId:position`. Its `sessions` object also holds the workout open in gymtime. Each change writes through the store first, recomputes `completed` or `incomplete`, and only then publishes the new session. There is no optimistic update and no rollback.
- `index.ts` exposes `db.exercises`, `db.programs` and `db.sessions`.
- `migrations.ts` holds `DB_VERSION` (9), the version 9 stores for fresh installs, and `upgradeDatabase`, which rebuilds any older database empty so the next sync refills it. A new version becomes an `if (oldVersion < N)` step after the existing one. The `9` in that step stays a literal, so raising `DB_VERSION` never wipes a version 9 database.
- `exerciseLogging.ts` is the registry of exercise kinds, log presets and set slots. `schemaUpgrade.ts` upgrades records from older exports.
- `export.ts` writes JSON export version 4. `import.ts` reads versions 1 to 4, adds only rows whose ID isn't stored yet, and writes through `writeRows`.
- `cloudBackup.ts` keeps the credentials in localStorage and sends requests with the bearer token to `VITE_API_BASE`.
- `reactiveStore.ts` is a small generic `ReactiveStore<T>` (get/set/update/subscribe) used by the stores.

**Dates are stored as ISO strings**, not `Date` objects. Deletes are soft: all four row types carry `isDeleted`, and a deletion syncs like any other change. The stores' `getAll` filters deleted rows out, while import and export read every row through `storage.getAll`.

### Sync (`src/sync/`)

- `rows.ts` holds `canonical`, `rowsEqual` and the export conversion. The worker imports it and `db/types.ts`, so keep both free of browser APIs. The worker typecheck fails when either one uses `document`, `window` or `indexedDB`.
- `syncClient.ts` exports `sync()`. While `meta.cursor` and `meta.bootstrapped` are both 0 it runs a first sync: pull everything, plan each row with `bootstrap.ts`, commit, push. After that it runs a steady sync: push the outbox, then pull pages from the cursor. A steady pull skips rows that have a pending outbox entry and rows equal to the stored copy.
- `outbox.ts` owns the push. `outbox.drain(push)` takes chunks of 500 rows, sends each through `push`, which resolves to the server revision, and acks it. Take, push and ack of a chunk run under the `jimbro:sync-push` Web Lock. Take stamps each entry with the seq and body it sends, and ack drops only entries whose seq is unchanged, so an edit made during a push stays queued. On a database that has never synced, each ack also moves `cursor` or sets `bootstrapped` in the same transaction. `syncClient.ts` passes the `/api/push` request as `push`. Unit tests pass an in-memory server and lock through `createOutbox`.
- `navigation.ts` calls `sync()` on page load, on `online`, when the tab becomes visible, and 2 s after the last `jimbro:rows-written`. Settings has "Sync now". `sync()` does nothing without credentials or offline. A call during a running sync waits for it and queues one more run.
- `jimbro:rows-written` and `jimbro:sync-settled` fire on `window` in the tab that wrote or synced. Other tabs get them only as `onPageNotice` callbacks from `pageChannel.ts`, a BroadcastChannel named `jimbro`, so a page that must react to every tab listens to both, as `CloudBackup` does. `jimbro:open-session-pulled` fires when a pull changed the session open in gymtime.

### Worker (`worker/`)

- `src/index.ts` routes `GET /api/ping`, `POST /api/push`, `GET /api/pull?cursor=&limit=`, `GET /api/export` and `POST /mcp`. A bearer token maps to a user through `AUTH_TOKENS`, a JSON object of token to user ID. CORS allows the production origin, `http://localhost:5173`, and `DEV_ORIGIN`, which only local runs set.
- `src/rows.ts` validates pushed rows and upserts them. A changed row gets the user's next `rev` and an unchanged one keeps its own. Pulls page by `rev`. The validation keeps its own lists of kinds, presets, muscle groups and set fields, so mirror any change to `src/db/exerciseLogging.ts` or `src/db/muscleGroups.ts` there. Otherwise a push that carries the new values fails with `invalid_row` and the outbox stops draining.
- `src/mcp.ts` answers four read-only tools over JSON-RPC.
- `migrations/` is the D1 schema, one table per row type.

### Event emitter (`src/eventEmitter.ts`)

Generic `EventEmitter<EventMap>` extending `EventTarget`, used for typed custom events. Prefer this + the state subscribe pattern over ad-hoc DOM events for cross-module communication.

### Pages (`src/pages/<route>/`)

Each route has its own entry module (e.g. `src/pages/gymtime/index.ts`) bootstrapped from its `index.html`. Pages are typically composed of:

- A top-level page class/module (e.g. `GymtimePage.ts`) that owns lifecycle + rendering.
- Per-component classes for cards, dialogs, forms (e.g. `ExerciseCard.ts`, `BreakTimerDialog.ts`).
- Procedural entry in `index.ts` that calls `*.initialize()` / mounts the DOM.

The gymtime page is the most complex. `ExerciseCardList.render()` rebuilds every card and keeps the scroll position and the open card. `GymtimePage` rereads the open session on `jimbro:open-session-pulled` and on other tabs' notices, and re-renders only when the session changed. The page also runs the break timer, wake lock and geolocation, and downloads a JSON export on workout completion when cloud sync is off.

## TypeScript conventions

- Strict mode, ES2022 target.
- **Derive types from `as const` arrays** instead of enums:
  ```ts
  export const MUSCLE_GROUPS = ['quads', 'calves', ...] as const
  export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]
  ```
- Prefer `unknown` over `any`.
- Interfaces for data shapes (`ExerciseRow`, `ProgramRow`, `SessionHeader`, `SetRow`, `WorkoutSession`, etc.).

## Formatting

Configured in `vite.config.ts` under `fmt`: single quotes, no semicolons, no trailing commas, printWidth 120. Run `vp fmt` to apply. It formats Markdown too.

## Testing notes

- Playwright runs every `tests/*.spec.ts` on chromium, webkit and Mobile Safari (iPhone 12) in parallel.
- Playwright starts the dev server on port 5173 with `VITE_API_BASE` pointing at the test worker. Outside CI it reuses a server already listening on 5173, so stop your own `vp dev` before a run.
- Global setup (`tests/localWorker.ts`) starts one fresh `wrangler dev --local` per run on `WORKER_PORT` (default 8790), with its own D1 state and tokens, and stops it at the end. It needs `cd worker && vp install`. A busy port fails the tests that need the worker with a clear message, instead of reusing whatever listens there. `claimUser()` gives each test its own user.
- `tests/tsconfig.json` maps `/src/*` to `../src/*`, so `await import('/src/db/storage.ts')` inside `page.evaluate` is typed. Specs use such imports to drive app modules in the page.
- `sync.spec.ts` syncs with the real local worker, and `gymtimeSync.spec.ts` with a fake one built on `context.route`. `dbSchema.spec.ts` checks the version 9 schema and the rebuild of older databases, `jsonImport.spec.ts` the Settings import, `rowWrites.spec.ts` `writeRows`, and `manifest.spec.ts` the manifest's icons and screenshots. Most other specs cover one page each.
- Unit tests live alongside e2e specs in `tests/` but use the `.unit.test.ts` suffix so they're routed to Vitest via the `vite.config.ts` `test.include`. `outbox.unit.test.ts` runs the push races on `fake-indexeddb`, with a fresh `IDBFactory` and `Storage` per test.
- Worker tests (`worker/test/*.spec.ts`) run in workerd, with the D1 migrations applied by `test/apply-migrations.ts`. The `*.perf.spec.ts` files check query counts and time budgets.
