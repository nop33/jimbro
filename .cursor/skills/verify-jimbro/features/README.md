# Jimbro verification map

This directory is the maintained source for verifying Jimbro's user-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-jimbro/scripts/control-jimbro launch` so the origin is `http://127.0.0.1:5174` (or `JIMBRO_VERIFY_PORT`).
- Run `control-jimbro doctor` and require pid, port, and `<title>Jimbro</title>`.
- Never drive an instance this run did not start.
- Playwright `tour` / `snapshot` start with empty IndexedDB. Browser tools (Cursor's, or Claude in Chrome) reuse profile storage on that origin.
- To empty storage through the UI: open `/settings/`, expand `Manage local data`, accept the confirm dialog, click `Reset Database`, wait for toast `Database reset`.
- To load the built-in 3-day split: open `/workouts/` on an empty database and click `Seed Database`. Seeded programs are `Push day`, `Pull day`, and `Legs day`.
- Do not use Cloud Backup, real tokens, real passkeys, or the Cloudflare worker during ordinary proof. The tour's passkey stop uses a virtual authenticator and canned worker answers. `launch` points the app at a dead local API (`JIMBRO_VERIFY_API_BASE`), never production.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer role and accessible name over CSS. When a spec in `tests/` uses a class or id, copy that locator exactly.
- Treat every command as literal.
- `control-jimbro tour` shows every screen and dialog the map names, on both phones, numbered as in each feature file's `Tour stops`. When a feature gains, loses or changes a screen, change its stop in `scripts/drive.mjs` and its feature file in the same edit, so a stale map fails the next tour instead of misleading it.
- For a by-hand step, use Playwright locators against `$JIMBRO_VERIFY_URL`, or `control-jimbro snapshot`.
- Wait for what the app shows or stores. Never wait a fixed time and never force a click.
- After a mutation, reload or navigate to a second view before calling it persisted.

## Proof and skip reporting

- Correctness belongs in `tests/*.spec.ts`, which CI runs on every pull request. This skill shows what the user sees.
- For a UI change, attach the affected tour stops on both phones, or a by-hand capture of the action and the resulting state, not only the final screen.
- Mutation proof includes a read-only second view (list, reload, or another route), or the stored row read back. Reading is evidence; writing to IndexedDB or calling stores is not a user path.
- Report an unreachable path with the attempted URL and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with control-jimbro` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep implementation details out of the map. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [Home and start workout](./home.md) covers the heading, empty state, week, highlights, program picks, install row and bottom nav.
- [Workouts](./workouts.md) covers seeding, intro texts, weekly cards, the New workout dialog and the workout mode.
- [Gymtime](./gymtime.md) covers the workout form, exercise cards and their menu, logging and editing sets, the break timer, previous sets, the history chart, adding exercises, completion with its passkey offer, and deletion.
- [Exercises](./exercises.md) covers the library, the three kinds, create, edit, filter and delete.
- [Programs](./programs.md) covers create, reorder, edit and delete.
- [Stats](./stats.md) covers the lifetime totals.
- [Settings](./settings.md) covers break time, the passkey cloud backup, gyms, and export, import and reset.

Not mapped: offline use and the installed app (they need `vp build` and `vp preview`, since only the build registers the service worker), and a real sync (it needs the local worker from `tests/localWorker.ts`). `tests/offline.spec.ts` and `tests/sync.spec.ts` cover them. Do not claim them verified here.
