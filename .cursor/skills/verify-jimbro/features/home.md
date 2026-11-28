# Home and start workout

Home is `/`. It greets the user, shows this week's workouts and highlights, and suggests the next program to start or continue. On an empty database it offers a way to get started instead.

## Sub-features

- `home-heading` shows `Hey, gymbro.`, title `Jimbro`, and a `Settings` link.
- `home-empty` shows `Let's set up your first workout.` and a `Get started` link to `/workouts/` when no programs exist. `#week-count` reads `0 workouts`.
- `home-week` shows `#week-count` (`N of M workouts`, M being the program count in rotation mode or the weekly goal in freestyle), the `#week-goal` bar (`.met` filled, `.ahead` lighter for workouts done ahead last week, `.extra` lighter segments past the goal), `#week-carry` (`+N workout(s) toward next week` or `N workout(s) done ahead last week`, hidden otherwise), and seven `.week-day` cells with `data-status`. Today's cell has `aria-current="date"`.
- `home-highlights` shows streak, volume (with `▲/▼/= N% vs last week`, or `Last week by now: N kg` in plain text before this week's first lift) and records tiles in `#highlights`. They appear once any workout session exists, not when programs merely exist. Each tile is a link to `/stats/`.
- `home-picks` lists one `.program-pick` per program under `Pick your workout`, each with a meta line (`Not done yet`, `Last done …`, `Done …`, `Done ahead …`, `Started …`). The suggested pick has `data-suggested` and reads `Start ›` (link to `?programId=`), or `Continue ›` (link to `?id=`) for a workout of it started and unfinished this week. Others read `›`. When the week's goal is met and nothing is unfinished, the program done longest ago is suggested as an extra, with `data-extra` and `Extra ›`.
- `home-install` shows `Install Jimbro for quick access` with an `Install` button in a browser tab, hidden when running installed. Without a captured `beforeinstallprompt` (iOS, Playwright), Install shows an alert about `Add to Home Screen`.
- `home-nav` shows the bottom nav (Home, Workouts, Exercises, Programs), each with a Lucide line icon, and marks the current page's link `aria-current="page"`, its icon in a pill. Stats, Settings and gymtime have no nav link.
- `nav-start` is the raised orange disc in the middle of the nav, `#start-button` (`Start next workout`), on every page. A tap starts the program Home suggests: it goes to `/gymtime/?programId=…&start`, which starts the workout at once (the watch reminder asks first), or continues the suggested workout left unfinished this week. On gymtime before the workout starts, it starts the workout shown instead. It reads the database just after the page draws and then carries `data-state` (`idle` or `running`): wait for it before a tap. While a workout dated today is incomplete, the button has `data-running`, reads `Finish`, and its disc shows the time since the start (`.nav-start-time`, `m:ss`, then `h:mm:ss`) in a ring of the exercises done; its name is `Finish workout, <minutes> min in`.
- `christmas` decorates the app from Nov 20 to Jan 6 when Settings' `Festive touches` is on (the default): `<html data-season="christmas">`, lights under every header, a `.season-snow` layer of 24 falling flakes, a snow drift on the nav and a red bauble Start disc. Home says `Ho ho ho, gymbro.` with `#santa-hat` (`Knock off the Santa hat`), which a tap knocks off. From Dec 1 to 26 Home shows `#advent`, `Advent of gains` (`Merry Christmas!` from the 25th), with 24 doors named `Door N, open|shut, no workout that day|today, opens with a workout|not yet`: a workout that day opens a door, and door 24 opens with any workout from Dec 21. A tap on an open door opens `#advent-door-dialog` with a fun fact from that day's workouts.
- `nav-finish` is the `Finish workout?` sheet (`#finish-workout-dialog`) a tap on the running button opens: the program, the start time and running time, `N of M exercises done`, `Go to workout` (hidden on the workout's own page) and `Finish workout`, which completes the workout with the sets left undone. On gymtime it shows `Workout done!`; elsewhere a `Workout finished` toast, and the page draws again.

## How to get to it (user POV)

- Open `/` in the browser, or the installed app.
- Choose `Home` in the bottom nav from any other page.
- Tap the nav's Start disc from any page to start or finish a workout.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `01-home-empty` shows the empty home. `04-home` shows the week, highlights and a suggested `Start ›` pick after the tour imports a year of history ending last Sunday. `47-nav-start-running` shows Home with a workout running from the nav's Start, and `48-nav-finish-sheet` its `Finish workout?` sheet. Every stop before the Christmas ones runs with `Festive touches` off, as the specs do, so the shots look the same whatever the date. `52-christmas-home` fixes the clock at Dec 16 this year, turns `Festive touches` on in Settings, starts a workout from the nav and shows Home in season with door 16 open, and `53-christmas-advent-door` its sheet.
- **By hand: start the suggested program.** Click `.program-pick[data-suggested]`. The URL matches `/gymtime/?programId=`. Save the workout there, return Home, and the same pick reads `Continue ›` with an `?id=` link.
- **By hand: Settings.** Click `getByRole('link', { name: 'Settings', exact: true })`. The URL is `/settings/`.
- **By hand: Install.** Register `page.once('dialog', …)` first, then click `getByRole('button', { name: 'Install' })`. The alert mentions `Add to Home Screen`.

## Gotchas

- The week, the streak and `Start` versus `Continue` follow today's date in Athens (the tour's time zone). `tests/home.spec.ts` fixes the clock with `page.clock.setFixedTime`; a by-hand drive uses the real clock, so check counts against today.
- Seeding adds programs but no sessions, so after `Start with the 3-day split` the picks show and highlights stay hidden.
- Home reloads itself when it becomes visible again after the day, the workout mode or the database changed (`src/pages/reloadWhenStale.ts`), so a tab switch mid-drive can reload it.
- The Settings link uses `exact: true` because other copy can include the word Settings.
