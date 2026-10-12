---
name: verify-jimbro
description: Drive the Jimbro workout-tracking PWA in a real browser and screenshot every screen on an iPhone 13 and a Pixel 8 Pro. Use when proving a UI change, checking a user flow, or capturing screenshots/ARIA of home, workouts, gymtime, exercises, programs, stats, or settings.
---

# Verify Jimbro

Jimbro is a vanilla TypeScript PWA. This skill loads in Cursor from `.cursor/skills/verify-jimbro/` and in Claude Code through the `.claude/skills/verify-jimbro` symlink. Every path below is the real one under `.cursor/`. Persistence is IndexedDB (`gymbro-database`) on the page origin. There is no login; cloud sync takes a user ID and token in Settings. Pages are full HTML loads, not an SPA.

This skill is for agents. Follow the feature map under `features/`. Do not invent selectors. Do not call product code or IndexedDB from the console as a substitute for the user path.

## Launch

Use a dedicated origin so verification does not share IndexedDB with a human's daily `vp dev` on port 5173.

From the repo root:

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro launch
```

That starts `vp run dev --host 127.0.0.1 --port 5174 --strictPort` (override with `JIMBRO_VERIFY_PORT`) with `VITE_API_BASE` pointed at a dead local address (override with `JIMBRO_VERIFY_API_BASE`), so a run can never sync with the production worker. It uses the repo's own `vp` when none is on PATH. It writes pid/url under `.cursor/skills/verify-jimbro/.run/`. Ready means `GET $JIMBRO_VERIFY_URL/` returns HTML whose `<title>` is `Jimbro`.

Two instances can run side by side on different ports. Different ports are different origins, so they do not share IndexedDB.

Do not drive `http://localhost:5173` unless `control-jimbro doctor` says that process is the one this run started. Driving the user's tab on 5173 mutates their workout data.

Teardown:

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro cleanup
```

Cleanup kills only the pid in `.run/pid`. It does not delete proof files under `.cursor/skills/verify-jimbro/artifacts/`.

## Doctor

Run this first whenever anything looks off, and after every failed tour or drive:

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
.cursor/skills/verify-jimbro/scripts/control-jimbro tour
.cursor/skills/verify-jimbro/scripts/control-jimbro tour --device pixel8pro --only gymtime
.cursor/skills/verify-jimbro/scripts/control-jimbro snapshot / --out .cursor/skills/verify-jimbro/artifacts/scratch
```

`tour` is the main helper. It imports a year of real history through Settings (the worker's fixture, with dates moved so the latest workout was last Sunday), then walks every screen and dialog the feature map names, in order, on an iPhone 13 (390×844) and a Pixel 8 Pro (448×998) viewport. It writes one PNG per stop to `artifacts/tour/<device>/` and a contact sheet with the phones side by side to `artifacts/tour/index.html`. A stop that does not show what it waits for, or an uncaught page error, fails the tour and is marked on the sheet. Both phones take under a minute. `--device` picks one phone and `--only` keeps the screenshots whose stop name contains the text (every stop still runs, since later stops build on earlier ones).

The tour shows; it does not judge. Correctness belongs in `tests/*.spec.ts`, which CI runs on every pull request. Look at the screenshots, since a stop passes as long as its screen appears, however it looks.

Chromium emulates the iPhone's viewport and touch, not WebKit, and neither phone's system font. The repo's WebKit specs run on CI.

For a flow no stop covers, follow the feature file's by-hand steps with Playwright against `$JIMBRO_VERIFY_URL`. When a new screen or dialog ships, add a stop to `STOPS` in `scripts/drive.mjs` and name it in its feature file.

`snapshot` captures one route in a fresh context, as PNG plus ARIA YAML.

Browser tools (Cursor's, or Claude in Chrome) are allowed only against the verification URL from `control-jimbro url`. IndexedDB then persists in that browser profile. Before a mutating drive, reset via Settings as in `features/README.md`. If a human tab is already on that same verification origin, refuse and ask them to close it.

Existing Playwright specs in `tests/*.spec.ts` are the source of truth for locators. Match them. Stable handles used across pages:

| Control | Handle |
| --- | --- |
| Home heading | `getByRole('heading', { name: 'Hey, gymbro.' })` |
| Get started (empty home) | `getByRole('link', { name: 'Get started' })` |
| Suggested program (home) | `.program-pick[data-suggested]` |
| Settings (home) | `getByRole('link', { name: 'Settings', exact: true })` |
| Bottom nav | `getByRole('link', { name: 'Workouts' })` etc.; the current page's `.nav-link` has `aria-current="page"` |
| New (exercises/programs) | `getByRole('button', { name: 'New' })` |
| New workout | `getByRole('button', { name: 'New' })` (accessible name is `Add new workout`) |
| Close dialog | `getByRole('button', { name: 'Close dialog' })` |
| Seed Database | `getByRole('button', { name: 'Seed Database' })` (only when IndexedDB has no exercise or program rows) |
| Reset Database | open `Manage local data`, then `getByRole('button', { name: 'Reset Database' })`, accept `window.confirm` |
| Toast | `.toast-message-popup` |

Native `<dialog>` for modals. Native `window.confirm` for delete and reset. `page.once('dialog', d => d.accept())` must be registered before the click.

Routes: `/`, `/exercises/`, `/programs/`, `/workouts/`, `/gymtime/?programId=<id>`, `/gymtime/?id=<session-id>`, `/settings/`, `/stats/`. Missing gymtime params show an error and a Back to workouts link. Settings has no bottom-nav link; reach it from Home's header.

## Evidence

Proof lives in `.cursor/skills/verify-jimbro/artifacts/`: `tour/` for the last tour, and a folder you name for by-hand captures. Cleanup must not touch that tree. A new tour replaces `tour/`.

Standards:

- A UI change ships with the affected tour stops on both phones, attached to the pull request or the reply.
- Exercise the real user path. Do not `indexedDB.deleteDatabase` or call `exercisesStore.seed()` from the console as the proof. The tour loads its history through Settings' import, which is a user path.
- Capture the action and the resulting state. A final screenshot without the click that produced it is incomplete.
- After a mutation, reopen the record from a list or another page. A toast alone is not persistence.
- For a by-hand capture, record the feature ID, URL, device and entry point in a `proof.txt` next to the PNG/ARIA files.
- Wait for what the app shows or stores, never a fixed time, and never force a click. Both rules come from the repo's specs.
- UI proof is an ARIA snapshot plus a screenshot that shows the Jimbro heading or bottom nav.
- Side effects to check: IndexedDB rows visible after reload and read back read-only, downloaded `jimbro-export-*.json` for export, workout URL changing from `?programId=` to `?id=` after save.

Mocks: none for the PWA itself. Cloud Backup talks to an external worker. Do not enter real tokens. Skip cloud restore unless using disposable credentials the user provided.

## Cleanup

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro cleanup
```

Kills the pid this run started. Leaves `artifacts/` in place. After a failed iteration, run cleanup before the next launch so port 5174 is not stranded.

Do not `pkill -f vite` or kill by process name. That can take down the user's 5173 server.

Playwright contexts die with the Node process. Browser tabs you opened should be closed, not left on `/settings/` with a reset in progress.

## Helpers

All commands are run from the repo root. The script is executable.

```bash
.cursor/skills/verify-jimbro/scripts/control-jimbro launch
.cursor/skills/verify-jimbro/scripts/control-jimbro doctor
.cursor/skills/verify-jimbro/scripts/control-jimbro url
.cursor/skills/verify-jimbro/scripts/control-jimbro snapshot /workouts/ --out .cursor/skills/verify-jimbro/artifacts/scratch
.cursor/skills/verify-jimbro/scripts/control-jimbro tour [--device iphone13|pixel8pro] [--only <stop>]
.cursor/skills/verify-jimbro/scripts/control-jimbro cleanup
```

`drive.mjs` is invoked by `control-jimbro`. Do not call it directly unless `JIMBRO_VERIFY_URL` is already exported.

Repo Playwright suite (`pnpm test` / `playwright test`) auto-starts `vp run dev` on 5173 and is a regression net, not this skill's isolated proof. Use it when you need the full spec file. Use this skill when you need a disposable origin, screenshots on both phones, and a user-path drive mid-task.

First machine: `vp exec playwright install chromium` so `tour` and `snapshot` can launch Chromium. When Playwright's own build is missing, `drive.mjs` falls back to `JIMBRO_CHROMIUM`, then `/opt/pw-browsers/chromium`, the image's Chromium in Claude Code cloud sessions.
