# Settings

Settings is `/settings/`: break time, cloud backup, gyms, and the local data tools. Each section is a `<details>` that starts collapsed.

## Sub-features

- `settings-break` in `Workout Settings`: `Minutes` and `Seconds`, then `Save Break Time` shows `Break time saved!`. The gymtime break timer counts down from this.
- `settings-cloud` in `Cloud Backup`: `#cloud-summary-status` reads `Not set up yet`, `N pending`, `Syncing...` or `N pending · <date>`. `User ID` and `Token`, then `Save credentials` (`Cloud backup credentials saved.`, or a warning when a field is empty). `Sync now` syncs, or says `Save your credentials first.`.
- `settings-gyms` in `Gyms`: `No workout names a gym yet.` with no gyms. Otherwise a gym picker (`Name (N workouts)`), `New name` and `Rename`, which confirms and shows `Renamed on N workout(s).`. Picking another gym's name merges them.
- `settings-data` in `Manage local data`: `Export to JSON` downloads a file, `Import from JSON file` (`#import-input`) adds rows not stored yet and shows `Database imported!`, `Reset Database` confirms and shows `Database reset.`.

## How to get to it (user POV)

- Choose `Settings` in the Home header. There is no bottom-nav link.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `03-settings-import` (the import itself, which loads the tour's history), `16-settings`, `17-settings-expanded` (break time and cloud backup), `18-settings-gyms` (gyms from the imported history).
- **By hand: reset.** Open `Manage local data`, register `page.once('dialog', d => d.accept())`, click `Reset Database`, and wait for `Database reset.`.
- **By hand: export.** Wait for Playwright's `download` event while clicking `Export to JSON`, and read the file.

## Gotchas

- `launch` points the app at a dead API, so `Sync now` with any credentials ends in `Sync failed.`. A real sync needs the local worker that `tests/localWorker.ts` starts, never production or real tokens.
- Saving credentials turns on syncing on every page, and on `/workouts/` an empty database then offers `Restore from cloud` instead of `Seed Database`.
- Import never overwrites a stored row. Reset first to import into an empty database.
- Register the confirm handler before clicking Reset or Rename.
