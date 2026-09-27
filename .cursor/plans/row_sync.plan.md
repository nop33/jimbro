---
name: Jimbro row sync
overview: Replace the full-snapshot R2 upload with per-row push and pull between IndexedDB and D1, then add a read-only MCP route.
---

# Jimbro row sync plan

The phone stops uploading one JSON snapshot per workout. That upload is past 1MB and grows with every set.
The phone keeps exercises, programs, session headers, and one row per set in IndexedDB. It pushes dirty rows and pulls rows after its cursor.
The worker stores the same four tables in D1 and assigns every write an integer revision.
The rule is that no workout history is lost. Every set in R2 `latest.json` and in IndexedDB today ends up in D1.
The PRs land in this order. pr-rows, pr-d1, pr-sync, pr-mcp.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record. Appendix E holds the data shapes every PR builds on. Read it before any PR section.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. No owner merges. The root appends each verified PR to one linear stack. The operator lands the whole stack herself. pr-rows and pr-sync are review-gated and stop at merge-ready for her review in chat.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on her explicit go.
- [ ] On her explicit go, create a goal with this exact text. "Run `.cursor/plans/row_sync.plan.md` under Autopilot-stack. Build pr-rows, pr-d1, pr-sync, pr-mcp in that order, each branched from the one below. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. No owner merges. The operator lands the stack. Done when all four PRs sit in one linear stack with a clean verdict at each head SHA, and pr-rows and pr-sync carry the operator's review approval."
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:.cursor/plans/row_sync.plan.md`
  - [ ] `git show origin/main:CLAUDE.md`
  - [ ] `git show origin/main:AGENTS.md`
  - [ ] `git show origin/main:worker/AGENTS.md`
  - [ ] `git show origin/main:.cursorrules`
  - [ ] The installed poteto-mode playbooks `autopilot-stack.md`, `opening-a-pr.md`, and `babysit.md`, plus the `swarm`, `deslop`, and `no-comments` skills. They were not on the planning VM. Appendix D records the gap.
- [ ] Arm a thread heartbeat for the 30-minute audit tick. Never hold a shell open to sleep.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk and the live goal. Audit the operation against both. Probe every active lane through supported status and judge progress by side effects only. Reconcile and stand down a stuck lane before one bounded replacement. Then send the operator the queue table, verdicts since the last tick, merges, open gates, and blockers."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full Autopilot-stack lifecycle. Build, register the PR, self-prove, triage Bugbot, deslop, no-comments, babysit to green, report STACK-READY with the head SHA.
- [ ] Follow this dependency graph. Each PR is based on the branch of the PR below it. A child owner starts only after its parent reports STACK-READY and the root's verdict is clean.
  - [ ] pr-rows is first. It branches from `main` as `cursor/row-sync-rows-<suffix>`.
  - [ ] pr-d1 after pr-rows. It branches from the pr-rows branch as `cursor/row-sync-d1-<suffix>`.
  - [ ] pr-sync after pr-d1. It branches from the pr-d1 branch as `cursor/row-sync-sync-<suffix>`.
  - [ ] pr-mcp after pr-sync. It branches from the pr-sync branch as `cursor/row-sync-mcp-<suffix>`.
- [ ] Hold the file boundaries.
  - [ ] pr-rows touches only `src/**`, `tests/**`, and `data-backup/**` fixtures. It does not touch `worker/**`.
  - [ ] pr-d1 touches only `worker/**`, plus read-only imports of `src/sync/rows.ts`. It does not touch any page under `src/pages/**`.
  - [ ] pr-sync touches `src/**`, `tests/**`, and deletes the snapshot routes in `worker/src/**`.
  - [ ] pr-mcp touches only `worker/**`.
- [ ] Hold the review gate. pr-rows and pr-sync change the gym UI. They wait for the operator's review in chat with screenshots and a video before they count as ready to land.
- [ ] Hold the banned list in every owner brief. No React or other frontend framework. No sync library. No CRDT. No service worker. No OAuth. No D1 query from the phone. No MCP work before pr-sync is STACK-READY.

### PR mechanics, for every PR

- [ ] Open the PR ready, never draft, with its base set to the parent PR's branch. Graphite `gt` was not installed on the planning VM. Use it when present, otherwise plain stacked GitHub PRs with each base set by hand.
- [ ] Author every commit as `Ilias Trichopoulos <hlias.nop@gmail.com>` for both author and committer. Strip any `Co-authored-by` trailer a hook injects before pushing.
- [ ] Run `vp check` and `vp test run` once before the PR-facing push. For worker changes also run `cd worker && vp exec tsc --noEmit && vp run test`. Push with hooks on.
- [ ] Run `$deslop` before each commit and `$no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`. Fix, dismiss with a concrete reason, or ask.
- [ ] Rebase onto the current parent branch before babysit and again before the STACK-READY report.

### Verdict and merge, for every PR

- [ ] At the STACK-READY head SHA, run the swarm per the `swarm` skill. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. One audit lane that reads the diff and the receipts and distrusts the PR body.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner. A new head gets a fresh swarm and a fresh verdict.
- [ ] Nobody merges. A clean verdict appends the PR to the one linear stack. After any restack, compare `git patch-id` at each verdict SHA against the new head. A PR whose patch-id moved goes back through the swarm before delivery.

### Boot recipe, for every live lane

Each live lane runs in its own isolated environment at the PR head through a detected live-control capability. A missing capability blocks that lane.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `vp install` and `cd worker && vp install`. For lanes that talk to the worker, start `cd worker && vp exec wrangler d1 migrations apply jimbro --local` and then `vp exec wrangler dev --local --port 8787` in a tmux session. Wait for `Ready on http://localhost:8787`. Seed the local R2 bucket with `vp exec wrangler r2 object put jimbro-backups/users/nikos/latest.json --local --file <fixture>`.
- [ ] Start the app with `vp dev --host` in a tmux session. Wait for `http://localhost:5173` to answer. For sync lanes point `API_BASE` at `http://localhost:8787` through the `VITE_API_BASE` env var that pr-sync adds.
- [ ] Deliver browser input only through the computerUse subagent or a headed Playwright script. Deliver worker input only through `curl` with `Authorization: Bearer <token>`. Deliver MCP input only through a real MCP client, `vp dlx @modelcontextprotocol/inspector --cli`. Read-only diagnostics are the IndexedDB panel, `wrangler d1 execute jimbro --local --command`, and the `wrangler dev` log.
- [ ] Save every screenshot or response log to `/tmp1-<pr-id>/worker-<n>/<slug>` and return the paths with the report.

## Split local sessions into headers and set rows (pr-rows)

**Depends on.** None. It branches from `main`.

**Files.**

- [ ] Create `src/sync/rows.ts`. It imports types only from `src/db/exerciseLogging.ts` and `src/db/muscleGroups.ts`, never from `src/db/storage.ts` or `src/db/stores/**`, so the worker can import it without DOM types.
- [ ] Create `src/db/stores/setsStore.ts`.
- [ ] Edit `src/db/constants.ts`, `src/db/migrations.ts`, `src/db/storage.ts`, `src/db/stores/workoutSessionsStore.ts`, `src/db/stores/exercisesStore.ts`, `src/db/stores/programsStore.ts`, `src/db/export.ts`, `src/db/import.ts`, and `src/state/GymtimeSessionState.ts`.
- [ ] Edit `tests/workoutSessionStatus.spec.ts` so its direct IndexedDB writes use the header and set row shapes.
- [ ] Create `tests/rows.unit.test.ts` and `tests/rowsMigration.spec.ts`.

**Build.**

- [ ] Define `SessionHeader`, `SetRow`, `ExerciseRow`, `ProgramRow`, `RowTable`, and `legacySetId` in `src/sync/rows.ts` exactly as Appendix E states.
- [ ] Add pure `rowsFromSession`, `sessionFromRows`, `rowsFromExport`, and `exportFromRows` to `src/sync/rows.ts`. `sessionFromRows` drops tombstoned sets and orders live sets by `position`.
- [ ] Add IndexedDB migration version 7 in `src/db/migrations.ts`. It creates the `sets` store with key `id` and indexes `sessionId` and `exerciseId`. It walks `workoutSessions`, writes one set row per embedded set with `legacySetId`, and rewrites each session as a header with `isDeleted` false. `createCurrentObjectStores` gains the `sets` store for fresh databases.
- [ ] Add `Storage.writeRows(writes)` in `src/db/storage.ts`. It writes any mix of rows across stores in one `readwrite` transaction. Every row write in the app goes through it. pr-sync adds the outbox inside this one function.
- [ ] Rewrite `WorkoutSessionsStore` in `src/db/stores/workoutSessionsStore.ts` over headers plus `setsStore`. Keep every public method name and its `WorkoutSession` return type so pages do not change. `addExerciseExecutionSetToWorkoutSession` writes one new set row with `crypto.randomUUID()` and `position` equal to the live set count. `updateExerciseExecutionSetInWorkoutSession` rewrites the row at that position. Removing or swapping an exercise tombstones its set rows. `deleteWorkoutSession` sets `isDeleted` on the header and its sets instead of deleting them.
- [ ] Filter tombstoned headers in every read path of `WorkoutSessionsStore`, including the date-index cursors.
- [ ] Make `buildExportData` in `src/db/export.ts` read all four stores unfiltered and call `exportFromRows`, so the file keeps the version 4 shape. Filter tombstoned sessions out of the file so it matches today's content.
- [ ] Make `importIndexedDbFromJson` in `src/db/import.ts` call `rowsFromExport` and write through `writeRows`. Keep the merge-by-id rule and the version 1 path.
- [ ] Keep the cloud upload on workout completion in `src/pages/gymtime/ExerciseCard.ts` working. It still sends `buildExportData()` to `PUT /api/snapshot`.

**You see.**

- [ ] The IndexedDB panel on `/gymtime/` shows a `sets` store and headers in `workoutSessions` with no `sets` arrays inside `exercises`.
- [ ] Logging a set on `/gymtime/` with the network off adds one row in `sets` and the set appears on the card.
- [ ] Settings export downloads a file that passes `exportFromRows(rowsFromExport(file))` equality with the pre-migration export of the same database.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/rows.unit.test.ts` gains a round-trip case. `exportFromRows(rowsFromExport(x))` deep-equals `x` for the upgraded `data-backup/gymbro-export-2026-01-02.json`, with literal counts of 106 sessions and 2581 sets. Run `vp test run tests/rows.unit.test.ts`.
- [ ] `tests/rows.unit.test.ts` gains a `legacySetId` case with a literal expected id string, and a tombstone case where `sessionFromRows` drops a deleted set and renumbers nothing.
- [ ] `tests/rowsMigration.spec.ts` opens a version 6 database with three old-shape sessions, loads `/workouts/`, and asserts literal header and set row counts plus one assembled session's sets. Run `vp exec playwright test tests/rowsMigration.spec.ts --project=chromium`.
- [ ] The full suites pass. Run `vp check`, `vp test run`, and `vp exec playwright test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe. Lanes 1 to 3 start from a trunk-built database holding the imported January fixture, then load the head build.

- [ ] Lane 1. Import the fixture on trunk, load the head build, open `/workouts/`. Save `rows-history.png`. Pass when the week list shows the same sessions and dates as the trunk screenshot of the same database.
- [ ] Lane 2. After lane 1, open the IndexedDB panel. Save `rows-idb.png`. Pass when `sets` holds 2581 rows and no header in `workoutSessions` has a `sets` field.
- [ ] Lane 3. After lane 1, open one historic session on `/gymtime/?id=<id>`. Save `rows-historic-session.png`. Pass when every card shows the same set values as trunk.
- [ ] Lane 4. Start a new session from `/workouts/`, go offline in devtools, log three sets. Save `rows-offline-log.png`. Pass when the three sets render and `sets` gains three rows with random UUID ids.
- [ ] Lane 5. Edit the second logged set through the edit dialog. Save `rows-edit-set.png`. Pass when the card shows the new value and the row at position 1 changed while its id stayed the same.
- [ ] Lane 6. Add an exercise, log a set on it, then remove it. Save `rows-remove-exercise.png`. Pass when the card is gone and its set row has `isDeleted` true.
- [ ] Lane 7. Swap an exercise that has logged sets. Save `rows-swap.png`. Pass when the new exercise shows zero sets and the old sets are tombstoned.
- [ ] Lane 8. Delete a session from the gymtime page. Save `rows-delete-session.png`. Pass when it disappears from `/workouts/` and its header and sets remain with `isDeleted` true.
- [ ] Lane 9. Complete every set of a session with cloud credentials pointing at `wrangler dev --local` of the pr-rows head. Save `rows-complete-upload.png`. Pass when the confetti shows, the toast reads `Backup saved`, and the local R2 `latest.json` holds the new session in the version 4 shape.
- [ ] Lane 10. Export from Settings, wipe the database, import that file. Save `rows-export-import.png`. Pass when `/workouts/` and `/stats/` match their screenshots from before the wipe.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from page load to rendered content on `/workouts/`, `/stats/`, and `/gymtime/?id=<latest>`, plus time from tapping set done to the set rendering, with the January fixture copied four times so about 10,000 set rows exist.
- [ ] Probe. A Playwright script `tests/perf/rows.perf.ts` reads `performance.now()` marks around each step. Run it at trunk and at the head, interleaved, five runs each, on the chromium project.
- [ ] Baseline. Record the trunk medians first.
- [ ] Rule. Fail when any head median exceeds its trunk median by more than 25 percent and more than 50ms at once.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 3, 4, 6, and 8 screenshots into `/opt/cursor/artifacts/pr-rows-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of offline logging, editing, and removing an exercise on a lane VM. Save it as `/opt/cursor/artifacts/pr-rows-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's approval.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] The root appends pr-rows to the stack as its base link. The operator lands it.

## Add D1, push, pull, and the one-time R2 import to the worker (pr-d1)

**Depends on.** pr-rows. It imports `src/sync/rows.ts`.

**Files.**

- [ ] Create `worker/migrations/0001_rows.sql`.
- [ ] Create `worker/src/rows.ts`.
- [ ] Edit `worker/src/index.ts`, `worker/wrangler.jsonc`, `worker/worker-configuration.d.ts`, `worker/vitest.config.mts`, and `worker/tsconfig.json` if the shared import needs an include.
- [ ] Create `worker/test/sync.spec.ts` and `worker/test/apply-migrations.ts`.
- [ ] Create `worker/test/fixtures/latest-v4.json` by importing `data-backup/gymbro-export-2026-01-02.json` into a trunk build and exporting it from Settings. The January file is version 1 with no session ids, and the import route accepts only version 4.

**Build.**

- [ ] Write the four tables of Appendix E in `worker/migrations/0001_rows.sql`. Each has primary key `(user_id, id)`, a `rev` integer, and a `data` JSON text column. Add `(user_id, rev)` indexes on all four, `(user_id, session_id)` and `(user_id, exercise_id)` on `sets`, and `(user_id, date)` on `sessions`.
- [ ] Bind D1 as `DB` to database `jimbro` in `worker/wrangler.jsonc`. Run `vp exec wrangler types`.
  - [ ] Ask the operator to run `wrangler d1 create jimbro` and paste the `database_id`. Creating a production resource is hers. Local tests and lanes use any placeholder id until then.
- [ ] Add `upsertRows(db, userId, table, rows)` in `worker/src/rows.ts`. It issues one `INSERT ... SELECT FROM json_each(?2) ON CONFLICT DO UPDATE` statement per table per chunk of at most 1000 rows. Each row's `rev` is the user's current maximum across all four tables plus its array index plus one. All statements of one request go in one `db.batch`, so revisions are unique and a request is atomic.
- [ ] Add `POST /api/push` in `worker/src/index.ts`. The body is `{ rows: Array<{ table, row }> }` with at most 1000 rows. It parses every row at the boundary against the Appendix E shapes and answers 400 `invalid_row` with the offending index on failure. It answers 409 `import_required` while the user has zero rows in D1 and `users/<userId>/latest.json` exists in R2. It answers `{ revision }` with the new maximum.
- [ ] Add `GET /api/pull?cursor=<n>&limit=<n>` in `worker/src/index.ts`. It unions the four tables with `rev > cursor`, orders by `rev`, caps `limit` at 1000, and answers `{ rows, cursor, more }` where `cursor` is the last returned `rev`.
- [ ] Add `POST /api/import-r2` in `worker/src/index.ts`. It reads `users/<userId>/latest.json` from `BACKUP_BUCKET`, requires export version 4 and an id on every session, calls `rowsFromExport`, and writes through `upsertRows`. It answers 409 `already_imported` when the user already has rows, so a second call changes nothing.
- [ ] Add `GET /api/export` in `worker/src/index.ts`. It reads all four tables and returns `exportFromRows` as a download with `Content-Disposition: attachment`.
- [ ] Allow `POST` in the CORS methods list.
- [ ] Keep `PUT /api/snapshot` and `GET /api/snapshot/latest` unchanged. The phone still uses them.
- [ ] Apply D1 migrations in worker tests through `readD1Migrations` in `worker/vitest.config.mts` and `applyD1Migrations` in `worker/test/apply-migrations.ts`.

**You see.**

- [ ] `curl -X POST localhost:8787/api/import-r2` against the seeded local R2 answers 200 with literal counts of 21 exercises, 3 programs, 106 sessions, and 2581 sets for the January fixture upgraded to version 4.
- [ ] `curl localhost:8787/api/export` returns a file that deep-equals the seeded `latest.json` after both are sorted by id.
- [ ] `curl "localhost:8787/api/pull?cursor=0&limit=1000"` answers 1000 rows and `more` true.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `worker/test/sync.spec.ts` gains cases for push then pull returning literal revisions 1 to 3, a repeated push of the same id keeping one row and moving it to revision 4, pull paging with `more`, 409 `import_required`, 409 `already_imported`, 400 `invalid_row`, and 401 on every new route without a token. Run `cd worker && vp run test`.
- [ ] `worker/test/sync.spec.ts` gains an import case that feeds a version 4 fixture into R2 and asserts `GET /api/export` deep-equals it.
- [ ] Worker typecheck passes with the shared import. Run `cd worker && vp exec tsc --noEmit`.
- [ ] The client suites still pass. Run `vp check` and `vp test run`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe. The surface is the worker over HTTP on `wrangler dev --local`, so each lane saves a response log.

- [ ] Lane 1. Seed R2 with `worker/test/fixtures/latest-v4.json`, call `POST /api/import-r2`. Save `d1-import.log`. Pass when the counts are 21, 3, 106, and 2581.
- [ ] Lane 2. Call `POST /api/import-r2` again. Save `d1-import-again.log`. Pass when it answers 409 `already_imported` and a D1 row count query is unchanged.
- [ ] Lane 3. Call `GET /api/export` and diff it against the seeded file with `jq -S`. Save `d1-export-diff.log`. Pass when the diff is empty.
- [ ] Lane 4. On a fresh user with R2 data, push one set. Save `d1-push-before-import.log`. Pass when it answers 409 `import_required` and D1 holds zero rows for that user.
- [ ] Lane 5. Push a new set row, then pull from the previous maximum revision. Save `d1-push-pull.log`. Pass when the pull returns exactly that row at the maximum plus one.
- [ ] Lane 6. Push the same set id twice with different weights. Save `d1-repeat-push.log`. Pass when D1 holds one row with the second weight and a higher revision.
- [ ] Lane 7. Pull from cursor 0 in pages of 1000 until `more` is false. Save `d1-full-pull.log`. Pass when the summed row count equals the four table counts and revisions strictly increase.
- [ ] Lane 8. Push a row with a missing `sessionId`. Save `d1-invalid.log`. Pass when it answers 400 `invalid_row` with index 0 and no row changed.
- [ ] Lane 9. Call every new route without a token and with a wrong token. Save `d1-auth.log`. Pass when each answers 401.
- [ ] Lane 10. Run the pr-rows app against this worker and complete a workout. Save `d1-old-upload.log`. Pass when `PUT /api/snapshot` still answers 200 and D1 is untouched.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. D1 queries per request and wall time for import, a 1000-row push, and a 1000-row pull, on the fixture copied four times.
- [ ] Probe. `worker/test/sync.perf.spec.ts` counts statements through a wrapped `DB` binding and times each call, five runs each. Trunk has no D1, so the baseline is the trunk `PUT /api/snapshot` of the same data.
- [ ] Baseline. Record the trunk snapshot PUT time for the fixture copied four times first.
- [ ] Rule. Fail when any request issues more than 20 D1 queries, which keeps it under the 50-query free-plan cap, or when a 1000-row push takes longer than the trunk snapshot PUT of the whole history.

**Review gate.** None. pr-d1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the pr-rows branch after the verdict, patch-id unchanged.
- [ ] The root appends pr-d1 on top of pr-rows. The operator lands it, deploys the worker, and runs the import in production before she lands pr-sync.

## Move the phone to the outbox and remove the snapshot upload (pr-sync)

**Depends on.** pr-d1.

**Files.**

- [ ] Create `src/sync/syncClient.ts`.
- [ ] Edit `src/db/constants.ts`, `src/db/migrations.ts`, `src/db/storage.ts`, `src/db/cloudBackup.ts`, `src/navigation.ts`, `src/pages/settings/CloudBackup.ts`, `src/pages/gymtime/ExerciseCard.ts`, `src/pages/workouts/index.ts`, and the settings markup in `settings/index.html`.
- [ ] Delete `worker/src/shrinkGuard.ts`, `worker/src/validate.ts`, the snapshot routes in `worker/src/index.ts`, and their cases in `worker/test/index.spec.ts`.
- [ ] Create `tests/sync.spec.ts`.

**Build.**

- [ ] Add IndexedDB migration version 8 in `src/db/migrations.ts`. It creates `outbox` keyed by `table:id` and `meta` keyed by name. It seeds `outbox` with every row of all four stores, so the first sync pushes the whole local history. It writes `meta.cursor` as 0.
- [ ] Make `Storage.writeRows` put an outbox entry `{ table, id, seq }` for every row in the same transaction. `seq` comes from a counter in `meta`.
- [ ] Add `sync()` in `src/sync/syncClient.ts`. It runs at most once at a time. It pushes the outbox in chunks of 500. After a 200 it deletes each outbox entry only when its `seq` is unchanged, so an edit made during the request stays dirty. On 409 `import_required` it stops and keeps the outbox. Then it pulls from `meta.cursor` until `more` is false. Each page writes its rows and the new cursor in one transaction and skips any row whose id is in the outbox.
- [ ] Call `sync()` from `src/navigation.ts` on page load, on the `online` event, on `visibilitychange` to visible, and two seconds after any `writeRows` call. It does nothing without credentials or while `navigator.onLine` is false.
- [ ] After a pull that changes the open session, re-assemble it through `GymtimeSessionState.initialize` so the workout screen reflects it.
- [ ] Delete `uploadToCloud`, `restoreFromCloud`, and the last-backup date from `src/db/cloudBackup.ts`. Read `API_BASE` from `import.meta.env.VITE_API_BASE` with the production URL as default.
- [ ] Remove the completion upload from `src/pages/gymtime/ExerciseCard.ts`. Keep the local file download when no credentials exist.
- [ ] Replace the Backup and Restore buttons in `src/pages/settings/CloudBackup.ts` with a Sync now button and a status line that shows the pending outbox count and the last sync time. Keep the credentials form as the sign-in.
- [ ] Hide the Seed Database button in `src/pages/workouts/index.ts` while credentials exist and `meta.cursor` is 0. Show a Restore from cloud button that runs `sync()` instead.
- [ ] Delete `PUT /api/snapshot`, `GET /api/snapshot/latest`, `shrinkGuard.ts`, and `validate.ts` from the worker. Keep the R2 binding for `POST /api/import-r2` and leave the stored R2 objects untouched.

**You see.**

- [ ] Completing a workout sends only `POST /api/push` requests in the network panel, and no request body exceeds 200KB.
- [ ] Settings shows `0 pending` and a last sync time after a sync.
- [ ] After deleting the database and signing in again, `/workouts/` shows the full history.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/sync.spec.ts` gains a wipe-and-restore case against `wrangler dev --local`. It imports the fixture, syncs, deletes the database, reloads, syncs, and asserts that the Settings export deep-equals `GET /api/export`. Run `vp exec playwright test tests/sync.spec.ts --project=chromium`.
- [ ] `tests/sync.spec.ts` gains an offline case. It logs three sets offline, asserts the outbox holds three entries, goes online, and asserts the outbox is empty and D1 holds the three rows.
- [ ] `tests/sync.spec.ts` gains an in-flight edit case where a set changes during a slow push and stays in the outbox with the new value.
- [ ] `worker/test/index.spec.ts` no longer references snapshot routes and `worker/test/sync.spec.ts` still passes. Run `cd worker && vp run test`.
- [ ] The full suites pass. Run `vp check`, `vp test run`, and `vp exec playwright test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe. Lanes use `wrangler dev --local` with the fixture imported through `POST /api/import-r2`.

- [ ] Lane 1. Load a pr-d1 build database with history, then the head build, signed in. Save `sync-first-push.png`. Pass when Settings reaches `0 pending` and D1 row counts equal the local store counts.
- [ ] Lane 2. Go offline, log three sets. Save `sync-offline-pending.png`. Pass when the sets render and Settings shows `3 pending`.
- [ ] Lane 3. Go online after lane 2. Save `sync-online-drain.png`. Pass when Settings shows `0 pending` within five seconds and D1 holds the three rows.
- [ ] Lane 4. Complete a workout online. Save `sync-complete-network.png`. Pass when the network panel shows no `PUT /api/snapshot` and every request body is under 200KB.
- [ ] Lane 5. Delete the database while online, reload, open `/workouts/`. Save `sync-wipe-online.png`. Pass when the Restore from cloud button shows and Seed Database does not.
- [ ] Lane 6. Tap Restore from cloud after lane 5. Save `sync-restored.png`. Pass when `/workouts/` and `/stats/` match their screenshots from before the wipe.
- [ ] Lane 7. Clear all site data while offline, reload. Save `sync-wipe-offline.png`. Pass when the app shows an empty database and makes no network request.
- [ ] Lane 8. Go online after lane 7, sign in on Settings, open `/workouts/`, tap Restore from cloud. Save `sync-offline-wipe-restored.png`. Pass when every pushed session returns and the three sets logged after the last push are absent.
- [ ] Lane 9. Edit a pushed set on device A and sync, then sync device B. Save `sync-second-device.png`. Pass when device B shows the edited value.
- [ ] Lane 10. Sign in with a wrong token. Save `sync-bad-token.png`. Pass when Settings shows an auth error, the outbox keeps its entries, and logging still works.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Bytes uploaded per completed workout, time from tapping set done to the set rendering, and time for a full restore from cursor 0 of the fixture copied four times.
- [ ] Probe. Extend `tests/perf/rows.perf.ts` to sum request body sizes for one completed workout and time each step. Run it at the pr-d1 head, which still uploads the snapshot, and at this head, interleaved, five runs each.
- [ ] Baseline. Record the pr-d1 head bytes per completed workout and the set-done median first.
- [ ] Rule. Fail when bytes per completed workout exceed 5 percent of the baseline, when the set-done median exceeds the baseline by more than 25 percent and more than 50ms at once, or when a full restore takes longer than 15 seconds.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2, 3, 6, and 8 screenshots into `/opt/cursor/artifacts/pr-sync-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of offline logging, the outbox draining, a wipe, and the restore on a lane VM. Save it as `/opt/cursor/artifacts/pr-sync-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's approval.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the pr-d1 branch after the verdict, patch-id unchanged.
- [ ] The root appends pr-sync on top of pr-d1. The operator lands it only after the production import has answered 200.

## Add the read-only MCP route to the worker (pr-mcp)

**Depends on.** pr-sync.

**Files.**

- [ ] Create `worker/src/mcp.ts`.
- [ ] Edit `worker/src/index.ts`.
- [ ] Create `worker/test/mcp.spec.ts`.

**Build.**

- [ ] Route `POST /mcp` in `worker/src/index.ts` through `resolveUserId`. Answer 401 without a valid bearer token. Answer 405 on every other method.
- [ ] Implement stateless MCP over streamable HTTP with JSON responses in `worker/src/mcp.ts`. Handle `initialize`, `notifications/initialized`, `tools/list`, and `tools/call`. No sessions and no server-sent events.
- [ ] Register four tools in one `as const` table in `worker/src/mcp.ts`.
  - [ ] `recent_sessions` takes `limit` from 1 to 50, default 10. It returns non-deleted headers by date descending with live set counts per exercise.
  - [ ] `get_session` takes `id`. It returns the header and its live sets ordered by exercise order and `position`.
  - [ ] `exercise_history` takes `exerciseId` and `limit` from 1 to 100 sessions, default 20. It returns live sets grouped by session date descending.
  - [ ] `catalog` takes nothing. It returns non-deleted exercises and programs.
- [ ] Add `revision`, the user's maximum `rev` across the four tables, to every tool result.
- [ ] Issue only `SELECT` statements from `worker/src/mcp.ts`, at most three per call.

**You see.**

- [ ] `vp dlx @modelcontextprotocol/inspector --cli http://localhost:8787/mcp --transport http --header "Authorization: Bearer <token>" --method tools/list` lists exactly the four tools.
- [ ] `get_session` for the latest fixture session returns its sets and a `revision` equal to the maximum `rev` in D1.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `worker/test/mcp.spec.ts` gains one case per tool against seeded rows with literal expected results, a 401 case, a tombstone case where a deleted session never appears, and a case asserting `revision` equals the maximum `rev`. Run `cd worker && vp run test`.
- [ ] `worker/test/mcp.spec.ts` gains a case that calls an unknown tool and asserts a JSON-RPC error with no D1 write.
- [ ] Worker typecheck passes. Run `cd worker && vp exec tsc --noEmit`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on the configured fast profile at the PR head, per the boot recipe. The surface is a real MCP client against `wrangler dev --local` with the fixture imported, so each lane saves a response log.

- [ ] Lane 1. Run `tools/list`. Save `mcp-list.log`. Pass when it lists exactly the four tools with their input schemas.
- [ ] Lane 2. Call `recent_sessions` with no arguments. Save `mcp-recent.log`. Pass when it returns 10 sessions in date order, newest `2026-01-02`.
- [ ] Lane 3. Call `get_session` for the `2026-01-02` session. Save `mcp-session.log`. Pass when its sets match that session in the fixture.
- [ ] Lane 4. Call `exercise_history` for one fixture exercise. Save `mcp-history.log`. Pass when the sets match that exercise across fixture sessions, newest first.
- [ ] Lane 5. Call `catalog`. Save `mcp-catalog.log`. Pass when it returns 21 exercises minus tombstones and 3 programs.
- [ ] Lane 6. Push a new set through `/api/push`, then call `get_session`. Save `mcp-revision.log`. Pass when the set appears and `revision` rose by one.
- [ ] Lane 7. Tombstone a session through `/api/push`, then call `recent_sessions`. Save `mcp-tombstone.log`. Pass when that session is absent.
- [ ] Lane 8. Call the route with no token and with a wrong token. Save `mcp-auth.log`. Pass when both answer 401.
- [ ] Lane 9. Send `GET /mcp` and a `tools/call` for an unknown tool. Save `mcp-errors.log`. Pass when the first answers 405 and the second returns a JSON-RPC error.
- [ ] Lane 10. Add the local route to a Cursor or Claude MCP config with the bearer header and ask for the last three workouts. Save `mcp-agent.png`. Pass when the agent answers from `recent_sessions` and D1 row counts are unchanged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time and D1 query count per tool call, and response size of `recent_sessions` at its default limit, on the fixture copied four times.
- [ ] Probe. `worker/test/mcp.perf.spec.ts` times each tool five times through a statement-counting `DB` wrapper. The baseline is `GET /api/export` at the pr-sync head, the only read path before this PR.
- [ ] Baseline. Record the pr-sync head `GET /api/export` time first.
- [ ] Rule. Fail when any tool issues more than three queries, when any tool median exceeds the export median, or when `recent_sessions` at default limit exceeds 64KB.

**Review gate.** None. pr-mcp is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the pr-sync branch after the verdict, patch-id unchanged.
- [ ] The root appends pr-mcp as the tip of the stack. The operator lands it and deploys the worker.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the Autopilot-stack report. Links to the stack root and tip, a one-line verdict per link, the review media for pr-rows and pr-sync, and anything parked with its reason.
- [ ] Remind the operator of the production order. Deploy the pr-d1 worker, run `POST /api/import-r2`, confirm `GET /api/export` matches `latest.json`, then land pr-sync.

## Appendix A. Prototype evidence

One question could be settled by running code before the plan. Can D1 upsert thousands of rows in a handful of statements and still give each row its own integer revision?

The prototype lives outside the repo in `/tmp/proto` on the planning VM, with no branch and no SHA. It ran `wrangler dev --local` from `worker/node_modules`. The request body was the January fixture copied four times, 424 sessions and 10,324 sets, 2.2MB of JSON. Two statements in one `db.batch` each bound one JSON array and used `INSERT ... SELECT FROM json_each(?2) ON CONFLICT DO UPDATE`. The revision was the maximum across tables plus `key + 1`.

Measured locally.

- The first push wrote 424 and 10,324 rows in 75ms.
- A pull from cursor 0 returned 500 rows with revisions 1 to 500 in order.
- There were 10,748 distinct revisions for 10,748 rows, so revisions stayed unique across the two tables.
- A repeated push of the same ids kept 10,324 set rows and moved them to revisions 10,749 to 21,496, which is the "repeated push updates that row" rule.

Stays unproven.

- Remote D1 limits. The local runtime does not enforce the 2MB per-value cap or the 50-query free-plan cap. That is why pr-d1 chunks at 1000 rows per statement and its perf rule counts queries.
- No Cloudflare credentials existed on the planning VM, so nothing ran against production D1 or R2.
- The real `latest.json` was not read. Its version and whether every session carries an id are inferred from `CURRENT_EXPORT_VERSION = 4` in `src/db/export.ts`. pr-d1 lane 1 must run on a copy of the real file before production.

## Appendix B. Alternatives rejected

- Random UUIDs for migrated sets. The phone migration and the server import would give the same historic set two different ids. The first sync would duplicate every historic set. `legacySetId` makes both sides compute the same id.
- A fifth D1 table for a revision counter. The operator fixed four tables. The maximum `rev` across the four tables inside one batch gives the same guarantee because a D1 database runs one query at a time.
- One revision per push request. Pull pages by `rev` would split a large push across pages at the same `rev` and lose rows. Per-row revisions page safely.
- Adding the outbox in pr-rows. It would make pr-rows do sync work the operator scoped to pr-sync. Routing every write through `Storage.writeRows` in pr-rows gives pr-sync one place to add it.
- Hard deletes for sessions and removed sets. A pull cannot carry a row that no longer exists, so a delete on one device would never reach another or survive a restore. Tombstones via `isDeleted` travel like any other row.
- Server-side last-writer-wins by `updatedAt`. The operator fixed "a repeated push of the same id updates that row". Phone clocks drift, and one person logs from one phone, so arrival order is enough.
- The MCP TypeScript SDK or the Cloudflare Agents SDK. Four stateless read tools need `initialize`, `tools/list`, and `tools/call`. The Agents SDK needs a Durable Object. Hand-rolled JSON-RPC keeps the worker dependency-free, and lane 10 proves a real client accepts it.
- Running the R2 import from a script with `wrangler d1 execute`. It needs a second copy of the fold logic outside the worker. An authenticated worker route reuses `rowsFromExport` and is idempotent.

## Appendix C. Risks

- The first sync after pr-sync pushes the whole local history, about 10,000 rows in 20 requests. pr-sync watches that it finishes and resumes after a closed tab, since each chunk leaves the outbox only on a 200.
- A wiped phone that taps Seed Database before the first pull would push seed catalog rows over the user's edited exercises. pr-sync hides the button while credentials exist and the cursor is 0. Lane 5 checks it.
- pr-sync landing before the production import would push phone rows into an empty D1. The 409 `import_required` gate in pr-d1 stops that, and the outbox keeps the rows. pr-d1 lane 4 checks it.
- Read paths now assemble sessions from about 10,000 set rows. `/stats/` and the exercise history chart read everything. pr-rows perf rule watches it.
- The shared `src/sync/rows.ts` must stay free of DOM imports or the worker typecheck fails. pr-d1 runs the worker `tsc` in its unit block.
- IndexedDB migration version 7 runs inside `onupgradeneeded`. A throw there leaves the user on version 6 with no app. pr-rows `tests/rowsMigration.spec.ts` covers a real version 6 database in a real browser.
- Positions and array indexes. `updateSet(index)` addresses the set at that position among live sets. A tombstoned set in the middle would shift indexes. The app has no single-set delete today, so pr-rows keeps positions dense and tombstones only whole exercises or sessions.
- The Mobile Safari project runs on WebKit in CI, and iOS evicts storage under pressure. The offline wipe lane is the accepted-loss case, not a bug.
- No live-control capability for Cursor's `control-ui` existed on the planning VM. Browser lanes fall back to the computerUse subagent or headed Playwright. If neither runs, the lane fails closed.

## Appendix D. Links and reading list

- `CLAUDE.md` and `.cursorrules` for the no-framework rule and the `vp` commands.
- `worker/AGENTS.md`. It requires reading current Cloudflare docs before any D1 change.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). 100 bound parameters per query, 100KB per statement, 2MB per value, 50 queries per invocation on the free plan.
- [D1 free tier enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/). Daily row read and write limits now fail queries.
- `src/db/schemaUpgrade.ts` for the record upgrade the import path keeps.
- `tests/workoutSessionStatus.spec.ts` for the direct IndexedDB seeding pattern that `tests/rowsMigration.spec.ts` follows.
- The poteto-mode plugin files were not installed on the planning VM. The skeleton and principles came from the public port `Aqua-123/pstack-for-codex`, and the plan was checked with its `check-plan.mjs`. Owners read the installed originals at program start.
- pr-sync gets the `swarm` skill for its ten lanes and the `show-me-your-work` trail because it deletes the old sync path. pr-rows gets the same trail because it migrates stored history.

## Appendix E. Data shapes and wire protocol

Phone stores after pr-rows. `exercises` and `programs` keep their shapes. `workoutSessions` holds headers. `sets` is new.

```ts
export const ROW_TABLES = ['exercises', 'programs', 'sessions', 'sets'] as const
export type RowTable = (typeof ROW_TABLES)[number]

export interface SessionHeader {
  id: string
  date: string
  programId: string
  location: string
  status: 'completed' | 'incomplete'
  notes?: string
  exercises: Array<ExerciseSnapshot>
  isDeleted: boolean
  updatedAt: string
}

export interface SetRow {
  id: string
  sessionId: string
  exerciseId: string
  position: number
  set: ExerciseSetExecution
  isDeleted: boolean
  updatedAt: string
}

export const legacySetId = (sessionId: string, exerciseId: string, position: number) =>
  `${sessionId}:${exerciseId}:${position}`
```

`ExerciseSnapshot` is today's `ExerciseExecution` without `sets`. The header's `exercises` array keeps the order and the per-session snapshot the workout screen already shows. The phone store name stays `workoutSessions`. The wire and D1 name is `sessions`.

Phone stores added in pr-sync.

```ts
interface OutboxEntry { key: `${RowTable}:${string}`; table: RowTable; id: string; seq: number }
interface MetaRecord { name: 'cursor' | 'seq'; value: number }
```

D1 tables in pr-d1. Every table has `user_id TEXT`, `id TEXT`, `rev INTEGER`, and `data TEXT` holding the row JSON, with primary key `(user_id, id)`. `sessions` adds `date TEXT`. `sets` adds `session_id TEXT` and `exercise_id TEXT`.

Wire protocol.

```text
POST /api/push        { rows: [{ table, row }] }          -> 200 { revision } | 400 invalid_row | 409 import_required
GET  /api/pull?cursor=<n>&limit=<n>                       -> 200 { rows: [{ table, rev, row }], cursor, more }
POST /api/import-r2                                       -> 200 { counts, revision } | 409 already_imported
GET  /api/export                                          -> 200 ExportData version 4, as an attachment
POST /mcp             JSON-RPC 2.0                        -> 200 JSON-RPC result, every tool result carries revision
```
