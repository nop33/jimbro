---
name: verify-jimbro
description: Drive the Jimbro workout-tracking PWA in a real browser. Use when proving a UI change, checking a user flow, or capturing screenshots/ARIA of home, exercises, programs, workouts, gymtime, or settings.
---

# Verify Jimbro

Jimbro is a vanilla TypeScript PWA. Persistence is IndexedDB (`gymbro-database`) on the page origin. There is no login. Pages are full HTML loads, not an SPA.

This skill is for agents. Follow the feature map under `features/`. Do not invent selectors. Do not call product code or IndexedDB from the console as a substitute for the user path.

## Launch

Use a dedicated origin so verification does not share IndexedDB with a human's daily `vp dev` on port 5173.

From the repo root:

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro launch
```

That starts `vp run dev --host 127.0.0.1 --port 5174 --strictPort` (override with `JIMBRO_VERIFY_PORT`) and writes pid/url under `.cursor/skills/verify-jimbro/.run/`. Ready means `GET $JIMBRO_VERIFY_URL/` returns HTML whose `<title>` is `Jimbro`.

Two instances can run side by side on different ports. Different ports are different origins, so they do not share IndexedDB.

Do not drive `http://localhost:5173` unless `control-jimbro doctor` says that process is the one this run started. Driving the user's tab on 5173 mutates their workout data.

Teardown:

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro cleanup
```

Cleanup kills only the pid in `.run/pid`. It does not delete proof files under `.cursor/skills/verify-jimbro/artifacts/`.

## Doctor

Run this first whenever anything looks off, and after every failed drive:

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro doctor
```

Pass means: `.run/listener` is alive, that pid owns `$JIMBRO_VERIFY_PORT`, and `GET /` returns `<title>Jimbro</title>`. Fail means stop driving and relaunch.

Print the URL:

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro url
```

## Drive

Prefer Playwright through the helper. Each Playwright context gets an empty IndexedDB, which is the isolated data dir for this app.

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro drive home
.cursor/skills/verify-jimbro/scripts/control-jimbro snapshot / --out .cursor/skills/verify-jimbro/artifacts/scratch
```

`drive` and `snapshot` launch Chromium, hit `$JIMBRO_VERIFY_URL`, and write PNG + ARIA YAML. They do not reuse a human browser profile.

Cursor browser tools are allowed only against the verification URL from `control-jimbro url`. IndexedDB then persists in that browser profile. Before a mutating drive, reset via Settings as in `features/README.md`. If a human tab is already on that same verification origin, refuse and ask them to close it.

Existing Playwright specs in `tests/*.spec.ts` are the source of truth for locators. Match them. Stable handles used across pages:

| Control | Handle |
| --- | --- |
| Home heading | `getByRole('heading', { name: 'Hey, gymbro.' })` |
| Start workout | `getByRole('link', { name: 'Start workout' })` |
| Settings (home) | `getByRole('link', { name: 'Settings', exact: true })` |
| Bottom nav | `.nav-link` with href `/`, `/workouts/`, `/exercises/`, `/programs/`, `/stats/` |
| New (exercises/programs) | `getByRole('button', { name: 'New' })` |
| New workout | `getByRole('button', { name: 'New' })` (accessible name is `Add new workout`) |
| Close dialog | `getByRole('button', { name: 'Close dialog' })` |
| Seed Database | `getByRole('button', { name: 'Seed Database' })` (only when IndexedDB has no programs) |
| Reset Database | open `Manage local data`, then `getByRole('button', { name: 'Reset Database' })`, accept `window.confirm` |
| Toast | `.toast-message-popup` |

Native `<dialog>` for modals. Native `window.confirm` for delete and reset. `page.once('dialog', d => d.accept())` must be registered before the click.

Routes: `/`, `/exercises/`, `/programs/`, `/workouts/`, `/gymtime/?programId=<id>`, `/gymtime/?id=<session-id>`, `/settings/`, `/stats/`. Missing gymtime params show an error and a Back to workouts link.

## Evidence

Proof lives in `.cursor/skills/verify-jimbro/artifacts/<feature-id>/`. Cleanup must not touch that tree.

Standards:

- Exercise the real user path. Do not `indexedDB.deleteDatabase` or call `exercisesStore.seed()` from the console as the proof.
- Capture the action and the resulting state. A final screenshot without the click that produced it is incomplete.
- After a mutation, reopen the record from a list or another page. A toast alone is not persistence.
- Record the feature ID, URL, and entry point in `proof.txt` next to the PNG/ARIA files.
- UI proof is an ARIA snapshot plus a screenshot that shows the Jimbro heading or bottom nav.
- Side effects to check: IndexedDB rows visible after reload, downloaded `jimbro-export-*.json` for export, workout URL changing from `?programId=` to `?id=` after save.

Mocks: none for the PWA itself. Cloud Backup talks to an external worker. Do not enter real tokens. Skip cloud restore unless using disposable credentials the user provided.

## Cleanup

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro cleanup
```

Kills the pid this run started. Leaves `artifacts/` in place. After a failed iteration, run cleanup before the next launch so port 5174 is not stranded.

Do not `pkill -f vite` or kill by process name. That can take down the user's 5173 server.

Playwright contexts die with the Node process. Cursor browser tabs you opened should be closed, not left on `/settings/` with a reset in progress.

## Helpers

All commands are run from the repo root. The script is executable.

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro launch
.cursor/skills/verify-jimbro/scripts/control-jimbro doctor
.cursor/skills/verify-jimbro/scripts/control-jimbro url
.cursor/skills/verify-jimbro/scripts/control-jimbro snapshot /workouts/ --out .cursor/skills/verify-jimbro/artifacts/scratch
.cursor/skills/verify-jimbro/scripts/control-jimbro drive home
.cursor/skills/verify-jimbro/scripts/control-jimbro cleanup
```

`drive.mjs` is invoked by `control-jimbro`. Do not call it directly unless `JIMBRO_VERIFY_URL` is already exported.

Repo Playwright suite (`pnpm test` / `playwright test`) auto-starts `vp run dev` on 5173 and is a regression net, not this skill's isolated proof. Use it when you need the full spec file. Use this skill when you need a disposable origin, artifacts, and a user-path drive mid-task.

First machine: `vp exec playwright install chromium` so `drive` and `snapshot` can launch Chromium.
