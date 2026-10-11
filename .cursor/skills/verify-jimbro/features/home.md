# Home and start workout

Home is `/`. It greets the user, shows this week's workouts and highlights, and suggests the next program to start or continue. On an empty database it offers a way to get started instead.

## Sub-features

- `home-heading` shows `Hey, gymbro.` and title `Jimbro`.
- `home-empty` shows `Let's set up your first workout.` and a `Get started` link to `/workouts/` when no programs exist.
- `home-week` shows seven `.week-day` cells, today's with `aria-current="date"`, and `#week-count` such as `1 of 3 workouts`.
- `home-highlights` shows streak, volume and records tiles in `#highlights` once a workout exists. They are hidden on an empty database.
- `home-picks` lists one `.program-pick` per program under `Pick your workout`. The suggested one has `data-suggested` and reads `Start ›`, or `Continue ›` with an `?id=` link when a workout of it started this week.
- `home-settings` opens Settings from the header link.
- `home-nav` shows the bottom nav with the current page's link marked `aria-current="page"`.

## How to get to it (user POV)

- Open `/` in the browser.
- Choose `Home` in the bottom nav from any other page.
- Install the PWA and open it from the home screen.

## Driving it with control-jimbro

Preconditions:

- `control-jimbro doctor` passes.
- The drive starts from an empty database, as every `drive` does.

- **Run it.** `control-jimbro drive home`. It writes `artifacts/<device>/home/`.
- **Empty home.** Chromium loads `/`. The heading is `Hey, gymbro.` and `Let's set up your first workout.` is visible. Evidence: `home-empty.png` and `.aria.yml`.
- **Get started.** It clicks `getByRole('link', { name: 'Get started' })`. The URL is `/workouts/`, the heading is `Workouts`, and `.nav-link[aria-current="page"][href="/workouts/"]` is visible.
- **Seeded home.** It clicks `Seed Database`, then `getByRole('link', { name: 'Home' })` in the nav. `.week-day[aria-current="date"]` and `.program-pick[data-suggested]` are visible. Evidence: `home-seeded.png`.
- **Start the suggested program.** It clicks the suggested pick. The URL matches `/gymtime/?programId=`. Evidence: `gymtime-from-pick.png`.
- **Settings entry.** By hand: from `/`, click `getByRole('link', { name: 'Settings', exact: true })`. The URL is `/settings/` and the heading is `Settings`.
- **Proof.** `proof.txt` lists both headings, the suggested pick's text and the URL after the pick.

## Gotchas

- The week, the streak and `Start` versus `Continue` depend on today's date. `tests/home.spec.ts` fixes the clock with `page.clock.setFixedTime`. A drive uses the real clock, so check the counts against today rather than hard-coding them.
- Highlights and picks stay hidden until a program exists. An empty home that shows them is a bug, not a leftover.
- The Settings link uses `exact: true` because other copy can include the word Settings.
- Driving `/` on port 5173 is not this feature. Origin must be the verification URL.
