# Home and start workout

Home is `/`. It greets the user, links to Settings, and sends them to the workouts calendar.

## Sub-features

- `home-heading` shows `Hey, gymbro.` and title `Jimbro`.
- `home-settings` opens Settings from the header link.
- `home-start` follows `Start workout` to `/workouts/`.
- `home-nav` shows bottom nav with Home active on `/` and Workouts active after the click.

## How to get to it (user POV)

- Open `/` in the browser.
- Choose `Start workout`.
- Choose `Settings` in the header.
- Choose `Home` in the bottom nav from any other page.

## Driving it with control-jimbro

Preconditions:

- Jimbro is healthy at the verification URL from `control-jimbro url`.
- `control-jimbro doctor` reports pid, port, and title `Jimbro`.

- **Open home.** Run `control-jimbro drive home`. Chromium loads `/`. The heading is `Hey, gymbro.` and `Start workout` is visible. Artifacts `artifacts/home/home.png` and `artifacts/home/home.aria.yml` show that heading.
- **Start workout.** The same command clicks `getByRole('link', { name: 'Start workout' })`. The URL matches `/workouts/` and the heading is `Workouts`.
- **Bottom nav.** On `/workouts/`, `.nav-link.active[href="/workouts/"]` is visible. Artifacts `artifacts/home/workouts.png` and `artifacts/home/workouts.aria.yml` show the Workouts heading.
- **Settings entry.** From `/`, click `getByRole('link', { name: 'Settings', exact: true })`. The URL is `/settings/` and the heading is `Settings`. Capture with `control-jimbro snapshot /settings/ --out .cursor/skills/verify-jimbro/artifacts/home-settings`.
- **Proof.** `artifacts/home/proof.txt` lists the home URL, the workouts URL after the click, and the two headings.

## Gotchas

- `Start workout` is a link, not a button. Role `button` will miss it.
- The Settings link on home uses `exact: true` because other copy can include the word Settings.
- An empty workouts page that shows `Seed Database` still counts as a successful navigation.
- Driving `/` on port 5173 is not this feature. Origin must be the verification URL.
