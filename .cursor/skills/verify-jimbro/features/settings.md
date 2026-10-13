# Settings

Settings is `/settings/`: break time, the passkey cloud backup, gyms, and the local data tools. Each section is a `<details>` that starts collapsed.

## Sub-features

- `settings-break` in `Workout Settings`: `Minutes` and `Seconds`, then `Save Break Time` shows `Break time saved!`. The gymtime break timer counts down from this.
- `settings-cloud` in `Cloud Backup`: `#cloud-summary-status` reads `Not set up yet`, `N pending`, `Syncing...`, `N pending · <date>`, or `Backup full · N pending` once the worker refused a push for the account's row cap (then `Sync now` shows `Your cloud backup is full. New changes stay on this phone.`). `Sync now` shows once credentials are saved.
- `settings-passkey-offer`: without a passkey backup, the `Back up your workouts` section with `Create passkey` (`Passkey created.`) and `Sign in with passkey` (`Signed in.`). When the account holds a different copy of a row on this phone, signing in confirms after the passkey sheet that the account's copy replaces this device's; when nothing differs, it asks nothing. After a sign-out, `Sign in with passkey` is the primary button and comes first. A browser without passkeys reads `This browser can't use passkeys, so it can't back up your workouts.`. A closed browser sheet shows `No passkey was used.`.
- `settings-passkey`: signed in with a passkey, `Your workouts are backed up with a passkey.`, `Sync now`, `Add another passkey` (`Passkey added.`) and `Sign out`, which syncs first, then confirms, warning `N change(s) on this phone hasn't backed up yet` (`haven't` for several) when the push could not finish, and shows `Signed out.`.
- `settings-token` in the nested `Use a token` (hidden while a passkey backs up): `User ID` and `Token`, then `Save credentials` (`Cloud backup credentials saved.`, or a warning when a field is empty).
- `settings-gyms` in `Gyms`: `No workout names a gym yet.` with no gyms. Otherwise a gym picker (`Name (N workouts)`), `New name` and `Rename`, which confirms and shows `Renamed on N workout(s).`. Picking another gym's name merges them.
- `settings-data` in `Manage local data`: `Export to JSON` downloads a file, `Import from JSON file` (`#import-input`) adds rows not stored yet and shows `Database imported!`, `Reset Database` confirms and shows `Database reset.`.

## How to get to it (user POV)

- Choose `Settings` in the Home header. There is no bottom-nav link.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `03-settings-import` (the import itself, which loads the tour's history), `16-settings`, `17-settings-expanded` (break time and the passkey offer), `18-settings-token` (`Use a token` open), `19-settings-gyms` (gyms from the imported history), `31-settings-passkey` (signed in with a passkey, after `Create passkey` with Chromium's virtual authenticator, on `localhost` with canned worker answers), `32-settings-signed-out` (after `Sign out`, with `Sign in with passkey` first).
- **By hand: reset.** Open `Manage local data`, register `page.once('dialog', d => d.accept())`, click `Reset Database`, and wait for `Database reset.`.
- **By hand: export.** Wait for Playwright's `download` event while clicking `Export to JSON`, and read the file.

## Gotchas

- `launch` points the app at a dead API, so `Sync now` with any credentials ends in `Sync failed.`. A real sync needs the local worker that `tests/localWorker.ts` starts, never production or real tokens.
- A passkey needs a domain origin: WebAuthn refuses `127.0.0.1`, so drive passkeys on `http://localhost:<port>` (its own empty IndexedDB), and only in Chromium with a virtual authenticator (`WebAuthn.addVirtualAuthenticator` over CDP). The tour answers the worker's `/auth/register/*`, `/auth/signin/options`, `/api/push`, `/api/pull` and `/api/signout` with canned JSON, since it reaches no worker. `tests/passkeys.spec.ts` covers the real thing.
- Saving credentials turns on syncing on every page, and on `/workouts/` an empty database then offers `Restore from cloud` instead of `Seed Database`.
- Import never overwrites a stored row. Reset first to import into an empty database.
- Register the confirm handler before clicking Reset or Rename.
