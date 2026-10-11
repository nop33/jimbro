# Jimbro verification map

This directory is the maintained source for verifying Jimbro's user-facing behavior. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-jimbro/scripts/control-jimbro launch` so the origin is `http://127.0.0.1:5174` (or `JIMBRO_VERIFY_PORT`).
- Run `control-jimbro doctor` and require pid, port, and `<title>Jimbro</title>`.
- Never drive an instance this run did not start.
- Playwright `drive` / `snapshot` start with empty IndexedDB. Browser tools (Cursor's, or Claude in Chrome) reuse profile storage on that origin.
- To empty storage through the UI: open `/settings/`, expand `Manage local data`, accept the confirm dialog, click `Reset Database`, wait for toast `Database reset`.
- To load the built-in 3-day split: open `/workouts/` on an empty database and click `Seed Database`. Seeded programs are `Push day`, `Pull day`, and `Legs day`.
- Do not use Cloud Backup, real tokens, or the Cloudflare worker during ordinary proof. `launch` points the app at a dead local API (`JIMBRO_VERIFY_API_BASE`), never production.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer role and accessible name over CSS. When a spec in `tests/` uses a class or id, copy that locator exactly.
- Treat every command as literal.
- Browser actions go through `control-jimbro snapshot` / `control-jimbro drive`, or Playwright locators against `$JIMBRO_VERIFY_URL`.
- Each mapped feature has a `drive <feature>` that runs its recipe. When a recipe changes, change its drive in `scripts/drive.mjs` in the same edit, so a stale map fails the next run instead of misleading it.
- Prove a UI change on both phones: `JIMBRO_VERIFY_DEVICE=iphone13` (the default) and `pixel8pro`.
- Wait for what the app shows or stores. Never wait a fixed time and never force a click.
- After a mutation, reload or navigate to a second view before calling it persisted.
- Restore empty IndexedDB after a mutating recipe if another feature will run in the same Playwright context. `drive` and `snapshot` already use a fresh context.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot with a Jimbro heading or bottom nav visible.
- Mutation proof includes a read-only second view (list, reload, or another route).
- Record the feature ID and entry point in `artifacts/<device>/<feature-id>/proof.txt`.
- Read stored rows back as the side effect where a write matters (`db.json` in gymtime). Reading is evidence; writing to IndexedDB or calling stores is not a user path.
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

- [Home and start workout](./home.md) covers the heading, empty state, week, program picks, and bottom nav.
- [Exercises](./exercises.md) covers create, edit, filter, and delete.
- [Programs](./programs.md) covers create, edit, and delete against a real exercise.
- [Workouts](./workouts.md) covers empty seed, weekly cards, and starting a program.
- [Gymtime](./gymtime.md) covers saving a session, logging a set, and the break timer.

`/stats/`, Cloud Backup and sync, gyms (the gym field, chart bands, Settings rename), JSON import and export, and offline use are user-visible and not mapped yet. Do not claim them verified.
