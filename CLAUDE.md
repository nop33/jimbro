# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project philosophy

Jimbro (aka gymbro) is a **workout tracking PWA built intentionally without a frontend framework**. It's a learning project: the goal is to use only native browser APIs + TypeScript + Tailwind. When suggesting changes, respect this constraint, and when a change uses a browser feature, say why it fits.

- **No React/Vue/Svelte/etc.** Use vanilla DOM APIs, `<dialog>`, `<details>`, Custom Events through `EventEmitter`.
- **No runtime dependencies** beyond Tailwind and chart.js. Do not introduce state management libs, routers, utility libs, etc.
- **No SPA router**. Navigation is plain full-page loads between `index.html` files under `/`, `/exercises/`, `/programs/`, `/workouts/`, `/gymtime/`, `/stats/`, `/settings/`. Each page has its own entry in `vite.config.ts` `rolldownOptions.input`.
- **Mobile first and accessible.** Use semantic HTML, ARIA only where no element fits, and native input types (`date`, `number`, `time`). `src/style.css` keeps touch targets at least 44×44px and stops animations under `prefers-reduced-motion`, and an animation driven from script checks the preference too, as `animateDetails.ts` does.

Data lives in IndexedDB. Once the user creates a passkey (or types a token, for dev, tests and MCP), it syncs with the Cloudflare Worker in `worker/`, which stores rows in D1. README.md is the reference for product behaviour: features, data model, sync design, worker API and IndexedDB schema.

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

- `vp check` runs the format check and the linter. The linter reads types for rules such as `typescript/no-floating-promises` but reports no type errors, so it is not a typecheck. The root `typecheck` script covers `src/`, `tests/` and the root config files, and the worker's covers `worker/src`, `worker/test` and `worker/vitest.config.mts`. The build typechecks `src/` only. Run both typecheck scripts before committing, as CI does.
- `vp test` is Vite+'s built-in Vitest, so the package.json `test` script (Playwright) runs as `vp run test`. Arguments after it go to Playwright.
- Unit tests import from `vite-plus/test`. Worker tests import from `vitest` and `cloudflare:test`, because the worker has its own Vitest 3.2 with `@cloudflare/vitest-pool-workers`.
- The pre-commit hook runs `vp staged`, which runs `vp check --fix` on the staged files.
- Before changing the worker, D1 or `wrangler.jsonc`, read the current Cloudflare docs (`worker/AGENTS.md`).
- Without `VITE_API_BASE`, the app syncs with the production worker at `https://api.jimbro.nop33.com`. For a manual test with cloud credentials, run the worker locally and point `VITE_API_BASE` at it (README.md, "Run the worker locally").

## Architecture

### Layered structure under `src/`

```
db/       IndexedDB access, and the stores pages read, write and subscribe to
sync/     Cloud sync: first-sync restore, outbox push, page notices
pages/    UI layer; one folder per route
features/ Cross-cutting UI (toasts, confetti, hapticFeedback)
```

Pages read and write through the stores in `db/`, which own all IndexedDB access. `db/` and `sync/` never open a dialog: they throw, and the page decides what to tell the user. Markup that several pages share lives once in `partials/`, and a page names it with a line holding only `<!-- partial:name -->`. The `partials()` plugin in `partials/plugin.ts` fills those lines in before Vite reads the page, in dev and in the build, so the browser still gets plain static HTML. `head.html` carries the meta tags, icons, manifest, the `src/style.css` stylesheet, the speculation rules, `src/navigation.ts` and the haptic feedback script. `bottom-nav.html` is the nav, and the plugin marks the page's own link with `aria-current="page"`, so the nav is there in the first frame. `back-button.html` and `close-dialog-button.html` are the header's back button and the dialogs' close button. The speculation rules have Chromium prerender the other nav pages, and `navigation.ts` reloads a prerendered page on the tap when the database changed since it rendered. It also wires the back button and triggers syncs.

### Persistence layer (`src/db/`)

- `storage.ts` holds the `storage` singleton: the single shared `IDBDatabase`, the generic reads, and `writeRows`, the one write path for local edits. In one transaction it writes the rows, the `setGroups` cache for sets, and an outbox entry per row through `queueRows` from `src/sync/queue.ts`. Then it announces `rows-written`. It is the only transaction that queues rows, so a row written any other way never reaches the server.
- `types.ts` declares each data shape once: the row types (`ExerciseRow`, `ProgramRow`, `SessionHeader`, `SetRow`), `SESSION_STATUSES`, `WorkoutSession` (a header joined with its live sets) and the export files. Derive a variant with `Omit` or `Pick` instead of copying its fields.
- `catalogStore.ts` is the abstract `CatalogStore`, which `exercisesStore` and `programsStore` in `stores/` extend with their upgrade, sort and `seed()`. Pages call `load()` to read the live rows into `all`, `subscribe(cb)` to re-render, `find(id)` to look one up in memory, and `create`, `update` and `remove` to write. A write shows in `all` first, then goes through `writeRows`. A failed create takes the row out again, and a failed update reloads. `getById` reads one row from IndexedDB, deleted or not, for pages that never called `load()`.
- `workoutSessionsStore` builds a `WorkoutSession` from a session header and its set rows, whose IDs are `sessionId:exerciseId:position`. Each write (`create`, `update`, `addSet`, `addExercise`, …) takes the session it changes and resolves to the stored next one. It never changes the session passed in, and it recomputes `completed` or `incomplete` in the same write, so no caller sets `status`. `create`, `addExercise` and `swapExercise` set each new exercise's target themselves, through `startingTargetSets` and last time at the session's gym, so no caller sets a target either. `progressOf` gives an exercise's sets logged, target and done, and the status and `nextUnfinished` go by it.
- `migrations.ts` holds `DB_VERSION` (9), the version 9 stores for fresh installs, and `upgradeDatabase`, which rebuilds any older database empty so the next sync refills it. A new version becomes an `if (oldVersion < N)` step after the existing one. The `9` in that step stays a literal, so raising `DB_VERSION` never wipes a version 9 database.
- `exerciseLogging.ts` is the registry of exercise kinds, log presets and set slots. `schemaUpgrade.ts` upgrades records from older exports.
- `export.ts` writes JSON export version 4. `import.ts` reads versions 1 to 4, adds only rows whose ID isn't stored yet, and writes through `writeRows`.
- `cloudBackup.ts` keeps the credentials in localStorage, with `method` saying whether a passkey or a typed token set them up (credentials without it are a token), and sends requests with the bearer token to `VITE_API_BASE`. `markSignedOut` and `wasSignedOut` remember a sign-out, so Settings offers signing in first.
- `reactiveStore.ts` is a small generic `ReactiveStore<T>` (get/set/update/subscribe) used by the stores.

**Dates are stored as strings**, not `Date` objects. Timestamps such as `updatedAt` are full ISO strings. A session's `date` is a calendar day, `YYYY-MM-DD`, in the user's time zone: `getSimpleDate` in `src/dateUtils.ts` makes one and `parseSimpleDate` reads one, since `toISOString()` and `new Date('2026-03-15')` both work in UTC and land on the wrong day away from it. Deletes are soft: all four row types carry `isDeleted`, and a deletion syncs like any other change. The stores' lists leave deleted rows out, while import and export read every row through `storage.getAll`.

Weeks come from `src/weeks.ts`, which the home page and the workouts calendar share. `weekOf(date)` gives a day's Monday, which keys its week, and its ISO 8601 number and year. `trainingWeeks(sessions, programs, settings, today)` lists the weeks from the first session to today with their sessions, and gives the weekly goal and each program's latest workout this week and last completed date.

### Sync (`src/sync/`)

- `rows.ts` holds `canonical`, `rowsEqual` and the conversions between rows, sessions and export files. The worker imports it and `db/types.ts`, so both stay free of browser APIs.
- `src/sync` owns every read and write of the `outbox` and `meta` stores. `queue.ts` defines an outbox entry and the `meta` records, and queues rows inside the writer's transaction. `pull.ts` commits what the first sync pulls.
- Each user runs the app on one device, in one tab (the installed PWA), and only that device writes to the server. So the server is a backup: the app pushes its changes and pulls only to restore. Two devices on one account are not supported.
- `syncEngine.ts` holds `createSync({ storage, server, lock, page })`, whose `sync()` runs the whole sync. While `meta.cursor` and `meta.bootstrapped` are both 0 it runs a first sync, which restores: pull everything, plan each row with `bootstrap.ts`, commit with `commitFirstSync`, push. After that a sync only pushes the outbox and pulls nothing. It reaches the server only through the `SyncServer` port in `server.ts` (`reachable()`, `push(rows)`, and `pull(cursor)` for the first sync), and the page only through `SyncPage`: `announce`, the sync time and whether the page is leaving. `syncClient.ts` composes the app's `sync()` from `httpServer` and the `jimbro:sync-push` lock, and the unit tests compose theirs from the in-memory adapter in `tests/memoryServer.ts`. No other module in `src/sync` touches `window` when it loads, so the unit tests can stub it first.
- `outbox.ts` owns the push. `outbox.drain(push)` takes chunks of 500 rows, sends each through `push`, which resolves to the server revision, and acks it. Take, push and ack of a chunk run under the `jimbro:sync-push` Web Lock. Take stamps each entry with the seq and body it sends, and ack drops only entries whose seq is unchanged, so an edit made during a push stays queued. On a database that has never synced, each ack also moves `cursor` or sets `bootstrapped` in the same transaction. The sync engine passes its server's `push`. Unit tests pass the in-memory server and a lock through `createOutbox`.
- `passkeys.ts` holds `createPasskeyAccount()`, `signInWithPasskey({ confirmReplace })`, `addPasskey()`, `backUpBeforeSignOut()` and `signOut()`, on the browser's own `navigator.credentials`, and `passkeysSupported()`, which pages check before they show a passkey button (it also needs `getPublicKey`, `getPublicKeyAlgorithm` and `getAuthenticatorData`). A page calls `preparePasskey(ceremony)` when it shows a passkey button, which fetches the options and refreshes them before the 5-minute challenge expires, so the tap opens the passkey sheet at once, as Safari needs. Sign-up and sign-in call `restartFirstSync` from `queue.ts` and then save the credentials as `passkey`, both under the push lock: `restartFirstSync` zeroes `cursor` and `bootstrapped` and drops the outbox's inflight stamps, so the next sync is a first sync with the new account and pushes it every local row. That first sync keeps the account's copy of shared rows, so when the account holds a different copy of a row on the phone (`replacesLocalRows` in `bootstrap.ts`, over a pull with the new token), `signInWithPasskey` calls the page's `confirmReplace` after the passkey sheet, and sign-out runs `backUpBeforeSignOut` and warns about what is still pending. A passkey always makes a new account: a device that synced with a token leaves that account behind. Pages word their prompts through `src/pages/passkeyPrompts.ts`. `base64url.ts` is the encoding the app and the worker share, free of browser APIs like `rows.ts`.
- `server.ts` throws a `SyncRequestError` with the worker's error code, and `SyncPage.failed` hears it: `syncClient.ts` records `row_limit` as the sync problem in `status.ts` until a sync succeeds, which Settings' status and a once-per-page toast from `navigation.ts` show.
- `navigation.ts` calls `sync()` on page load, on `online`, when the page becomes visible, and 2 s after the page's last `rows-written` notice. Settings has "Sync now". `sync()` does nothing without credentials or offline. A call during a running sync waits for it and queues one more run.
- Pages hear notices through `onPageNotice((notice) => …)` from `pageChannel.ts`. `announce(notice)` sends one to the page as a `jimbro:<notice>` window event, which the specs listen for. `writeRows` announces `rows-written`, and `sync()` announces `sync-settled` each time it ends. Notices never leave the page: there is no BroadcastChannel, so another tab's changes show only after a reload.
- A page that Back or Forward restored from the back/forward cache, or that Chromium prerendered, missed what the pages shown meanwhile wrote, so `navigation.ts` reloads it when `isOutOfDate()` from `freshness.ts` says the database's `seq` or `cursor` moved since the page rendered.

### Worker (`worker/`)

- `src/index.ts` routes `GET /api/ping`, `POST /api/push`, `GET /api/pull?cursor=&limit=`, `GET /api/export`, `POST /api/passkeys/options`, `POST /api/passkeys/verify`, `POST /api/signout` and `POST /mcp`, which need a bearer token, and the public passkey routes `POST /auth/register/options|verify` and `POST /auth/signin/options|verify`, which the `AUTH_LIMITER` rate limiting binding caps per client address. `/api/push` also goes through the per-user `PUSH_LIMITER`, and `upsertRows` stores nothing past `ROW_CAP` rows per user (413 `row_limit`), checked in the push's one batch. `resolveUserId` in `src/auth.ts` maps a bearer token to a user through `AUTH_TOKENS`, a JSON object of token to user ID, and then through the SHA-256 hashes in D1's `auth_tokens`. CORS allows the production origin, `http://localhost:5173`, and `DEV_ORIGIN`, which only local runs set (`src/origins.ts`).
- `src/passkeys.ts` runs the passkey routes and `src/webauthn.ts` checks the WebAuthn data on WebCrypto alone: the RP ID is the hostname of the allowed request origin, stored per passkey and required again at sign-in, challenges are single use and expire after 5 minutes, cross-origin ceremonies are refused, user verification is required, and signatures are ES256 or RS256. A duplicate credential answers 409, and an unexpected error 500 with CORS headers. Registrations use attestation `none` and the browser's `getPublicKey()`, so the worker parses no CBOR.
- `src/rows.ts` validates pushed rows and upserts them. A changed row gets the user's next `rev` and an unchanged one keeps its own. Pulls page by `rev`. The validation reads the kinds, presets, set slots and muscle groups from `src/db/exerciseLogging.ts` and `src/db/muscleGroups.ts`, and the session statuses from `src/db/types.ts`, so it accepts whatever the app can write. The worker bundles those lists when it deploys, so deploy it before an app version that adds a value. Otherwise a push that carries the new value fails with `invalid_row` and the outbox stops draining.
- `src/mcp.ts` answers four read-only tools over JSON-RPC.
- `migrations/` is the D1 schema: one table per row type (`0001`), and the accounts, passkeys, hashed tokens and challenges (`0002`). Apply a new migration remotely (`vp exec wrangler d1 migrations apply jimbro --remote`) and deploy the worker before the app that needs it.

### Event emitter (`src/eventEmitter.ts`)

Generic `EventEmitter<EventMap>` extending `EventTarget`, used for typed custom events, as the programs page's exercise multiselect and sortable list do. Between modules, use it, a callback or a store's `subscribe`, not an ad-hoc DOM event.

### Pages (`src/pages/<route>/`)

Each route has its own entry module (e.g. `src/pages/gymtime/index.ts`) bootstrapped from its `index.html`, which holds the page's own markup and its partials (see Architecture). Pages are typically composed of:

- A top-level page class/module (e.g. `GymtimePage.ts`) that owns lifecycle + rendering.
- Per-component classes for cards, dialogs, forms (e.g. `ExerciseCard.ts`, `BreakTimerDialog.ts`).
- Procedural entry in `index.ts` that calls the stores' `load()` and mounts the DOM.

The gymtime page is the most complex. `openSession.ts` holds the workout it shows, and every change to it reaches the screen one way: `show` (the loaded workout) and `apply` store the session, then wait for each view that `subscribe` added to show it. `openSession.apply((session) => workoutSessionsStore.addSet(session, …))` runs a store write on it and resolves once the screen shows the result and its effects have run, with no optimistic update and no rollback. With no workout open, `apply` first starts one through the `startWith` starter, `WorkoutSessionForm.start` with the details' day, gym and notes, so the first change on the page starts the workout and opening a program saves nothing. What a change means comes from `outcomeOf(before, after, loggedFor, breakSeconds)` in `outcome.ts`, a pure function the unit tests cover: "Workout done!" on each change from incomplete to completed, and for a set logged from a card, which passes `{ loggedFor: exerciseId }` to `apply`, "Exercise done!" or a break. `apply` runs the outcome's effects: confetti, vibration, the export, the passkey offer (`PasskeyOfferCard`, an inline card, never a dialog, shown when `passkeyOfferDue` in `passkeyOffer.ts` says so: passkeys supported, no passkey backup, no "Not now" in the last 14 days), and starting or closing the break timer, whose `start` replaces any break still running. Nothing else changes the open workout while the page shows it, since a sync after the first only pushes and the app runs in one tab. While a change is on its way, `#exercises-list` carries `aria-busy`. `ExerciseCardList` is the view: it keeps one `ExerciseCard` per exercise and calls `show(snapshot, session, plan)` on each, which changes only what differs, so the scroll position, the open card, its menu and a value typed into the next set's form survive any change. Card buttons and dialogs only call `openSession.apply`, and decide no effects themselves. Each card reads its progress, its form's prefill and "Previous sets" from one `planExercise` call in `exercisePlan.ts`, which reads last time through `workoutSessionsStore.lastTimeOf` and never returns the open session. The list reads last time once per exercise, workout, day and gym through `keptLastTimes`, and keeps it for the page's life, since the page's writes change only the open workout. Before a workout starts, it reads for the date and gym in the form, so the cards show the targets the start will store. The session stores each exercise's target (the store's starting target when it starts or the exercise joins, `addSetSlot` for Add set, `removeSetSlot` for a removed set to do), and the card reads progress through `progressOf`, so its stored status and the cards agree. The page also runs the break timer and wake lock, and downloads a JSON export on workout completion when cloud sync is off.

## TypeScript conventions

- Strict mode, ES2022 target.
- **Derive types from `as const` arrays** instead of enums:
  ```ts
  export const MUSCLE_GROUPS = ['quads', 'calves', ...] as const
  export type MuscleGroup = (typeof MUSCLE_GROUPS)[number]
  ```
- Prefer `unknown` over `any`.
- Data shapes (`ExerciseRow`, `ProgramRow`, `SessionHeader`, `SetRow`, `WorkoutSession`, etc.) live in `src/db/types.ts`.

## Formatting

Configured in `vite.config.ts` under `fmt`: single quotes, no semicolons, no trailing commas, printWidth 120. Run `vp fmt` to apply. It formats Markdown too.

## Rules and their checks

Each rule below has a check that fails when the rule is broken, and CI runs all of them on every pull request. Change the code until the check passes. Don't loosen the check.

| Rule                                                                                                     | Enforced by                                                                                         |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Write rows only through `storage.writeRows`, which queues each one for the push in the same transaction  | `tests/architecture.unit.test.ts` fails on any other readwrite transaction outside `src/sync`       |
| Only `src/sync` reads or writes the `outbox` and `meta` stores                                           | `tests/architecture.unit.test.ts`                                                                   |
| Notices go through `announce` and `onPageNotice`, no BroadcastChannel; other events via `EventEmitter`   | `tests/architecture.unit.test.ts`                                                                   |
| Import each symbol from the module that declares it, never through a re-export                           | `tests/architecture.unit.test.ts`                                                                   |
| No import cycles                                                                                         | `import/no-cycle` in the `vite.config.ts` lint config, run by `vp check`                            |
| Never leave a promise as a bare statement: await it, or mark it `void` when nothing should wait for it   | `typescript/no-floating-promises` in the `vite.config.ts` lint config, run with types by `vp check` |
| `src/db` and `src/sync` throw instead of calling `alert`, `confirm` or `prompt`                          | `no-alert` in the `vite.config.ts` lint config, run by `vp check`                                   |
| `src/db/types.ts` and `src/sync/rows.ts` use no browser API, since the worker imports them               | The worker typecheck, which has no DOM types                                                        |
| Build HTML from fixed markup only, and put values in with `textContent` or `new Option()`                | `tests/architecture.unit.test.ts` fails on HTML built from a value                                  |
| The worker accepts every kind, preset, set slot, muscle group and status the app can write               | The worker's validation imports those lists from the app, and `worker/test/rows.spec.ts` walks them |
| A session write recomputes `status`, leaves the session passed in unchanged and keeps each exercise once | `tests/workoutSessionsStore.unit.test.ts`                                                           |
| Rows store dates as strings, never `Date` objects                                                        | TypeScript: the row types declare them as `string`                                                  |
| Every page fills its head and bottom nav from `partials/`, and marks only its own nav link as current    | `tests/pageShell.unit.test.ts`                                                                      |
| Calendar dates never come from `toISOString()`                                                           | `tests/architecture.unit.test.ts`                                                                   |
| Specs wait for what the app shows or stores, never for a fixed time, and never force a click             | `tests/architecture.unit.test.ts`; on CI, `failOnFlakyTests` fails a run that needed a retry        |
| Code is formatted                                                                                        | `vp check`, which `vp staged` runs on each commit                                                   |

Everything else in this file is a convention that only review catches. When a review corrects a mistake that no check covers, add a check that fails on that mistake and a row here in the same change. Drop a row once its mistake can no longer be written.

## Testing notes

- Playwright runs every `tests/*.spec.ts` on chromium, webkit and Mobile Safari (iPhone 12) in parallel.
- Playwright starts the dev server on port 5173 with `VITE_API_BASE` pointing at the test worker. It also builds the app and serves it with `vp preview` on port 4173 for `offline.spec.ts`, since only the build registers the service worker. Outside CI it reuses a server already listening on 5173, so stop your own `vp dev` before a run.
- Global setup (`tests/localWorker.ts`) starts one fresh `wrangler dev --local` per run on `WORKER_PORT` (default 8790), with its own D1 state and tokens, and stops it at the end. It needs `cd worker && vp install`. A busy port fails the tests that need the worker with a clear message, instead of reusing whatever listens there. `claimUser()` gives each test its own user.
- `tests/tsconfig.json` maps `/src/*` to `../src/*`, so `await import('/src/db/storage.ts')` inside `page.evaluate` is typed. Specs use such imports to drive app modules in the page.
- Each test runs in a browser context of its own, so its database starts empty and needs no reset. `seedDatabase` in `tests/seed.ts` fills it with the sample exercises and programs.
- `passkeys.spec.ts` signs up, signs in and adds passkeys against the real local worker with Chromium's virtual authenticator over CDP, so those tests skip WebKit, which has none.
- `sync.spec.ts` syncs with the real local worker. It keeps to what needs a browser or a worker: the sync rules themselves have unit tests in `syncEngine.unit.test.ts` and `outbox.unit.test.ts`. `dbSchema.spec.ts` checks the version 9 schema and the rebuild of older databases, `jsonImport.spec.ts` the Settings import, `rowWrites.spec.ts` `writeRows`, and `manifest.spec.ts` the manifest's icons and screenshots. Most other specs cover one page each.
- Unit tests live alongside e2e specs in `tests/` but use the `.unit.test.ts` suffix so they're routed to Vitest via the `vite.config.ts` `test.include`. `outbox.unit.test.ts` runs the push races on `fake-indexeddb`, with a fresh `IDBFactory` and `Storage` per test, and `syncEngine.unit.test.ts` runs the first sync, the push-only syncs after it and the reruns the same way through `createSync`. Both use the in-memory server, lock and page in `tests/memoryServer.ts`. `workoutSessionsStore.unit.test.ts` runs the session writes on one shared `fake-indexeddb`. `architecture.unit.test.ts` reads the source files instead of running them.
- Specs prove behaviour, and the `verify-jimbro` skill shows what the user sees. It lives in `.cursor/skills/verify-jimbro/`, which `.claude/skills/` links to. `control-jimbro launch` starts its own dev server on port 5174, and `control-jimbro tour` walks every screen and dialog in its feature map on the iPhone 13 and Pixel 8 Pro viewports, writing a side-by-side contact sheet. A behaviour change ships with a spec. A UI change also ships with the affected tour screenshots on both phones in the pull request. When a screen or dialog is added or changed, update its stop in the tour and its feature file in the same change.
- Worker tests (`worker/test/*.spec.ts`) run in workerd, with the D1 migrations applied by `test/apply-migrations.ts`. The `*.perf.spec.ts` files check query counts and time budgets.
