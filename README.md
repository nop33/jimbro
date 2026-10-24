# Jimbro - Gym Workout Tracking App

<img src="./public/icons/logo-192.png" width="100" alt="Jimbro logo" />

Personal workout tracking PWA for following your own programs, logging every set, and visualizing progressive overload over time.

After more than a decade in web dev, I am suffering from framework fatigue. This project is an experiment and challenge for myself to build an app using only what the browser, HTML, and CSS can provide me (with the exception of TypeScript. I still want TypeScript. Oh, and Tailwind because I haven't tried that out yet).

- No routing, simple index.html files
- No frameworks. Just JavaScript (well, TypeScript).
- No dependencies (except Tailwind, and Chart.js for the progress chart)

The data lives in the browser's IndexedDB. Anyone can use the app without an account. An optional cloud backup, signed up for with a passkey, syncs it to a small Cloudflare Worker and brings it back on a new phone.

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

| Route         | Purpose                                                            |
| ------------- | ------------------------------------------------------------------ |
| `/`           | This week at a glance, highlights, and the next workout to start   |
| `/workouts/`  | Weekly workout calendar: history, new workouts, workout mode       |
| `/gymtime/`   | The active workout: log sets, break timer, completion              |
| `/exercises/` | Exercise library: create, edit, delete                             |
| `/programs/`  | Programs built from exercises                                      |
| `/stats/`     | Totals across completed workouts                                   |
| `/settings/`  | Break time, passkey backup, JSON export and import, database reset |

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
- Device settings live in localStorage and are neither synced nor exported: workout mode and weekly goal, break time, cloud credentials with how they were set up (passkey or token), the last sync time, and when the passkey offer's "Not now" ends.

## Features

### Home (`/`)

- "Hey, gymbro." header with a Settings link.
- "This week" counts the completed workouts against the goal (every program in rotation mode, the weekly goal in freestyle mode), with one bar per workout and a Monday to Sunday strip that marks each day's workout and today.
- Three highlights, once any workout exists:
  - The streak: weeks in a row that met the goal, counting back from last week. This week joins once it meets the goal, so the streak never drops before the week ends.
  - The kilograms lifted this week (reps × weight over every reps set), against last week up to the same weekday.
  - Personal records this week: a lifting exercise whose top set beat its heaviest earlier weight, or matched it with more reps. An exercise's first workout is not a record. With none this week, it shows the date of the latest one.
- "Pick your workout" lists every program, each opening gymtime. A workout started this week and not finished comes first with "Continue". Otherwise, until the week meets its goal, the program done longest ago comes first with "Start", in rotation mode only among the programs not started this week. The programs still open follow, then the ones done this week.
- With no programs, the list gives way to "Let's set up your first workout." and a centred "Get started" button that opens `/workouts/`, which offers the seed or the restore.
- "Install" opens the browser's install prompt when the browser has offered one, and otherwise shows the iOS "Add to Home Screen" instructions. The page removes the row after an install, and CSS hides it when the app runs standalone.
- Like the workouts page, the page loads again when it comes back after the day, the workout mode or the database changed.

### Workouts (`/workouts/`)

- A weekly calendar, newest week first, with one card per workout. A card opens its workout in gymtime. Weeks run Monday to Sunday, as on the home page, and carry their ISO 8601 number ("Week N of YYYY"), so the days around New Year share one week: Monday 29 December 2025 to Sunday 4 January 2026 is week 1 of 2026.
- Once a program exists, a card at the top shows the workout mode and this week's progress toward its goal ("1 of 3 programs done" with the home page's goal bar). Tapping it opens the workout mode dialog.
  - Rotation mode expects every program once a week. A program with no workout yet shows as pending this week and as skipped in past weeks. Tapping a pending card starts that program.
  - Freestyle mode sets a weekly goal of 1 to 7 workouts and shows only the current week and weeks with workouts. This week shows an empty dashed slot with a "+" for each workout still to do toward the goal, which opens the program list.
- Completed cards are green with a check mark, incomplete ones amber, pending ones gray and skipped ones red. Incomplete and pending cards have a dashed border.
- "New" lists the programs with this week's status and when each was last completed, or that it never was. Picking one starts a workout.
- Until a program exists, an intro line tells a new user what to do next, matching the button when there is one.
- With no exercise or program rows stored, deleted ones included, the page offers "Seed Database", which adds 21 exercises and a push, pull and legs split, and "Sign in with passkey" where the browser has passkeys. Signing in restores the account's workouts, so a returning user on a new phone picks up where they left off. If cloud credentials are saved and no sync has finished yet, it offers "Restore from cloud" instead, and a restore that finds the cloud empty leads back to the seed.

### Gymtime (`/gymtime/`)

The page you keep open during a workout.

- `?programId=<id>` opens a program's workout before it starts and `?id=<session-id>` opens a saved one. An unknown program or session shows an error with a link back to the workouts page.
- The workout details sit folded under one line with the day ("Today", "Yesterday" or a date) and the gym. Open, they have date, gym and notes. The date defaults to today and can't be in the future. The gym is stored as the session's `location`. A new workout takes the gym of the last saved one, and the field suggests the gyms already used, the most recent first. Phones show the suggestions above the keyboard, and the ✕ in the field clears it so they all show. Once the workout has started, a change saves when the field is left.
- Opening a program saves nothing. The first change on the page starts the workout, whatever it is: a logged set, Add set, a removed set, moving, swapping or deleting an exercise, or adding one. It creates the workout with the details' date, gym and notes, says "Workout started.", and puts its `?id=` in the URL.
- There is one card per exercise, with its muscle group and a badge for rehab exercises. Opening a card closes the others.
- "Last time" for an exercise is the latest other workout, up to this workout's date, with a set of the exercise, preferring one at the same gym. Before a workout starts, the cards read it for the date and gym in the workout form, as starting the workout will, and show again when either changes.
- The "Finished set" form shows the inputs of the exercise's preset. Its values come from the previous set in this workout, else from last time, using its heaviest weight for lifting, else from the exercise's defaults. When last time's sets had different weights, a "Max" pill sits on the prefilled weight until it is edited or the set is logged, and tapping it says "Heaviest set last time" with the weight. Zero reps or zero weight asks for confirmation.
- Each exercise in a workout stores its own target sets: the exercise's target, or last time's set count at the gym when that is more, fixed when the workout starts or the exercise joins it. A card has that many set slots. "Add set", on the right of the open card's "Exercise sets" row, stores one more. Tapping a set still to do opens a menu to remove one, while the exercise keeps at least one set and the sets logged. Tapping a logged set opens a dialog to edit or delete it. A deleted set leaves its slot to do.
- An open card that isn't finished has buttons to move the exercise up or down, swap it for another exercise, or delete it from the workout.
- "Previous sets" opens on last time's sets, with arrows (and the arrow keys) to step to the older and newer workouts before this one that logged the exercise, at any gym. "View History" charts average weight, estimated 1RM and total volume per workout. The gym with the most of those workouts stays unshaded, and each other gym tints the stretch of the chart behind its workouts, with a key under the chart. The metric names in the header hide and show their lines. Cardio exercises have no chart.
- "Add exercise" adds any exercise from the library. When the workout's exercise list no longer matches its program, "Save to program" copies the list to the program.
- A logged set's row draws its solid green border around itself before anything else happens, unless the phone asks for reduced motion.
- For lifting and treadmill exercises, a set that doesn't finish the exercise starts the break timer. It counts down the break time from Settings, 2:30 by default, and shows the sets done and the next unfinished exercise. It can be minimized or skipped. At 0:00 it plays a ding and closes itself. A set logged during a break starts a fresh one, and finishing the exercise or the workout ends it.
- A workout is completed when every exercise in it has its target sets, so an added set or exercise makes it incomplete again. Finishing an exercise bursts confetti from its card with "Exercise done!" and a short sound, vibrates where the browser supports it, and turns the card green. Any change that takes the workout from incomplete to completed, a set or a deleted exercise, stamps "Workout done!" on the screen instead, with rings and sparks and a longer, happier vibration, again after each Add set or added exercise. Without cloud backup, it also downloads a JSON export, or shows an error toast if that fails. Without a passkey backup (no backup, or a typed token), and where the browser has passkeys, a card under the exercises offers one: "Create passkey" signs up and backs up, "Not now" hides the offer for 14 days, and "Already have a passkey? Sign in" signs in, asks first since the phone has data, and loads the page again once the account's rows are in. The card sits in the page, not in a dialog, so it never blocks the workout.
- "Delete" in the header, shown once the workout has started, deletes it after a confirmation.
- Each change to the workout updates the cards in place, so they keep the scroll position, the open card and a value typed into the next set's form.

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
- Cloud backup's status line shows how many changes wait to sync and when the last sync ran.
  - Without a passkey backup, "Back up your workouts" explains the backup and offers "Create passkey" and "Sign in with passkey", with "Sign in with passkey" first on a phone that signed out. A browser without passkeys says it can't back up.
  - Signing in keeps the account's copy of every row both the phone and the account have, and rows only on the phone stay and back up. When that would replace a row on the phone with a different copy, it asks first. A phone that signed out after backing up signs in again without asking.
  - An account backs up one device at a time. When another device is signed in to the account, signing in asks first, in the same confirm, and then moves the backup here: the other device stops backing up. Declining leaves both devices as they were.
  - A phone whose backup moved to another device finds out on its next push: the page says so in a toast, Settings reads "Moved to another device" with a note above the offer, and "Sign in with passkey" comes first, which moves the backup back. The phone keeps its workouts.
  - Signed in with a passkey, it says so and offers "Sync now", "Add another passkey" (for another password manager) and "Sign out". Sign out pushes what waits first, then asks, and warns when changes could not back up, since signing in again would replace them with the backup's copy. Signing out keeps the workouts on the phone and stops the backup.
  - When the backup holds as many rows as the worker takes, the status reads "Backup full · N pending", and each page says so once when its sync hits the limit.
  - "Use a token", a nested section shown without a passkey backup, takes a user ID and a token from the worker's `AUTH_TOKENS`, for local runs, tests and the MCP server. "Sync now" shows once any credentials are saved.
- Gyms renames a gym on every workout after a confirmation. Giving it another gym's name merges the two, which also fixes workouts saved under a city.
- Manage local data:
  - "Export to JSON" downloads `jimbro-export-YYYY-MM-DD.json`.
  - "Import from JSON file" merges an export into the database. See [Import and export](#import-and-export).
  - "Reset Database" deletes the IndexedDB database after a confirmation. Saved credentials stay, so the next sync restores the data.

## Cloud sync

Sync is optional. Without credentials the app sends nothing to the worker. With them, the worker keeps a backup of the device's data and restores it onto a new install.

- A passkey is the account. "Create passkey" makes a new account on the worker and a passkey for it, which the phone's password manager (iCloud Keychain, Google Password Manager) keeps and brings to a new phone. "Sign in with passkey" there restores the account. There is no email, password or recovery code: losing every passkey loses the backup, though the phone keeps its data.
- The passkey ceremony is the browser's own WebAuthn API (`src/sync/passkeys.ts`), and the worker checks it. The worker hands back a user ID and a bearer token, which the app saves as its credentials, marked as set up by a passkey. A user ID and token typed into Settings are marked as a token, as are credentials saved before passkeys existed.
- Creating a passkey always makes a new account. A device that synced with a token account leaves that account's server data behind.
- Signing up or signing in switches the device to the account: under the push lock it resets the sync state (`restartFirstSync` in `src/sync/queue.ts`) and then saves the credentials, so the next sync is a first sync with the new account. That sync pulls the account's rows and pushes every row only the device has, so a device that synced with another account backs everything up to the new one. Like any first sync it keeps the account's copy of a row both sides have, even one the phone edited: the sample exercises have fixed IDs and every row of a phone without a backup waits in the outbox, so the phone winning would let a freshly seeded phone overwrite the account's exercises. So signing in on a phone with data asks first, and sign-out pushes first and warns about what could not go.
- Safari lets a page open the passkey sheet only shortly after the tap. Pages fetch a ceremony's options when they show its button, and fetch new ones before the worker's 5-minute challenge expires, so the tap opens the sheet without waiting for the network.
- Each user runs the app on one device, as the installed PWA, and the worker holds to it for passkey accounts: a passkey sign-in reports how many devices are signed in to the account already (`otherDevices`), and once the user agrees, the app claims the account (`POST /api/claim`), which forgets every other token a passkey handed out. The old device's next push answers 401, and the app takes a 401 on passkey credentials as the move: it forgets the credentials, marks itself signed out and records the `moved` sync problem. So a lost or replaced phone migrates by signing in on the new one, and signing in on a laptop says first that the phone will stop backing up. `AUTH_TOKENS` tokens are never claimed, so two devices with one typed token still share an account: neither sees the other's changes, and each push overwrites the server's copy of the rows it changed. Nor are two tabs supported: a page hears only its own notices, so another tab's changes show only after a reload.
- Every write lands in IndexedDB first, in one transaction with an outbox entry for each changed row. Nothing waits for the network.
- A sync runs on every page load, when the browser comes back online, when the app becomes visible, 2 seconds after the last write, and on "Sync now". Offline, it does nothing.
- A sync pushes the outbox to the worker in chunks of 500 rows, and pulls nothing. With nothing queued it sends no request.
- A database that has never synced, after a fresh install or a reset, runs a first sync instead, which restores the backup. It pulls everything, pushes the rows only it has, and takes the server's copy of any row that differs. The seed exercises have fixed IDs, so a device that seeded before saving credentials keeps the server's copies of them.
- A Web Lock keeps one push at a time, and an edit made while its row is on the wire stays queued for the next push.

## Worker API

`worker/` is a Cloudflare Worker with a D1 database. `worker/migrations/0001_rows.sql` has one table per row type keyed by user and row ID, and `0002_passkeys.sql` the accounts:

| Table             | Holds                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `users`           | One row per account a passkey signed up: `id`, `created_at`                                                               |
| `passkeys`        | `id` (credential ID), `user_id`, `rp_id`, `public_key` (SPKI), `alg` (-7 ES256 or -257 RS256), `sign_count`, `created_at` |
| `auth_tokens`     | `token_hash` (SHA-256 of a bearer token, hex), `user_id`, `created_at`. The token itself is never stored                  |
| `auth_challenges` | `challenge`, `purpose` (`register`, `signin` or `add`), `user_id`, `expires_at`. Each is used once, within 5 minutes      |

The routes under `/api/` and `/mcp` need an `Authorization: Bearer <token>` header. A token is one from the worker's `AUTH_TOKENS` variable, a JSON object that maps each token to a user ID (for tests, local runs and MCP), or one a passkey sign-up or sign-in handed out. Every query is scoped to the token's user.

The passkey routes take the RP ID from the request's `Origin`, which must be an allowed origin: `jimbro.nop33.com` in production, `localhost` locally. Registrations ask for a discoverable credential with user verification and attestation `none`, and the app sends the public key from the browser's `getPublicKey()`. The worker checks the client data's type, single-use challenge and origin, that no other origin embedded the ceremony (`crossOrigin`), the authenticator data's RP ID hash and its user present and user verified flags, and, on sign-in, that the passkey was made for this RP ID, the ES256 or RS256 signature and a sign count that has started counting. Each account's passkey is named after the day the account was made, "Jimbro · 12 Oct 2026", so two accounts read apart in a password manager. A credential registered already answers 409 `credential_exists`.

| Public route                  | What it does                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register/options` | Returns the options for `navigator.credentials.create()` for a new account, with every buffer as base64url                                                                    |
| `POST /auth/register/verify`  | Takes the registration, stores the account and its passkey, and returns `{ userId, token }`                                                                                   |
| `POST /auth/signin/options`   | Returns the options for `navigator.credentials.get()`, with no `allowCredentials`                                                                                             |
| `POST /auth/signin/verify`    | Takes the assertion, checks it against the stored passkey, and returns `{ userId, token, otherDevices }` with a new token and the count of the account's other passkey tokens |

The public routes allow each client address 20 calls a minute, through the `AUTH_LIMITER` rate limiting binding in `wrangler.jsonc`, and answer 429 past that. The limit counts per Cloudflare location and is approximate, as Cloudflare's rate limiting is. The Playwright run's local worker sets `AUTH_RATE_LIMIT=off`, since all its browsers share one address.

Since anyone can sign up, each user also has limits: `PUSH_LIMITER` allows 60 pushes a minute (429 `rate_limited`, which the outbox retries later), and an account stores at most 50,000 rows (`ROW_CAP` in `worker/src/rows.ts`, which the `ROW_CAP` variable can override). A push that would pass the cap stores nothing and answers 413 `{ error: 'row_limit', cap }`; the check runs inside the push's one batch. Any error the worker does not expect answers 500 with the CORS headers.

| Route                                  | What it does                                                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `GET /api/ping`                        | Returns `{ ok: true, userId }`                                                                                          |
| `POST /api/push`                       | Takes `{ rows: [{ table, row }] }` with up to 1000 rows, validates and stores them, and returns `{ revision }`          |
| `GET /api/pull?cursor=<rev>&limit=<n>` | Returns `{ rows, cursor, more }` with the rows above `cursor`, up to 1000 per page                                      |
| `GET /api/export`                      | Downloads every row as a version 4 export file                                                                          |
| `POST /api/passkeys/options`           | Returns the options to add another passkey to the signed-in account, excluding its passkeys                             |
| `POST /api/passkeys/verify`            | Takes the registration and stores the passkey on the account                                                            |
| `POST /api/signout`                    | Deletes the token, when a passkey handed it out, and returns `{ ok: true }`                                             |
| `POST /api/claim`                      | Moves the account to this device: deletes the account's other passkey tokens and returns `{ signedOut }`                |
| `POST /mcp`                            | A read-only MCP server over JSON-RPC, with the tools `recent_sessions`, `get_session`, `exercise_history` and `catalog` |

CORS allows `https://jimbro.nop33.com` and `http://localhost:5173`, plus `DEV_ORIGIN` when a local run sets it.

### Deploying

Deploy the worker and its D1 migrations before an app version that needs them. For passkeys, that is `vp exec wrangler d1 migrations apply jimbro --remote`, then `vp run deploy`, both in `worker/`, then the app.

## PWA features

| Feature            | Details                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web manifest       | `app.webmanifest` with name, icons (192, 384, 512, 1024), standalone display and WebP screenshots                                                                                                               |
| Install prompt     | Keeps the `beforeinstallprompt` event so the install button can open the prompt, and removes the button after `appinstalled`                                                                                    |
| iOS install        | Without that event, the install button shows an alert with "Add to Home Screen" instructions                                                                                                                    |
| Screen wake lock   | Requests a screen wake lock when gymtime opens, and again when the tab becomes visible if the first request succeeded                                                                                           |
| Haptic feedback    | A short vibration (`navigator.vibrate(2)`) on buttons, links, `<summary>` and `.light-haptic` elements, in browsers that have the Vibration API, which Safari lacks                                             |
| Persistent storage | Asks for persistent storage with `navigator.storage.persist()`. The browser decides, and the app only logs the answer                                                                                           |
| Service worker     | `src/serviceWorker.ts`, built to `/sw.js`, caches every page and asset of the build on install and answers from that cache, so the app opens offline. Each deploy installs a new one, which drops the old cache |

## UI features

- Toasts for success, error, warning and info. They last 3 or 5 seconds, queue up, and close on a tap.
- Confetti and a stamped message on the Web Animations API, in a popover above any dialog, with a random sound effect made with the Web Audio API. Under reduced motion only the message fades in and out.
- A dark theme with a custom palette (`jim-dark`, `jim-primary`, `jim-accent`, …) in `src/style.css`.
- Mobile first, with touch targets of at least 44×44 px.
- Native `<dialog>` for modals and `<details>` for collapsible sections, which animate unless `prefers-reduced-motion` is set.

## Navigation

- Every page has a bottom bar with Home, Workouts, Exercises, Programs, and highlights the current page. Its icons are inline [Lucide](https://lucide.dev) SVGs (ISC License).
- Stats opens from any highlight tile on Home.
- The pages outside the bottom bar (gymtime, stats and settings) have a back button that calls `window.history.back()`.
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

- `cursor` is the highest server revision the first sync reached, by its pull or its push. Only the first sync moves it.
- `seq` numbers the outbox entries, so a push can tell whether a row changed again while the push was running.
- `bootstrapped` marks a first sync that finished with `cursor` still at 0, because neither side had any rows.

`src/db/migrations.ts` creates these stores on a fresh install. A database from before version 9 is rebuilt empty, and the next sync pulls everything back from the server.

## Architecture

```
src/
  db/                  Persistence (IndexedDB)
    storage.ts         The shared IndexedDB connection, the generic reads, and writeRows
    types.ts           Every data shape: rows, sessions, export files. Shared with the worker
    catalogStore.ts    CatalogStore, the store exercises and programs share
    stores/            Exercises, programs and workout sessions, and the seed data
    migrations.ts      DB_VERSION and the version 9 stores
    exerciseLogging.ts Exercise kinds, log presets and set slots
    schemaUpgrade.ts   Upgrades records from older exports
    export.ts          JSON export, version 4
    import.ts          JSON import, versions 1 to 4
    cloudBackup.ts     Credentials and authenticated requests to the worker
    reactiveStore.ts   ReactiveStore<T>, the observable value behind the stores' state
  sync/                Cloud sync
    syncClient.ts      The app's sync(), wired to the worker and the open page
    passkeys.ts        Passkey sign-up, sign-in, another passkey and sign-out, with the browser's WebAuthn API
    syncEngine.ts      createSync: the first sync (restore), the push and reruns, behind a server port
    server.ts          The server port, and httpServer, its adapter for the worker's API
    queue.ts           Outbox entries and meta, queueRows, which writeRows calls in its transaction, and restartFirstSync
    outbox.ts          The push: take a chunk, send it, ack it under a Web Lock
    pull.ts            The first sync's commit of what it pulled
    bootstrap.ts       The first sync's plan for each row
    rows.ts            Row comparison and export conversion, shared with the worker
    pageChannel.ts     Page notices, as jimbro: window events
    freshness.ts       Whether the database changed since this page rendered it
    status.ts          Last sync time
  pages/               One folder per route
  features/            Toasts, confetti, haptic feedback
  navigation.ts        Back button and sync triggers
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

Then open http://localhost:5173 (not 127.0.0.1: WebAuthn takes no IP address as the RP ID) and tap "Create passkey" under Cloud Backup in Settings, or save user ID `dev` and token `dev-token` under "Use a token" and tap "Sync now".

If something else already listens on port 8787, start the worker with `vp run dev --port 8791` and put that port in `VITE_API_BASE`.

### Tests

- Unit tests are `tests/*.unit.test.ts`, run by Vitest.
- Worker tests in `worker/test/` run inside the Workers runtime with a local D1 database.
- End-to-end tests are `tests/*.spec.ts`, run by Playwright on Chromium, WebKit and Mobile Safari (iPhone 12). Playwright starts the dev server on port 5173. For each run it also starts a fresh local worker on `WORKER_PORT`, 8790 by default, which `tests/sync.spec.ts` and `tests/passkeys.spec.ts` talk to. The passkey specs use Chromium's virtual authenticator, so they run on Chromium only. If that port is busy, those tests fail with a message instead of using whatever listens there.
- Outside CI, Playwright reuses a dev server already running on port 5173, so stop your own `vp dev` before a run.
- Options after the script name go to Playwright, for example `vp run test tests/gymtime.spec.ts --project=chromium`.
