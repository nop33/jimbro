# Jimbro - Gym Workout Tracking App

<img src="./public/icons/logo-192.png" width="100" alt="Jimbro logo" />

Personal workout tracking PWA for following your own programs, logging every set, and visualizing progressive overload over time.

After more than a decade in web dev, I am suffering from framework fatigue. This project is an experiment and challenge for myself to build an app using only what the browser, HTML, and CSS can provide me (with the exception of TypeScript. I still want TypeScript. Oh, and Tailwind because I haven't tried that out yet).

- No routing, simple index.html files
- No frameworks. Just JavaScript (well, TypeScript).
- No dependencies (except Tailwind, and Chart.js for the progress chart)

The data lives in the browser's IndexedDB. An optional cloud backup syncs it to a small Cloudflare Worker and brings it back on an empty install.

## Tech stack

- TypeScript in strict mode, targeting ES2022
- Tailwind CSS v4 through `@tailwindcss/vite`
- Vite+ (`vp`), one CLI over Vite, Rolldown, Vitest, Oxlint and Oxfmt
- IndexedDB for storage on the device
- Chart.js for the exercise history chart
- A Cloudflare Worker with a D1 database for sync, in `worker/`
- Playwright for end-to-end tests
- No frontend framework. Pages use DOM APIs, custom events and static singleton classes.

## Pages

| Route         | Purpose                                                          |
| ------------- | ---------------------------------------------------------------- |
| `/`           | Home page with an install button and a "Start workout" link      |
| `/workouts/`  | Weekly workout calendar: history, new workouts, workout mode     |
| `/gymtime/`   | The active workout: log sets, break timer, completion            |
| `/exercises/` | Exercise library: create, edit, delete                           |
| `/programs/`  | Programs built from exercises                                    |
| `/stats/`     | Totals across completed workouts                                 |
| `/settings/`  | Break time, cloud backup, JSON export and import, database reset |

## Data model

The app stores four kinds of rows, and the worker syncs the same rows.

| Row            | Fields                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| Exercise       | `id`, `name`, `kind`, `preset`, `muscle`, `targetSets`, `defaults`, `isDeleted`, `updatedAt`             |
| Program        | `id`, `name`, `exercises` as an ordered list of exercise IDs, `isDeleted`, `updatedAt`                   |
| Session header | `id` (a UUID), `date`, `programId`, `location`, `status`, `notes`, `exercises`, `isDeleted`, `updatedAt` |
| Set            | `id`, `sessionId`, `exerciseId`, `position`, `set`, `isDeleted`, `updatedAt`                             |

- A session header's `exercises` holds a snapshot of each exercise in the workout: name, kind, preset, muscle, target sets and defaults. Renaming or deleting an exercise later leaves old workouts alone.
- A set row's `id` is `sessionId:exerciseId:position`. The app builds a `WorkoutSession` from a header and its live set rows.
- `set` is a union discriminated by `preset`: `lifting` (reps, weight), `rehabReps` (reps, optional weight), `rehabHold` (durationSec, optional weight), `cardioTreadmill` (durationSec, speed, incline).
- Exercise kinds are `lifting`, `rehab` and `cardio`. Each kind owns one or more log presets, and rehab is the only kind that offers a choice. `src/db/exerciseLogging.ts` is the registry that maps a preset to its slots, labels, break-timer behaviour and prescription text.
- Muscle groups are slugs (`quads`, `chest`, …) with display labels (`Quads`, `Chest`, …). Cardio exercises have no muscle group.
- A session is `completed` once every exercise has its target number of sets, and `incomplete` until then. `pending` and `skipped` exist only in the workouts calendar, for workouts nobody started.
- Deletes are soft. A deleted row stays with `isDeleted: true`, so the deletion syncs like any other change.
- Device settings live in localStorage and are neither synced nor exported: workout mode and weekly goal, break time, cloud credentials and the last sync time.

## Features

### Home (`/`)

- "Hey, gymbro." header with a Settings link, and a "Start workout" button that opens `/workouts/`.
- "Install app" opens the browser's install prompt when the browser has offered one, and otherwise shows the iOS "Add to Home Screen" instructions. The page removes the button after an install, and CSS hides it when the app runs standalone.

### Workouts (`/workouts/`)

- A weekly calendar, newest week first ("Week N of YYYY"), with one card per workout. A card opens its workout in gymtime.
- The badge next to the intro opens the workout mode dialog.
  - Rotation mode expects every program once a week. A program with no workout yet shows as pending this week and as skipped in past weeks. Tapping a pending card starts that program.
  - Freestyle mode sets a weekly goal of 1 to 7 workouts and shows only the current week and weeks with workouts.
- Completed cards are green with a check mark, incomplete ones amber, pending ones gray and skipped ones red. Incomplete and pending cards have a dashed border.
- "New" lists the programs with this week's status and the date each was last completed. Picking one starts a workout.
- The intro line counts the workouts left this week, or tells a new user what to do next, matching the button when there is one.
- With no exercise or program rows stored, deleted ones included, the page offers "Seed Database", which adds 21 exercises and a push, pull and legs split. If cloud credentials are saved and no sync has finished yet, it offers "Restore from cloud" instead, and a restore that finds the cloud empty leads back to the seed.

### Gymtime (`/gymtime/`)

The page you keep open during a workout.

- `?programId=<id>` starts a workout for a program and `?id=<session-id>` opens a saved one. An unknown program or session shows an error with a link back to the workouts page.
- The workout details form has date, location and notes. The date defaults to today and can't be in the future. A new workout takes the location of the last saved one, and the location button fills in the place name from geolocation through OpenStreetMap's Nominatim. The first save creates the workout and puts its `?id=` in the URL.
- There is one card per exercise, with its muscle group and a badge for rehab exercises. Opening a card closes the others.
- The "Finished set" form shows the inputs of the exercise's preset. Its values come from the previous set in this workout, else from the last workout that completed the exercise, using that workout's heaviest weight for lifting, else from the exercise's defaults. Zero reps or zero weight asks for confirmation.
- A card has as many set slots as the exercise's target, or more if the last workout with the exercise had more sets. "Add set" adds another slot. Tapping a logged set opens a dialog to edit it.
- An open card that isn't finished has buttons to move the exercise up or down, swap it for another exercise, or delete it from the workout.
- "Previous sets" lists the sets of the last workout with the exercise, preferring one at the same location. "View History" charts average weight, estimated 1RM and total volume per workout, with one point shape per location. Cardio exercises have no chart.
- "Add exercise" adds any exercise from the library. When the workout's exercise list no longer matches its program, "Save to program" copies the list to the program.
- For lifting and treadmill exercises, a set that doesn't finish the exercise starts the break timer. It counts down the break time from Settings, 2:30 by default, and shows the sets done and the next unfinished exercise. It can be minimized or skipped. At 0:00 it plays a ding and closes itself.
- Finishing an exercise throws confetti with "Exercise done!" and a short sound, vibrates where the browser supports it, and turns the card green. Finishing the last one marks the workout completed with "Workout done!". Without cloud backup, it also downloads a JSON export.
- "Delete" in the header deletes the workout after a confirmation.
- A re-render keeps the scroll position and the open card, and changes to this workout from a sync or another tab show up without a reload.

### Exercises (`/exercises/`)

- Each card shows the name, the muscle group and the prescription, such as "3 sets × 10 reps" or "3 sets × 30s hold". Cardio cards show the kind in place of a muscle group, and rehab cards get a badge.
- A muscle group filter.
- "New", or tapping a card, opens the exercise dialog. It has the name, kind, log preset, muscle group, target sets, and a default reps count or hold time when the preset has one. Only rehab offers a preset choice, reps or hold, and cardio has no muscle group. The same dialog deletes an exercise.

### Programs (`/programs/`)

- Program cards with a collapsible list of their exercises and an edit button.
- The program dialog has a name, a multi-select of exercises grouped by muscle group, with cardio in a group of its own, and a drag-and-drop list to order the chosen exercises by mouse or touch. The same dialog deletes a program.

### Stats (`/stats/`)

Totals over completed workouts: the first workout's date and how long ago it was, days active, workouts with a count of incomplete ones, exercises, sets, reps, volume as weight × reps, and average workouts per week.

### Settings (`/settings/`)

- Workout settings hold the break timer's length.
- Cloud backup takes a user ID and a token, with "Save credentials" and "Sync now" buttons. Its status line shows how many changes wait to sync and when the last sync ran.
- Manage local data:
  - "Export to JSON" downloads `jimbro-export-YYYY-MM-DD.json`.
  - "Import from JSON file" merges an export into the database. See [Import and export](#import-and-export).
  - "Reset Database" deletes the IndexedDB database after a confirmation. Saved credentials stay, so the next sync restores the data.

## Cloud sync

Sync is optional. Without credentials the app sends nothing to the worker.

- Every write lands in IndexedDB first, in one transaction with an outbox entry for each changed row. Nothing waits for the network.
- A sync runs on every page load, when the browser comes back online, when the tab becomes visible, 2 seconds after the last write, and on "Sync now". Offline, it does nothing.
- A sync pushes the outbox to the worker in chunks of 500 rows. Then it pulls pages of up to 1000 rows above the device's cursor, which is the highest server revision the device has seen. A pulled row never replaces a row that still has changes waiting in the outbox.
- The worker gives each changed row the next revision number of that user, so a pull returns only what changed.
- A database that has never synced, after a fresh install or a reset, runs a first sync instead. It pulls everything, pushes the rows only it has, and takes the server's copy of any row that differs.
- Tabs share one database. They tell each other about writes and finished syncs over a BroadcastChannel, and a Web Lock lets one tab push at a time.

## Worker API

`worker/` is a Cloudflare Worker with a D1 database, which has one table per row type keyed by user and row ID (`worker/migrations/0001_rows.sql`).

Every route needs an `Authorization: Bearer <token>` header. The worker's `AUTH_TOKENS` variable is a JSON object that maps each token to a user ID, and every query is scoped to that user.

| Route                                  | What it does                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ping`                        | Returns `{ ok: true, userId }`                                                                                          |
| `POST /api/push`                       | Takes `{ rows: [{ table, row }] }` with up to 1000 rows, validates and stores them, and returns `{ revision }`          |
| `GET /api/pull?cursor=<rev>&limit=<n>` | Returns `{ rows, cursor, more }` with the rows above `cursor`, up to 1000 per page                                      |
| `GET /api/export`                      | Downloads every row as a version 4 export file                                                                          |
| `POST /mcp`                            | A read-only MCP server over JSON-RPC, with the tools `recent_sessions`, `get_session`, `exercise_history` and `catalog` |

CORS allows `https://jimbro.nop33.com` and `http://localhost:5173`, plus `DEV_ORIGIN` when a local run sets it.

## PWA features

| Feature            | Details                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web manifest       | `app.webmanifest` with name, icons (192, 384, 512, 1024), standalone display and WebP screenshots                                                                   |
| Install prompt     | Keeps the `beforeinstallprompt` event so the install button can open the prompt, and removes the button after `appinstalled`                                        |
| iOS install        | Without that event, the install button shows an alert with "Add to Home Screen" instructions                                                                        |
| Screen wake lock   | Requests a screen wake lock when gymtime opens, and again when the tab becomes visible if the first request succeeded                                               |
| Geolocation        | Fills in the workout location on request with the place name from Nominatim reverse geocoding                                                                       |
| Haptic feedback    | A short vibration (`navigator.vibrate(2)`) on buttons, links, `<summary>` and `.light-haptic` elements, in browsers that have the Vibration API, which Safari lacks |
| Persistent storage | Asks for persistent storage with `navigator.storage.persist()`. The browser decides, and the app only logs the answer                                               |
| Service worker     | Not yet implemented                                                                                                                                                 |

## UI features

- Toasts for success, error, warning and info. They last 3 or 5 seconds, queue up, and close on a tap.
- Confetti drawn with CSS animations, with a text overlay and a random sound effect made with the Web Audio API.
- A dark theme with a custom palette (`jim-dark`, `jim-primary`, `jim-accent`, …) in `src/style.css`.
- Mobile first, with touch targets of at least 44×44 px.
- Native `<dialog>` for modals and `<details>` for collapsible sections, which animate unless `prefers-reduced-motion` is set.

## Navigation

- Every page has a bottom bar with Home, Workouts, Exercises, Programs and Stats, and highlights the current page.
- Workouts, gymtime, exercises, programs and settings have a back button that calls `window.history.back()`.
- There is no SPA router. Every link is a full page load.

## Import and export

The export format, version 4:

```json
{
  "version": 4,
  "exportDate": "ISO string",
  "stores": {
    "exercises": [...],
    "programs": [...],
    "workoutSessions": [...]
  }
}
```

- Each exported session carries its exercises with their sets nested inside. Deleted sessions are left out, while deleted exercises and programs stay in with `isDeleted: true`.
- The import reads versions 1 to 4 and rejects newer files. `src/db/schemaUpgrade.ts` upgrades older records on the way in.
- The import only adds rows. It skips any row whose ID is already stored. Version 1 sessions have no ID, so it skips one when a session with the same date and program exists.
- Imported rows go through the outbox like any other write, so they sync.
- The worker's `GET /api/export` returns the same format, built from D1.

## IndexedDB schema (v9)

The database is `gymbro-database`, version 9.

| Store             | Key path    | Indexes                   | Holds                                                               |
| ----------------- | ----------- | ------------------------- | ------------------------------------------------------------------- |
| `exercises`       | `id`        |                           | Exercise rows                                                       |
| `programs`        | `id`        |                           | Program rows                                                        |
| `workoutSessions` | `id`        | `date`, `programId`       | Session headers                                                     |
| `sets`            | `id`        | `sessionId`, `exerciseId` | Set rows                                                            |
| `setGroups`       | `sessionId` |                           | Each session's sets in one record, for reading all sessions at once |
| `outbox`          | `key`       |                           | One entry per row waiting to be pushed, keyed `table:id`            |
| `meta`            | `name`      |                           | Sync state: `cursor`, `seq` and `bootstrapped`                      |

- `cursor` is the highest server revision this device has pulled.
- `seq` numbers the outbox entries, so a push can tell whether a row changed again while the push was running.
- `bootstrapped` marks a first sync that finished with `cursor` still at 0, because neither side had any rows.

`src/db/migrations.ts` creates these stores on a fresh install. A database from before version 9 is rebuilt empty, and the next sync pulls everything back from the server.

## Architecture

```
src/
  db/                  Persistence (IndexedDB)
    storage.ts         Shared connection, and writeRows, which stores rows and outbox entries together
    baseStore.ts       BaseStore<T> with getAll, getById, create and update
    stores/            Exercises, programs, workout sessions, sets, seed data
    migrations.ts      DB_VERSION and the version 9 stores
    exerciseLogging.ts Exercise kinds, log presets and set slots
    schemaUpgrade.ts   Upgrades records from older exports
    export.ts          JSON export, version 4
    import.ts          JSON import, versions 1 to 4
    cloudBackup.ts     Credentials and authenticated requests to the worker
    reactiveStore.ts   ReactiveStore<T>, the observable value behind the state classes
  sync/                Cloud sync
    syncClient.ts      sync(), which pushes the outbox and pulls by cursor
    bootstrap.ts       The first sync's plan for each row
    rows.ts            Row types and export conversion, shared with the worker
    pageChannel.ts     Notices between tabs over a BroadcastChannel
    status.ts          Last sync time
  state/               ExercisesState, ProgramsState, GymtimeSessionState
  pages/               One folder per route
  features/            Toasts, confetti, haptic feedback
  navigation.ts        Bottom bar, back button and sync triggers
  settings.ts          Device settings in localStorage
  eventEmitter.ts      Typed EventTarget subclass
worker/
  src/                 Routes and auth, row storage, MCP tools
  migrations/          D1 schema
  test/                Worker tests
tests/                 Playwright specs and unit tests
```

## Development

Install [Vite+](https://viteplus.dev), which provides the `vp` command and manages Node and pnpm. Then install both packages:

```sh
vp install
cd worker && vp install
```

| Task                                     | Command                                                |
| ---------------------------------------- | ------------------------------------------------------ |
| Dev server on http://localhost:5173      | `vp dev`                                               |
| Format and lint                          | `vp check`, or `vp check --fix` to fix                 |
| Typecheck                                | `vp run typecheck` and `cd worker && vp run typecheck` |
| Unit tests                               | `vp test run`                                          |
| Worker tests                             | `cd worker && vp run test`                             |
| End-to-end tests                         | `vp run test`                                          |
| Production build in `dist/`              | `vp run build`                                         |
| Serve the build on http://localhost:4173 | `vp preview`                                           |

`vp check` doesn't typecheck, and the build typechecks `src/` only, so run both typecheck commands too. CI runs the checks and all three test suites.

The app syncs with the production worker at `https://api.jimbro.nop33.com` unless `VITE_API_BASE` points it elsewhere.

### Run the worker locally

Run these in `worker/`. Create the local D1 database:

```sh
vp exec wrangler d1 migrations apply jimbro --local
```

Give yourself a token in `worker/.dev.vars`:

```
AUTH_TOKENS='{"dev-token":"dev"}'
```

Start the worker, which listens on http://localhost:8787:

```sh
vp run dev
```

In another terminal at the repo root, start the app against it:

```sh
VITE_API_BASE=http://localhost:8787 vp dev
```

Then save user ID `dev` and token `dev-token` under Cloud Backup in Settings, and tap "Sync now".

If something else already listens on port 8787, start the worker with `vp run dev --port 8791` and put that port in `VITE_API_BASE`.

### Tests

- Unit tests are `tests/*.unit.test.ts`, run by Vitest.
- Worker tests in `worker/test/` run inside the Workers runtime with a local D1 database.
- End-to-end tests are `tests/*.spec.ts`, run by Playwright on Chromium, WebKit and Mobile Safari (iPhone 12). Playwright starts the dev server on port 5173. For each run it also starts a fresh local worker on `WORKER_PORT`, 8790 by default, which `tests/sync.spec.ts` syncs with. If that port is busy, those tests fail with a message instead of using whatever listens there.
- Outside CI, Playwright reuses a dev server already running on port 5173, so stop your own `vp dev` before a run.
- Options after the script name go to Playwright, for example `vp run test tests/gymtime.spec.ts --project=chromium`.
