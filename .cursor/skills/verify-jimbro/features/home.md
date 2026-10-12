# Home and start workout

Home is `/`. It greets the user, shows this week's workouts and highlights, and suggests the next program to start or continue. On an empty database it offers a way to get started instead.

## Sub-features

- `home-heading` shows `Hey, gymbro.`, title `Jimbro`, and a `Settings` link.
- `home-empty` shows `Let's set up your first workout.` and a `Get started` link to `/workouts/` when no programs exist. `#week-count` reads `0 workouts`.
- `home-week` shows `#week-count` (`N of M workouts`, M being the program count in rotation mode or the weekly goal in freestyle), the `#week-goal` bar, and seven `.week-day` cells with `data-status`. Today's cell has `aria-current="date"`.
- `home-highlights` shows streak, volume (with `▲/▼/= N% vs last week`) and records tiles in `#highlights`. They appear once any workout session exists, not when programs merely exist. Each tile is a link to `/stats/`.
- `home-picks` lists one `.program-pick` per program under `Pick your workout`, each with a meta line (`Not done yet`, `Last done …`, `Done …`, `Started …`). The suggested pick has `data-suggested` and reads `Start ›` (link to `?programId=`), or `Continue ›` (link to `?id=`) for a workout of it started and unfinished this week. Others read `›`. When the week's goal is met and nothing is unfinished, no pick is suggested.
- `home-install` shows `Install Jimbro for quick access` with an `Install` button in a browser tab, hidden when running installed. Without a captured `beforeinstallprompt` (iOS, Playwright), Install shows an alert about `Add to Home Screen`.
- `home-nav` shows the bottom nav (Home, Workouts, Exercises, Programs), each with a Lucide line icon, and marks the current page's link `aria-current="page"`, its icon in a pill. Stats, Settings and gymtime have no nav link.

## How to get to it (user POV)

- Open `/` in the browser, or the installed app.
- Choose `Home` in the bottom nav from any other page.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `01-home-empty` shows the empty home. `04-home` shows the week, highlights and a suggested `Start ›` pick after the tour imports a year of history ending last Sunday.
- **By hand: start the suggested program.** Click `.program-pick[data-suggested]`. The URL matches `/gymtime/?programId=`. Save the workout there, return Home, and the same pick reads `Continue ›` with an `?id=` link.
- **By hand: Settings.** Click `getByRole('link', { name: 'Settings', exact: true })`. The URL is `/settings/`.
- **By hand: Install.** Register `page.once('dialog', …)` first, then click `getByRole('button', { name: 'Install' })`. The alert mentions `Add to Home Screen`.

## Gotchas

- The week, the streak and `Start` versus `Continue` follow today's date in Athens (the tour's time zone). `tests/home.spec.ts` fixes the clock with `page.clock.setFixedTime`; a by-hand drive uses the real clock, so check counts against today.
- Seeding adds programs but no sessions, so after `Seed Database` the picks show and highlights stay hidden.
- Home reloads itself when it becomes visible again after the day, the workout mode or the database changed (`src/pages/reloadWhenStale.ts`), so a tab switch mid-drive can reload it.
- The Settings link uses `exact: true` because other copy can include the word Settings.
