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

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. No owner merges. The root appends each verified PR to one linear stack. The operator lands the stack. The program pauses after pr-d1 for the production import, as the goal text states. pr-rows and pr-sync are review-gated and stop at merge-ready for the operator's review in chat.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] On the operator's go, arm a `/goal` with this exact text. "Run `.cursor/plans/row_sync.plan.md` from branch `cursor/row-sync-plan-90d0` under Autopilot-stack. Build pr-rows, pr-d1, pr-sync, pr-mcp in that order, each branched from the one below. Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. No owner merges. The operator lands the stack. Pause after pr-d1 is STACK-READY. The operator merges pr-rows and pr-d1, deploys the worker, runs `POST /api/import-r2`, confirms `GET /api/export` matches `latest.json`, then lands pr-sync. Do not mark pr-sync ready to land before the operator reports that the import answered 200 and the export matched. Done when all four PRs sit in one linear stack with a clean verdict at each head SHA, and pr-rows and pr-sync carry the operator's review approval."
- [ ] Read these at program start. Re-read them at every tick.
  - [ ] `git show origin/cursor/row-sync-plan-90d0:.cursor/plans/row_sync.plan.md`
  - [ ] `git show origin/main:CLAUDE.md`
  - [ ] `git show origin/main:AGENTS.md`
  - [ ] `git show origin/main:worker/AGENTS.md`
  - [ ] `git show origin/main:.cursorrules`
  - [ ] The installed pstack files under `~/.cursor/plugins/cache/cursor-public/9717366/ecc249f1e306fc64ddf83c7bed16cacf7c2239db/skills/`. Read `poteto-mode/playbooks/autopilot-stack.md`, `poteto-mode/playbooks/autopilot-full.md`, `poteto-mode/playbooks/shipping.md`, `poteto-mode/playbooks/opening-a-pr.md`, `poteto-mode/playbooks/babysit.md`, `swarm/SKILL.md`, `no-comments/SKILL.md`, and `show-me-your-work/SKILL.md`. This repo has no `pstack/` directory, so they are not on trunk.
- [ ] Arm the 30-minute audit tick. This root runs in the cloud, so use the cloud-sleeper wake chain. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk and the armed /goal. Audit the operation against both and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full Autopilot-stack lifecycle. Build, open the PR ready, self-prove, triage Bugbot, deslop, no-comments, babysit to green, report code-ready and then STACK-READY with the head SHA.
- [ ] Follow this dependency graph. Each PR is based on the branch of the PR below it. A child owner starts only after its parent reports STACK-READY and the root's verdict is clean.
  - [ ] pr-rows is first. It branches from `main` as `cursor/row-sync-rows-<suffix>`.
  - [ ] pr-d1 after pr-rows. It branches from the pr-rows branch as `cursor/row-sync-d1-<suffix>`.
  - [ ] pr-sync after pr-d1. It branches from the pr-d1 branch as `cursor/row-sync-sync-<suffix>`.
  - [ ] pr-mcp after pr-sync. It branches from the pr-sync branch as `cursor/row-sync-mcp-<suffix>`.
- [ ] Hold the file boundaries.
  - [ ] pr-rows touches only `src/**`, `tests/**`, and `data-backup/**` fixtures. It does not touch `worker/**`.
  - [ ] pr-d1 touches only `worker/**`, plus read-only imports of `src/sync/rows.ts`. It does not touch any page under `src/pages/**`.
  - [ ] pr-sync touches `src/**`, `tests/**`, `settings/index.html`, and deletes the snapshot routes in `worker/src/**`.
  - [ ] pr-mcp touches only `worker/**`.
- [ ] Hold the review gate. pr-rows and pr-sync change the gym UI. They wait for the operator's review in chat with screenshots and a video before they count as ready to land.
- [ ] Hold the banned list in every owner brief. No React or other frontend framework. No sync library. No CRDT. No service worker. No OAuth. No D1 query from the phone. No MCP work before pr-sync is STACK-READY.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`. If `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, with `origin pr create --status open --base <parent-branch>` or `gh pr create --base <parent-branch>`. Only pr-rows targets `main`.
- [ ] Author every commit as `Ilias Trichopoulos <hlias.nop@gmail.com>` for both author and committer. Strip any `Co-authored-by` trailer a hook injects before pushing.
- [ ] Run `vp check` and `vp test run` once before the PR-facing push. For worker changes also run `cd worker && vp exec tsc --noEmit && vp run test`. Push with hooks on. The pre-commit hook failed to load `vite.config.ts` on the planning VM. pr-rows fixes that first if it still fails.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`. Fix, dismiss with a concrete reason, or ask.
- [ ] Rebase onto the current parent branch before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with the parent, or on a CI failure that comes from a change on the parent.

### Verdict and merge, for every PR

- [ ] At the code-ready head SHA and at each later push that changes the patch, run the swarm per `swarm/SKILL.md` with workers on `grok-4.7-xhigh-fast`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two audit lanes that read the diff and the receipts and distrust the PR body. One audits data loss, every path where a local or server row could be dropped or overwritten. One audits scope, the banned list and the file boundaries. The root audits the receipts in the STACK-READY report before the verdict.
- [ ] Clean only when every lane is `PASS`. Findings go back to the owner, including a defect that a lane filed as a note. A new head gets a fresh swarm and a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] Nobody merges. A clean verdict appends the PR to the one linear stack. The root is the only topology writer. It rebases the child onto the exact parent tip, pushes with `--force-with-lease` after an `ls-remote` check, and sets the PR base to the parent branch. After any rebase, apply the patch-id rule from `playbooks/shipping.md` at each verdict SHA and re-run the swarm for any PR whose patch moved.

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive the browser through `control-ui` from `cursor-team-kit` when it is installed. It was not installed on the planning VM, so the fallback is the computerUse subagent or a headed Playwright script. Drive the worker with `curl` and MCP with a real MCP client.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Run `vp install` and `cd worker && vp install`. For lanes that talk to the worker, run `vp exec wrangler d1 migrations apply jimbro --local`, then `vp exec wrangler dev --local --port 8787` in a tmux session. Wait for `Ready on http://localhost:8787`. Seed local R2 with `vp exec wrangler r2 object put jimbro-backups/users/nikos/latest.json --local --file worker/test/fixtures/latest-v4.json`.
- [ ] Start the app with `vp dev --host` in a tmux session. Wait for `http://localhost:5173` to answer. For sync lanes point the app at `http://localhost:8787` through the `VITE_API_BASE` env var that pr-sync adds.
- [ ] Deliver browser input only through the control skill or its fallback. Deliver worker input only through `curl` with `Authorization: Bearer <token>`. Deliver MCP input only through `vp dlx @modelcontextprotocol/inspector --cli`. Read-only diagnostics are the IndexedDB panel, `localStorage`, `wrangler d1 execute jimbro --local --command`, and the `wrangler dev` log.
- [ ] Save every screenshot or response log to `/tmp/swarm-<pr-id>/worker-<n>/<slug>` and return the paths with the report.

## Split local sessions into headers and set rows (pr-rows)

**Depends on.** None. It branches from `main`.

**Files.**

- [ ] Create `src/sync/rows.ts`. It imports types only from `src/db/exerciseLogging.ts` and `src/db/muscleGroups.ts`, never from `src/db/storage.ts` or `src/db/stores/**`, so the worker can import it without DOM types.
- [ ] Create `src/db/stores/setsStore.ts`.
- [ ] Edit `src/db/constants.ts`, `src/db/migrations.ts`, `src/db/storage.ts`, `src/db/stores/workoutSessionsStore.ts`, `src/db/stores/exercisesStore.ts`, `src/db/stores/programsStore.ts`, `src/db/export.ts`, `src/db/import.ts`, and `src/state/GymtimeSessionState.ts`.
- [ ] Edit `tests/workoutSessionStatus.spec.ts` so its direct IndexedDB writes use the header and set row shapes.
- [ ] Create `tests/rows.unit.test.ts`, `tests/rowsMigration.spec.ts`, and `tests/perf/rows.perf.ts`.

**Build.**

- [ ] Define `ExerciseRow`, `ProgramRow`, `SessionHeader`, `SetRow`, `RowTable`, and `legacySetId` in `src/sync/rows.ts` exactly as Appendix E states. `Exercise` and `Program` in the stores become aliases of `ExerciseRow` and `ProgramRow`.
- [ ] Add pure `rowsFromSession`, `sessionFromRows`, `rowsFromExport`, `exportFromRows`, and `rowsEqual` to `src/sync/rows.ts`. `rowsFromSession` gives each legacy set the id from `legacySetId` and the session's `updatedAt`, so the phone and the worker build byte-identical rows from the same session. `sessionFromRows` drops tombstoned sets and orders live sets by `position`. `rowsEqual` compares rows by canonical JSON with sorted keys.
- [ ] Add IndexedDB migration version 7 in `src/db/migrations.ts`. It creates the `sets` store with key `id` and indexes `sessionId` and `exerciseId`. It walks `workoutSessions`, calls `rowsFromSession` on each, writes the set rows, and replaces each session with its header. `createCurrentObjectStores` gains the `sets` store for fresh databases.
- [ ] Add `Storage.writeRows(writes)` in `src/db/storage.ts`. It writes any mix of rows across stores in one `readwrite` transaction. Every app write of a row goes through it. pr-sync adds the outbox inside this one function.
- [ ] Rewrite `WorkoutSessionsStore` in `src/db/stores/workoutSessionsStore.ts` over headers plus `setsStore`. Keep every public method name and its `WorkoutSession` return type so pages do not change. `addExerciseExecutionSetToWorkoutSession` writes one new set row with `crypto.randomUUID()` and `position` equal to the live set count. `updateExerciseExecutionSetInWorkoutSession` rewrites the row at that position and keeps its id. Removing or swapping an exercise tombstones its set rows. `deleteWorkoutSession` sets `isDeleted` on the header and its sets instead of deleting them.
- [ ] Filter tombstoned headers in every read path of `WorkoutSessionsStore`, including the date-index cursors.
- [ ] Make `buildExportData` in `src/db/export.ts` read all four stores unfiltered and call `exportFromRows`, so the file keeps the version 4 shape. Leave tombstoned sessions out of the file so it matches today's content.
- [ ] Make `importIndexedDbFromJson` in `src/db/import.ts` call `rowsFromExport` and write through `writeRows`. Keep it insert-if-missing. A row whose id already exists locally is never overwritten by a file import. Keep the version 1 path.
- [ ] Keep the cloud upload on workout completion in `src/pages/gymtime/ExerciseCard.ts` working. It still sends `buildExportData()` to `PUT /api/snapshot` and still stores `jimbro.cloudBackup.lastDate` only after a 200.

**You see.**

- [ ] The IndexedDB panel on `/gymtime/` shows a `sets` store and headers in `workoutSessions` with no `sets` arrays inside `exercises`.
- [ ] Logging a set on `/gymtime/` with the network off adds one row in `sets` and the set appears on the card.
- [ ] Settings export downloads a file equal to the pre-migration export of the same database.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/rows.unit.test.ts` gains a round-trip case. `exportFromRows(rowsFromExport(x))` deep-equals `x` for the upgraded `data-backup/gymbro-export-2026-01-02.json`, with literal counts of 106 sessions and 2581 sets. Run `vp test run tests/rows.unit.test.ts`.
- [ ] `tests/rows.unit.test.ts` gains a `legacySetId` case with a literal expected id string, a tombstone case where `sessionFromRows` drops a deleted set, and a `rowsEqual` case where key order differs and the result is true.
- [ ] `tests/rowsMigration.spec.ts` opens a version 6 database with three old-shape sessions, loads `/workouts/`, and asserts literal header and set row counts, one assembled session's sets, and that every migrated set row equals `rowsFromSession` of its source session. It also imports a file over an existing row with different contents and asserts the local row is unchanged. Run `vp exec playwright test tests/rowsMigration.spec.ts --project=chromium`.
- [ ] The full suites pass. Run `vp check`, `vp test run`, and `vp exec playwright test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe. Lanes 2 and 3 start from a `main`-built database holding the imported January fixture, then load the head build.

- [ ] Lane 1. Regression lane against trunk. At `main` and at the head, import the January fixture, open `/workouts/`, open the newest session on `/gymtime/`, go offline, and log one set. Save `rows-regression.png`. Pass when both builds show the same week list, the same historic set values, and the new set rendered while offline.
- [ ] Lane 2. Load the head build over a `main` database with the fixture and open the IndexedDB panel. Save `rows-idb.png`. Pass when `sets` holds 2581 rows and no header in `workoutSessions` has a `sets` field.
- [ ] Lane 3. After lane 2, open one historic session on `/gymtime/?id=<id>`. Save `rows-historic-session.png`. Pass when every card shows the same set values as the `main` screenshot.
- [ ] Lane 4. Start a new session from `/workouts/`, go offline in devtools, log three sets. Save `rows-offline-log.png`. Pass when the three sets render and `sets` gains three rows with random UUID ids.
- [ ] Lane 5. Edit the second logged set through the edit dialog. Save `rows-edit-set.png`. Pass when the card shows the new value and the row at position 1 changed while its id stayed the same.
- [ ] Lane 6. Add an exercise, log a set on it, then remove it. Save `rows-remove-exercise.png`. Pass when the card is gone and its set row has `isDeleted` true.
- [ ] Lane 7. Swap an exercise that has logged sets. Save `rows-swap.png`. Pass when the new exercise shows zero sets and the old sets are tombstoned.
- [ ] Lane 8. Delete a session from the gymtime page. Save `rows-delete-session.png`. Pass when it disappears from `/workouts/` and its header and sets remain with `isDeleted` true.
- [ ] Lane 9. Complete every set of a session with cloud credentials pointing at `wrangler dev --local` of the head. Save `rows-complete-upload.png`. Pass when the confetti shows, the toast reads `Backup saved`, local R2 `latest.json` holds the new session in the version 4 shape, and `jimbro.cloudBackup.lastDate` is later than that file's `exportDate`.
- [ ] Lane 10. Export from Settings, wipe the database, import that file, then import it again. Save `rows-export-import.png`. Pass when `/workouts/` and `/stats/` match their screenshots from before the wipe and the second import changes no row.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time from page load to rendered content on `/workouts/`, `/stats/`, and `/gymtime/?id=<latest>`, plus time from tapping set done to the set rendering. Both `main` and the head produce each metric on the same database, the January fixture copied four times for about 10,000 sets.
- [ ] Probe. `tests/perf/rows.perf.ts` reads `performance.now()` marks around each step on the chromium project. Run it at `main` and at the head, interleaved, five runs each.
- [ ] Baseline. Record the `main` medians first.
- [ ] Rule. Fail when any head median exceeds its `main` median by more than 25 percent and more than 50ms at once.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 3, 4, 6, and 8 screenshots into `/opt/cursor/artifacts/pr-rows-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of offline logging, editing, and removing an exercise on a lane VM. Save it as `/opt/cursor/artifacts/pr-rows-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's approval.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `main` after the verdict, patch-id unchanged.
- [ ] The root appends pr-rows to the stack as its base link. The operator merges it at the post-pr-d1 pause.

## Add D1, push, pull, and the one-time R2 import to the worker (pr-d1)

**Depends on.** pr-rows. It imports `src/sync/rows.ts`.

**Files.**

- [ ] Create `worker/migrations/0001_rows.sql`.
- [ ] Create `worker/src/rows.ts`.
- [ ] Edit `worker/src/index.ts`, `worker/wrangler.jsonc`, `worker/worker-configuration.d.ts`, `worker/vitest.config.mts`, and `worker/tsconfig.json` if the shared import needs an include.
- [ ] Create `worker/test/sync.spec.ts`, `worker/test/apply-migrations.ts`, and `worker/test/sync.perf.spec.ts`.
- [ ] Create `worker/test/fixtures/latest-v4.json` by importing `data-backup/gymbro-export-2026-01-02.json` into a `main` build and exporting it from Settings. The January file is version 1 with no session ids, and the import route accepts only version 4.

**Build.**

- [ ] Write the four tables of Appendix E in `worker/migrations/0001_rows.sql`. Each has primary key `(user_id, id)`, a `rev` integer, and a `data` JSON text column. Add `(user_id, rev)` indexes on all four, `(user_id, session_id)` and `(user_id, exercise_id)` on `sets`, and `(user_id, date)` on `sessions`.
- [ ] Bind D1 as `DB` to database `jimbro` in `worker/wrangler.jsonc`. Run `vp exec wrangler types`.
  - [ ] Ask the operator to run `wrangler d1 create jimbro` and paste the `database_id`. Creating a production resource belongs to the operator. Local tests and lanes use any placeholder id until then.
- [ ] Add `upsertRows(db, userId, table, rows)` in `worker/src/rows.ts`. It issues one `INSERT ... SELECT FROM json_each(?2) ON CONFLICT DO UPDATE` statement per table per chunk of at most 1000 rows. Each row's `rev` is the user's current maximum across all four tables plus its array index plus one. All statements of one request go in one `db.batch`, so revisions are unique and a request is atomic.
- [ ] Add `POST /api/import-r2` in `worker/src/index.ts`. It reads `users/<userId>/latest.json` from `BACKUP_BUCKET`, requires export version 4 and an id on every session, calls `rowsFromExport`, and writes through `upsertRows`. After the batch succeeds it writes the marker `users/<userId>/import.json` holding `{ exportDate, importedAt, counts }`. It answers 409 `already_imported` when the marker exists. A crash before the marker leaves rows that a re-run upserts to the same ids and contents.
- [ ] Add `POST /api/push` in `worker/src/index.ts`. The body is `{ rows: Array<{ table, row }> }` with at most 1000 rows. It parses every row at the boundary against the Appendix E shapes and answers 400 `invalid_row` with the offending index on failure. It answers 409 `import_required` while `latest.json` exists and `import.json` does not. It answers `{ revision }` with the new maximum.
- [ ] Add `GET /api/pull?cursor=<n>&limit=<n>` in `worker/src/index.ts`. It unions the four tables with `rev > cursor`, orders by `rev`, caps `limit` at 1000, and answers `{ rows, cursor, more }` where `cursor` is the last returned `rev`. When `cursor` is 0 it also answers `importedExportDate`, the `exportDate` from `import.json`, or null when no marker exists. It answers 409 `import_required` under the same rule as push.
- [ ] Add `GET /api/export` in `worker/src/index.ts`. It reads all four tables and returns `exportFromRows` as a download with `Content-Disposition: attachment`.
- [ ] Allow `POST` in the CORS methods list.
- [ ] Keep `PUT /api/snapshot` and `GET /api/snapshot/latest` unchanged. The phone still uses them until pr-sync lands.
- [ ] Apply D1 migrations in worker tests through `readD1Migrations` in `worker/vitest.config.mts` and `applyD1Migrations` in `worker/test/apply-migrations.ts`.

**You see.**

- [ ] `curl -X POST localhost:8787/api/import-r2` against the seeded local R2 answers 200 with literal counts of 21 exercises, 3 programs, 106 sessions, and 2581 sets.
- [ ] `curl localhost:8787/api/export` returns a file that deep-equals the seeded `latest.json` after both are sorted by id.
- [ ] `curl "localhost:8787/api/pull?cursor=0&limit=1000"` answers 1000 rows, `more` true, and `importedExportDate` equal to the fixture's `exportDate`.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `worker/test/sync.spec.ts` gains cases for push then pull returning literal revisions 1 to 3, a repeated push of the same id keeping one row and moving it to revision 4, pull paging with `more`, `importedExportDate` present only at cursor 0, 409 `import_required` on push and pull, 409 `already_imported`, 400 `invalid_row`, and 401 on every new route without a token. Run `cd worker && vp run test`.
- [ ] `worker/test/sync.spec.ts` gains an import case that seeds R2 with `worker/test/fixtures/latest-v4.json` and asserts `GET /api/export` deep-equals it, plus a case where the marker write is skipped and a re-run leaves identical rows.
- [ ] Worker typecheck passes with the shared import. Run `cd worker && vp exec tsc --noEmit`.
- [ ] The client suites still pass. Run `vp check` and `vp test run`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe. The surface is the worker over HTTP on `wrangler dev --local`, so each lane saves a response log.

- [ ] Lane 1. Regression lane against trunk. At `main` and at the head, `PUT /api/snapshot` the fixture and `GET /api/snapshot/latest`. `main` has no D1, so also gate the head-only end state of `POST /api/import-r2` followed by `GET /api/export`. Save `d1-regression.log`. Pass when both builds answer the snapshot routes identically and the head export deep-equals the fixture.
- [ ] Lane 2. Call `POST /api/import-r2` again. Save `d1-import-again.log`. Pass when it answers 409 `already_imported` and a D1 row count query is unchanged.
- [ ] Lane 3. Read `import.json` from local R2. Save `d1-marker.log`. Pass when its `exportDate` equals the fixture's and its counts are 21, 3, 106, and 2581.
- [ ] Lane 4. With R2 seeded and no import run, push one set and pull from 0. Save `d1-before-import.log`. Pass when both answer 409 `import_required` and D1 holds zero rows for that user.
- [ ] Lane 5. On a user with no R2 data, push one set. Save `d1-no-snapshot.log`. Pass when it answers 200 and a pull from 0 returns that row with `importedExportDate` null.
- [ ] Lane 6. Push the same set id twice with different weights. Save `d1-repeat-push.log`. Pass when D1 holds one row with the second weight and a higher revision.
- [ ] Lane 7. Pull from cursor 0 in pages of 1000 until `more` is false. Save `d1-full-pull.log`. Pass when the summed row count equals the four table counts and revisions strictly increase.
- [ ] Lane 8. Push a row with a missing `sessionId`. Save `d1-invalid.log`. Pass when it answers 400 `invalid_row` with index 0 and no row changed.
- [ ] Lane 9. Call every new route without a token and with a wrong token. Save `d1-auth.log`. Pass when each answers 401.
- [ ] Lane 10. Run the pr-rows app against this worker and complete a workout. Save `d1-old-upload.log`. Pass when `PUT /api/snapshot` still answers 200 and D1 is untouched.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time and D1 query count to hold the full history on the server, on the fixture copied four times. `main` produces it through `PUT /api/snapshot`. The head produces it through `POST /api/import-r2`. The diff-added work is a 1000-row push and a 1000-row pull page, which `main` lacks.
- [ ] Probe. `worker/test/sync.perf.spec.ts` times each call five times through a statement-counting `DB` wrapper. Run the snapshot PUT at `main` and the import, push, and pull at the head, interleaved.
- [ ] Baseline. Record the `main` snapshot PUT median first.
- [ ] Rule. The scenarios differ, so there is no ratio. Fail when any head request issues more than 20 D1 queries, which keeps it under the 50-query free-plan cap. Fail when the import median exceeds 10 seconds, a 1000-row push median exceeds 1 second, or a 1000-row pull page median exceeds 500ms locally.

**Review gate.** None. pr-d1 is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the pr-rows branch after the verdict, patch-id unchanged.
- [ ] The root appends pr-d1 on top of pr-rows and pauses the program. The operator merges pr-rows and pr-d1, deploys the worker, runs `POST /api/import-r2`, confirms `GET /api/export` matches `latest.json`, then lands pr-sync.

## Move the phone to the outbox and remove the snapshot upload (pr-sync)

**Depends on.** pr-d1.

**Files.**

- [ ] Create `src/sync/syncClient.ts` and `src/sync/bootstrap.ts`.
- [ ] Edit `src/db/constants.ts`, `src/db/migrations.ts`, `src/db/storage.ts`, `src/db/cloudBackup.ts`, `src/navigation.ts`, `src/pages/settings/CloudBackup.ts`, `src/pages/gymtime/ExerciseCard.ts`, `src/pages/workouts/index.ts`, and `settings/index.html`.
- [ ] Delete `worker/src/shrinkGuard.ts`, `worker/src/validate.ts`, the snapshot routes in `worker/src/index.ts`, and their cases in `worker/test/index.spec.ts`.
- [ ] Create `tests/bootstrap.unit.test.ts` and `tests/sync.spec.ts`.

**Build.**

- [ ] Add IndexedDB migration version 8 in `src/db/migrations.ts`. It creates `outbox` keyed by `table:id` and `meta` keyed by name, and writes `meta.cursor` as 0. It enqueues nothing. Historical rows reach the server only through the first sync below.
- [ ] Make `Storage.writeRows` put an outbox entry `{ table, id, seq }` for every row in the same transaction as the row. `seq` comes from a counter in `meta`.
- [ ] Add the pure `planBootstrap(local, pulled, isSnapshotWriter)` in `src/sync/bootstrap.ts`. It returns, per id, one of `keepServer`, `pushLocal`, or `same`, per the table in Appendix E. A local id the pull did not return is `pushLocal`. A local row that `rowsEqual` says differs from the pulled row is `pushLocal` when `isSnapshotWriter` is true and `keepServer` otherwise.
- [ ] Add the first sync to `src/sync/syncClient.ts`. It runs when `meta.cursor` is 0. It pulls from 0 until `more` is false before any push, holding pulled ids and rows in memory. It computes `isSnapshotWriter` as `jimbro.cloudBackup.lastDate >= importedExportDate`, false when either is missing. It writes `keepServer` rows over local rows, except ids with a pending outbox entry from a write made during the first sync, enqueues every `pushLocal` id, and writes `meta.cursor` in one final transaction. A crash before that transaction leaves `meta.cursor` at 0, so the next run starts over and converges. Then it pushes the outbox.
- [ ] Add the steady sync to `src/sync/syncClient.ts`. It runs at most once at a time. It pushes the outbox in chunks of 500. After a 200 it deletes each outbox entry only when its `seq` is unchanged, so an edit made during the request stays dirty. Then it pulls from `meta.cursor` until `more` is false. Each page writes its rows and the new cursor in one transaction. Pull writes overwrite an existing id, except an id with a pending outbox entry, whose newer local edit is pushed next.
- [ ] On 409 `import_required` from push or pull, stop the sync, keep the outbox and `meta.cursor`, and set Settings to say the cloud import has not been run.
- [ ] Call `sync()` from `src/navigation.ts` on page load, on the `online` event, on `visibilitychange` to visible, and two seconds after any `writeRows` call. It does nothing without credentials or while `navigator.onLine` is false.
- [ ] After a pull that changes the open session, re-assemble it through `GymtimeSessionState.initialize` so the workout screen reflects it.
- [ ] Delete `uploadToCloud`, `restoreFromCloud`, and `storeLastBackupDate` from `src/db/cloudBackup.ts`. Keep `getLastBackupDate`, which the first sync reads. Read `API_BASE` from `import.meta.env.VITE_API_BASE` with the production URL as default.
- [ ] Remove the completion upload from `src/pages/gymtime/ExerciseCard.ts`. Keep the local file download when no credentials exist.
- [ ] Replace the Backup and Restore buttons in `src/pages/settings/CloudBackup.ts` with a Sync now button and a status line. It shows the pending outbox count and the last sync time, or `Cloud import has not been run yet` after a 409 `import_required`. Keep the credentials form as the sign-in.
- [ ] Hide the Seed Database button in `src/pages/workouts/index.ts` while credentials exist and `meta.cursor` is 0. Show a Restore from cloud button that runs `sync()` instead.
- [ ] Delete `PUT /api/snapshot`, `GET /api/snapshot/latest`, `shrinkGuard.ts`, and `validate.ts` from the worker. Keep the R2 binding for `POST /api/import-r2` and the `import.json` marker, and leave the stored R2 objects untouched.

**You see.**

- [ ] Completing a workout sends only `POST /api/push` and `GET /api/pull` requests in the network panel, and no request body exceeds 200KB.
- [ ] The first sync on a browser whose local rows equal the import pushes nothing. The network panel shows pull requests and no push.
- [ ] Settings shows `0 pending` and a last sync time after a sync, and `Cloud import has not been run yet` against a worker with no import.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `tests/bootstrap.unit.test.ts` covers every row of the Appendix E decision table with literal expected actions. A local-only id is `pushLocal`. An equal row is `same`. A differing row is `pushLocal` for the snapshot writer and `keepServer` for any other browser. Run `vp test run tests/bootstrap.unit.test.ts`.
- [ ] `tests/sync.spec.ts` runs against `wrangler dev --local` with the fixture imported. It gains these cases. Run `vp exec playwright test tests/sync.spec.ts --project=chromium`.
  - [ ] Wipe and restore. Sync, delete the database, reload, sync, and assert the Settings export deep-equals `GET /api/export`.
  - [ ] Writer edit. Set `jimbro.cloudBackup.lastDate` after the fixture `exportDate`, change one set locally, run the first sync, and assert D1 holds the local weight.
  - [ ] Other browser. Set `lastDate` before the fixture `exportDate`, change the same set locally, run the first sync, and assert the local row now holds the server weight and nothing was pushed for it.
  - [ ] Local-only rows. Log a set that is not in the fixture, run the first sync, and assert D1 holds it.
  - [ ] No cloud snapshot. Against a user with no R2 data, run the first sync and assert every local row reaches D1.
  - [ ] Crash. Abort the first sync after its first pull page, reload, and assert the rerun ends with the same D1 and local state as an uninterrupted run.
  - [ ] Offline. Log three sets offline, assert the outbox holds three entries, go online, and assert the outbox is empty and D1 holds the rows.
  - [ ] In-flight edit. Change a set during a slow push and assert it stays in the outbox with the new value.
  - [ ] Import gate. Against a worker with R2 data and no import, assert Settings shows `Cloud import has not been run yet` and the outbox keeps its entries.
- [ ] `worker/test/index.spec.ts` no longer references snapshot routes and `worker/test/sync.spec.ts` still passes. Run `cd worker && vp run test`.
- [ ] The full suites pass. Run `vp check`, `vp test run`, and `vp exec playwright test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe. Lanes use `wrangler dev --local` with the fixture imported through `POST /api/import-r2`, except lane 10.

- [ ] Lane 1. Regression lane against trunk. At the pr-d1 head and at this head, complete one workout signed in. The old build lands it in R2 through `PUT /api/snapshot`. This build lands it in D1 through `POST /api/push`. Save `sync-regression.png`. Pass when the old build shows `Backup saved`, this build reaches `0 pending`, and `GET /api/export` at this head contains the workout.
- [ ] Lane 2. Load the head build over a pr-d1 database equal to the fixture, with `lastDate` after the fixture `exportDate`. Save `sync-first-sync-same.png`. Pass when the first sync makes pull requests and zero push requests and Settings shows `0 pending`.
- [ ] Lane 3. Repeat lane 2 after editing one historic set in the pr-d1 build and uploading it, so `lastDate` is after the import. Save `sync-first-sync-writer.png`. Pass when the first sync pushes exactly that set and D1 holds the edited value.
- [ ] Lane 4. Repeat lane 3 on a second browser profile with the same edit made locally and no `lastDate`. Save `sync-first-sync-other.png`. Pass when the first sync pushes nothing for that set and the local set shows the server value.
- [ ] Lane 5. Go offline, log three sets, then go online. Save `sync-offline-drain.png`. Pass when Settings shows `3 pending` offline and `0 pending` within five seconds online, and D1 holds the three rows.
- [ ] Lane 6. Delete the database while online, reload, open `/workouts/`, tap Restore from cloud. Save `sync-restored.png`. Pass when Seed Database was hidden, and `/workouts/` and `/stats/` match their screenshots from before the wipe.
- [ ] Lane 7. Clear all site data while offline, reload. Save `sync-wipe-offline.png`. Pass when the app shows an empty database and makes no network request.
- [ ] Lane 8. Go online after lane 7, sign in on Settings, open `/workouts/`, tap Restore from cloud. Save `sync-offline-wipe-restored.png`. Pass when every pushed session returns and the sets logged offline after the last push are absent.
- [ ] Lane 9. Edit a pushed set on device A and sync, then sync device B. Save `sync-second-device.png`. Pass when device B shows the edited value.
- [ ] Lane 10. Seed R2 without running the import, sign in, and log a set. Save `sync-import-required.png`. Pass when Settings shows `Cloud import has not been run yet`, the set renders, and the outbox keeps it.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Bytes uploaded per completed workout and time from tapping set done to the set rendering. Both the pr-d1 head and this head produce both metrics for the same workout. The diff-added work is the first sync and a full restore from cursor 0, which the pr-d1 head lacks.
- [ ] Probe. Extend `tests/perf/rows.perf.ts` to sum request body sizes for one completed workout, time set done, and time the first sync and a full restore on the fixture copied four times. Run it at the pr-d1 head and at this head, interleaved, five runs each.
- [ ] Baseline. Record the pr-d1 head bytes per completed workout and the set-done median first.
- [ ] Rule. Fail when bytes per completed workout exceed 5 percent of the baseline, or when the set-done median exceeds the baseline by more than 25 percent and more than 50ms at once. Fail when the first sync or a full restore takes longer than 15 seconds locally.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 3, 5, 6, and 10 screenshots into `/opt/cursor/artifacts/pr-sync-review-<slug>.png`.
- [ ] Record a 30 to 60 second video of offline logging, the outbox draining, a wipe, and the restore on a lane VM. Save it as `/opt/cursor/artifacts/pr-sync-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's approval.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current `main` after pr-rows and pr-d1 land, patch-id unchanged.
- [ ] The root appends pr-sync on top of pr-d1. The operator lands it only after the production import answered 200 and `GET /api/export` matched `latest.json`.

## Add the read-only MCP route to the worker (pr-mcp)

**Depends on.** pr-sync.

**Files.**

- [ ] Create `worker/src/mcp.ts`.
- [ ] Edit `worker/src/index.ts`.
- [ ] Create `worker/test/mcp.spec.ts` and `worker/test/mcp.perf.spec.ts`.

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

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-xhigh-fast` at the PR head, per the boot recipe. The surface is a real MCP client against `wrangler dev --local` with the fixture imported, so each lane saves a response log.

- [ ] Lane 1. Regression lane against trunk. Call `POST /mcp` with `tools/list` and pull from 0 at the pr-sync head and at this head. The pr-sync head has no MCP route, so record its 404 and gate the four listed tools plus an unchanged pull. Save `mcp-regression.log`. Pass when the pr-sync head answers 404, this head lists exactly the four tools, and both pulls return identical rows.
- [ ] Lane 2. Call `recent_sessions` with no arguments. Save `mcp-recent.log`. Pass when it returns 10 sessions in date order, newest `2026-01-02`.
- [ ] Lane 3. Call `get_session` for the `2026-01-02` session. Save `mcp-session.log`. Pass when its sets match that session in the fixture.
- [ ] Lane 4. Call `exercise_history` for one fixture exercise. Save `mcp-history.log`. Pass when the sets match that exercise across fixture sessions, newest first.
- [ ] Lane 5. Call `catalog`. Save `mcp-catalog.log`. Pass when it returns the fixture's non-deleted exercises and 3 programs.
- [ ] Lane 6. Push a new set through `/api/push`, then call `get_session`. Save `mcp-revision.log`. Pass when the set appears and `revision` rose by one.
- [ ] Lane 7. Tombstone a session through `/api/push`, then call `recent_sessions`. Save `mcp-tombstone.log`. Pass when that session is absent.
- [ ] Lane 8. Call the route with no token and with a wrong token. Save `mcp-auth.log`. Pass when both answer 401.
- [ ] Lane 9. Send `GET /mcp` and a `tools/call` for an unknown tool. Save `mcp-errors.log`. Pass when the first answers 405 and the second returns a JSON-RPC error.
- [ ] Lane 10. Add the local route to a Cursor MCP config with the bearer header and ask for the last three workouts. Save `mcp-agent.png`. Pass when the agent answers from `recent_sessions` and D1 row counts are unchanged.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time and D1 query count per tool call, and the response size of `recent_sessions` at its default limit, on the fixture copied four times. The pr-sync head has no MCP route. Its comparable read, `GET /api/export`, is recorded as context only.
- [ ] Probe. `worker/test/mcp.perf.spec.ts` times each tool five times through a statement-counting `DB` wrapper at this head, interleaved with `GET /api/export` at the pr-sync head.
- [ ] Baseline. Record the pr-sync head `GET /api/export` median first.
- [ ] Rule. The scenarios differ, so there is no ratio. Fail when any tool issues more than three queries, when any tool median exceeds 200ms locally, or when `recent_sessions` at the default limit exceeds 64KB.

**Review gate.** None. pr-mcp is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto the pr-sync branch after the verdict, patch-id unchanged.
- [ ] The root appends pr-mcp as the tip of the stack. The operator lands it and deploys the worker.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the Autopilot-stack report. Links to the stack root and tip, a one-line verdict per link, the review media for pr-rows and pr-sync, and anything parked with its reason.

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
- The real `latest.json` was not read. Its version and whether every session carries an id are inferred from `CURRENT_EXPORT_VERSION = 4` in `src/db/export.ts`. pr-d1 lane 1 runs on the fixture. The operator's production import is the first run on the real file.
- The snapshot-writer rule was not prototyped. It is inferred from `src/db/cloudBackup.ts`, where `storeLastBackupDate` runs only after a 200 and `buildExportData` sets `exportDate` before the upload. So the uploading browser's `lastDate` is later than or equal to the snapshot's `exportDate` on its own clock. pr-sync lanes 3 and 4 prove it.

## Appendix B. Alternatives rejected

- Seeding the outbox with every historical row. The first sync from any browser would overwrite server rows with that browser's copy, including a stale browser that never uploaded. Pulling first and pushing only local-only ids, plus the snapshot writer's edits, keeps the imported history as the default truth.
- Trusting a differing local row on every browser. Only the browser that wrote `latest.json` can know a difference is an unuploaded edit. On any other browser a difference means the local copy is older.
- Random UUIDs for migrated sets. The phone migration and the server import would give the same historic set two different ids. The first sync would duplicate every historic set. `legacySetId` makes both sides compute the same id.
- A fifth D1 table for a revision counter or an import marker. The operator fixed four tables. The maximum `rev` across the four tables inside one batch gives unique revisions because a D1 database runs one query at a time. The import marker lives in R2 next to `latest.json`.
- Gating push on zero D1 rows instead of the marker. A crash between the import batch and the marker would open the gate on a half-imported user. The marker is written last.
- One revision per push request. Pull pages by `rev` would split a large push across pages at the same `rev` and lose rows. Per-row revisions page safely.
- Adding the outbox in pr-rows. It would make pr-rows do sync work the operator scoped to pr-sync. Routing every write through `Storage.writeRows` in pr-rows gives pr-sync one place to add it.
- Hard deletes for sessions and removed sets. A pull cannot carry a row that no longer exists, so a delete on one device would never reach another or survive a restore. Tombstones via `isDeleted` travel like any other row.
- Server-side last-writer-wins by `updatedAt`. The operator fixed "a repeated push of the same id updates that row". Phone clocks drift, and one person logs from one phone, so arrival order is enough.
- The MCP TypeScript SDK or the Cloudflare Agents SDK. Four stateless read tools need `initialize`, `tools/list`, and `tools/call`. The Agents SDK needs a Durable Object. Hand-rolled JSON-RPC keeps the worker dependency-free, and lane 10 proves a real client accepts it.
- Running the R2 import from a script with `wrangler d1 execute`. It needs a second copy of the fold logic outside the worker. An authenticated worker route reuses `rowsFromExport`.

## Appendix C. Risks

- A browser that edits after the import and never uploads again, with `lastDate` before the import, loses that edit to the server row on its first sync. The operator accepted server-wins for every browser except the snapshot writer. pr-sync lane 4 shows the behavior.
- The snapshot writer's first sync overwrites any edit another browser pushed after the import. Only one browser logs workouts, so this needs two active browsers in the window between the import and the writer's first sync.
- `rowsEqual` must see identical rows for an unchanged set on both sides. A drift between the phone migration and `rowsFromExport` would mark every row as differing, and the writer would push its whole history. pr-rows asserts migrated rows equal `rowsFromSession`, and pr-sync lane 2 asserts zero pushes on an unchanged browser.
- A wiped phone that taps Seed Database before the first pull would push seed catalog rows over the user's edited exercises. pr-sync hides the button while credentials exist and the cursor is 0.
- The first sync holds every pulled row in memory, about 10,000 rows for the fixture copied four times. pr-sync perf caps it at 15 seconds locally. Memory on an old phone stays unmeasured.
- Read paths now assemble sessions from about 10,000 set rows. `/stats/` and the exercise history chart read everything. pr-rows perf rule watches it.
- The shared `src/sync/rows.ts` must stay free of DOM imports or the worker typecheck fails. pr-d1 runs the worker `tsc` in its unit block.
- IndexedDB migration version 7 runs inside `onupgradeneeded`. A throw there leaves the user on version 6 with no app. `tests/rowsMigration.spec.ts` covers a real version 6 database in a real browser.
- Positions and array indexes. `updateSet(index)` addresses the set at that position among live sets. The app has no single-set delete today, so pr-rows keeps positions dense and tombstones only whole exercises or sessions.
- The pre-commit hook failed to load `vite.config.ts` on the planning VM with no change to that file. Owners must fix it rather than commit with `--no-verify`.
- `control-ui` from `cursor-team-kit` was not installed on the planning VM. Browser lanes fall back to the computerUse subagent or headed Playwright. If neither runs, the lane fails closed.

## Appendix D. Links and reading list

- `CLAUDE.md` and `.cursorrules` for the no-framework rule and the `vp` commands.
- `worker/AGENTS.md`. It requires reading current Cloudflare docs before any D1 change.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/). 100 bound parameters per query, 100KB per statement, 2MB per value, 50 queries per invocation on the free plan.
- [D1 free tier enforcement changelog](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/). Daily row read and write limits now fail queries.
- `src/db/cloudBackup.ts` for when `jimbro.cloudBackup.lastDate` is written.
- `src/db/schemaUpgrade.ts` for the record upgrade the import path keeps.
- `tests/workoutSessionStatus.spec.ts` for the direct IndexedDB seeding pattern that `tests/rowsMigration.spec.ts` follows.
- pr-sync gets `how/SKILL.md` before it builds the first sync and `interrogate/SKILL.md` on `src/sync/bootstrap.ts`, since that table decides which copy of history survives.
- pr-rows and pr-sync keep a committed decision trail per `show-me-your-work/SKILL.md`, because they migrate and move stored history. pr-d1 and pr-mcp keep theirs local.
- The first draft of this plan followed the public port `Aqua-123/pstack-for-codex`. This revision follows the installed plugin and passes its `check-plan.mjs`.

## Appendix E. Data shapes and wire protocol

Phone stores after pr-rows. `exercises` and `programs` hold `ExerciseRow` and `ProgramRow`, which keep today's `Exercise` and `Program` fields. `workoutSessions` holds headers. `sets` is new.

```ts
export const ROW_TABLES = ['exercises', 'programs', 'sessions', 'sets'] as const
export type RowTable = (typeof ROW_TABLES)[number]

export interface ExerciseRow {
  id: string
  name: string
  kind: ExerciseKind
  preset: LogPreset
  muscle?: MuscleGroup
  targetSets: number
  defaults: ExerciseDefaults
  isDeleted: boolean
  updatedAt: string
}

export interface ProgramRow {
  id: string
  name: string
  exercises: Array<ExerciseRow['id']>
  isDeleted: boolean
  updatedAt: string
}

export type ExerciseSnapshot = Pick<ExerciseRow, 'name' | 'kind' | 'preset' | 'muscle' | 'targetSets' | 'defaults'> & {
  exerciseId: ExerciseRow['id']
}

export interface SessionHeader {
  id: string
  date: string
  programId: ProgramRow['id']
  location: string
  status: 'completed' | 'incomplete'
  notes?: string
  exercises: Array<ExerciseSnapshot>
  isDeleted: boolean
  updatedAt: string
}

export interface SetRow {
  id: string
  sessionId: SessionHeader['id']
  exerciseId: ExerciseRow['id']
  position: number
  set: ExerciseSetExecution
  isDeleted: boolean
  updatedAt: string
}

export type Row =
  | { table: 'exercises'; row: ExerciseRow }
  | { table: 'programs'; row: ProgramRow }
  | { table: 'sessions'; row: SessionHeader }
  | { table: 'sets'; row: SetRow }

export const legacySetId = (sessionId: string, exerciseId: string, position: number) =>
  `${sessionId}:${exerciseId}:${position}`
```

`ExerciseSnapshot` is today's `ExerciseExecution` without `sets`. The header's `exercises` array keeps the order and the per-session snapshot the workout screen already shows. The phone store name stays `workoutSessions`. The wire and D1 name is `sessions`. A legacy set row takes its session's `updatedAt`.

Phone stores added in pr-sync.

```ts
interface OutboxEntry { key: `${RowTable}:${string}`; table: RowTable; id: string; seq: number }
interface MetaRecord { name: 'cursor' | 'seq'; value: number }
```

First sync decision table in `src/sync/bootstrap.ts`. It runs only when `meta.cursor` is 0, after the pull finishes. `isSnapshotWriter` is `jimbro.cloudBackup.lastDate >= importedExportDate`, and false when either value is missing.

```text
local row   pulled row   rowsEqual   isSnapshotWriter   action
present     absent       n/a         any                pushLocal
present     present      true        any                same
present     present      false       true               pushLocal
present     present      false       false              keepServer
absent      present      n/a         any                keepServer
```

Import marker in R2 at `users/<userId>/import.json`, written by pr-d1 after the import batch succeeds.

```ts
interface ImportMarker { exportDate: string; importedAt: string; counts: Record<RowTable, number> }
```

D1 tables in pr-d1. Every table has `user_id TEXT`, `id TEXT`, `rev INTEGER`, and `data TEXT` holding the row JSON, with primary key `(user_id, id)`. `sessions` adds `date TEXT`. `sets` adds `session_id TEXT` and `exercise_id TEXT`.

Wire protocol.

```text
POST /api/push        { rows: Row[] }              -> 200 { revision } | 400 invalid_row | 409 import_required
GET  /api/pull?cursor=<n>&limit=<n>                -> 200 { rows: (Row & { rev })[], cursor, more, importedExportDate? } | 409 import_required
POST /api/import-r2                                -> 200 { counts, revision } | 409 already_imported
GET  /api/export                                   -> 200 ExportData version 4, as an attachment
POST /mcp             JSON-RPC 2.0                 -> 200 JSON-RPC result, every tool result carries revision
```

`import_required` means `latest.json` exists and `import.json` does not.
