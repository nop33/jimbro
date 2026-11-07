# Settings

Settings is `/settings/`: a grouped list, as in the phone's own settings. Break time is set on the list. Cloud backup, AI assistants and the data on this phone each open a page of their own: their rows carry a chevron and show a status underneath. The version line sits at the foot of the screen.

## Sub-features

- `settings-break` on `/settings/`: a stepper, `15 seconds less` and `15 seconds more` round `#break-time` (`2:30` by default), from `0:15` to `10:00`, saved on each tap. A time off the 15 second grid, from the old fields, steps onto it. The gymtime break timer counts down from this.
- `settings-cloud` on `/settings/backup/` (the `Cloud backup` row): `#cloud-summary-status`, on the row and under the page's heading, reads `Not set up yet`, `Moved to another device`, `N pending`, `Syncing...`, `N pending · <date>`, or `Backup full · N pending` once the worker refused a push for the account's row cap (then `Sync now` shows `Your cloud backup is full. New changes stay on this phone.`). The heading reads `Backed up with a passkey`, `Backed up with a token` or `Your workouts are only on this phone`. `Sync now` shows once credentials are saved.
- `settings-passkey-offer`: without a passkey backup, the `Back up your workouts` section with `Create passkey` (`Passkey created.`) and `Sign in with passkey` (`Signed in.`). An account backs up one device at a time: when another device is signed in to the account, signing in confirms after the passkey sheet that the backup moves here and the other device stops backing up. When the account holds a different copy of a row on this phone, the same confirm says the account's copy replaces this device's; when neither applies, it asks nothing. Declining leaves both devices as they were. A phone whose backup moved away says so in a toast on its next push, reads `Your backup moved to another device, so this phone stopped backing up.` above the offer, keeps its workouts, and offers `Sign in with passkey` first. After a sign-out, `Sign in with passkey` is the primary button and comes first. A browser without passkeys reads `This browser can't use passkeys, so it can't back up your workouts.`. A closed browser sheet shows `No passkey was used.`. The page fetches the passkey options when it shows.
- `settings-passkey`: signed in with a passkey, `Backed up with a passkey`, `Sync now`, and under `Passkeys` the rows `Add another passkey` (`Passkey added.`) and `Sign out`, which syncs first, then confirms, warning `N change(s) on this phone hasn't backed up yet` (`haven't` for several) when the push could not finish, and shows `Signed out.`.
- `settings-token` in `Use a token` under `Developers` (hidden while a passkey backs up), a row that opens in place: `User ID` and `Token`, then `Save credentials` (`Cloud backup credentials saved.`, or a warning when a field is empty).
- `settings-assistants` on `/settings/assistants/`: without a passkey backup, `An assistant signs in with your passkey, so it needs a cloud backup with a passkey first.`, linking to Cloud backup. With one, the `Prompt` field holds a prompt naming `<API_BASE>/mcp` for any assistant, `Copy prompt` (`Prompt copied.`), and under `Connected` either `No assistant is connected yet.` or each assistant's name, `Connected <date> · last used <date>` and `Disconnect <name>` (`<name> disconnected.`). The list loads when the page shows. The Settings row reads `Ask about your workouts` or `Needs a passkey backup`.
- `connect` is `/connect/?request=<id>`, where an assistant's OAuth request lands: `Allow <name> to read your workouts?`, the host it goes back to, a warning when that is an app on this computer, `Allow with passkey` and `Don't allow`, which both send the browser back to the assistant. An unknown, answered or expired request shows `This link has expired`, and a browser without passkeys `This browser can't use passkeys`. `tests/connect.spec.ts` covers the whole flow against the local worker.
- `settings-data` on `/settings/data/` (the `Data on this phone` row): `Export to JSON` downloads a file, `Import from JSON` (`#import-input`) adds rows not stored yet and shows `Database imported!`, and apart under `Start over`, `Reset database` confirms and shows `Database reset.`.
- `settings-version` at the foot of `/settings/`: `Version <short hash>` linked to the commit on GitHub, then `· <date>` of that commit (`#app-version`). It stays hidden when the build could not tell its commit.

## How to get to it (user POV)

- Choose `Settings` in the Home header. There is no bottom-nav link.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `03-settings-import` (the import itself on `/settings/data/`, which loads the tour's history), `16-settings` (the list, the stepper and the version line), `17-settings-backup` (the passkey offer), `18-settings-token` (`Use a token` open), `19-settings-data`, `34-settings-passkey` (signed in with a passkey, after `Create passkey` with Chromium's virtual authenticator, on `localhost` with canned worker answers), `35-settings-assistants` (the AI assistants page, with one canned connection), `36-settings-signed-out` (after `Sign out`, with `Sign in with passkey` first), `37-settings-moved` (signed in again over a canned account that another device backs up, then that device takes it back, so `Sync now` is refused), `38-connect` (the `/connect/` page for a canned request from Claude, on both phones).
- **By hand: reset.** Open `/settings/data/`, register `page.once('dialog', d => d.accept())`, click `Reset database`, and wait for `Database reset.`.
- **By hand: export.** Wait for Playwright's `download` event while clicking `Export to JSON`, and read the file.

## Gotchas

- `launch` points the app at a dead API, so `Sync now` with any credentials ends in `Sync failed.`. A real sync needs the local worker that `tests/localWorker.ts` starts, never production or real tokens.
- A passkey needs a domain origin: WebAuthn refuses `127.0.0.1`, so drive passkeys on `http://localhost:<port>` (its own empty IndexedDB), and only in Chromium with a virtual authenticator (`WebAuthn.addVirtualAuthenticator` over CDP). The tour answers the worker's `/auth/register/*`, `/auth/signin/*`, `/auth/connect/request|options`, `/api/claim`, `/api/push`, `/api/pull`, `/api/signout` and `/api/connections` with canned JSON, since it reaches no worker. `tests/passkeys.spec.ts` covers the real thing.
- Saving credentials turns on syncing on every page, and on `/workouts/` an empty database then offers `Restore from cloud` instead of `Start with the 3-day split`.
- Import never overwrites a stored row. Reset first to import into an empty database.
- Register the confirm handler before clicking Reset.
