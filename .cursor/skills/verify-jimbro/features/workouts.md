# Workouts

Workouts is the calendar of training weeks. An empty database offers seeding. Each week is a row of seven days, green once it met its goal, a workout day opens its workout, and this week's progress card shows the mode and opens its dialog.

## Sub-features

- `workouts-empty` shows `Start with the 3-day split` when the database has no exercise and no program rows, deleted ones included, and `Sign in with passkey` under it where the browser has passkeys. The `#intro` text then offers a 3-day split. Signing in restores the passkey account's workouts and reloads the page.
- `workouts-intro` shows an `#intro` text while there is no program: onboarding, restore, or `Create a program from your exercises to start a workout.` (exercises only).
- `workouts-progress` replaces `#intro` once a program exists: `#week-progress` shows the mode (`#workout-mode-name`, `Rotation` or `Freestyle`, and `#workout-mode-rule`, `Every program` or `Goal N`), `#week-progress-count` (`N of M programs done` or `N of M workouts done`), the goal bar `#week-progress-goal` and a note: none done yet, workouts left, or all done, with any workouts done ahead last week or counting toward next week. The count stops at the goal.
- `workouts-restore` shows `Restore from cloud` instead of `Start with the 3-day split` when the database is empty, cloud credentials are saved and the database has never synced.
- `workouts-weeks` shows `section#workout-calendar`: a sticky M to S header and one `.calendar-week` per week, newest first, from next week back to the first workout's week. `data-state` is `met` (a green band, workouts done ahead the week before included), `current` (this week before it meets the goal, a dashed outline, pale green once `data-started`), `partial` (a past week with workouts short of the goal, a pale green band), `missed` (a past week without workouts, a dim red band) or `next` (no band). A `.calendar-month` column on the left names the month (`NOV`, with the year under it for another year) on each month's first week, by the month of the week's Thursday. Each has an sr-only `.calendar-week-label` (`Week N, goal met, 3 workouts`, led by `November 2026.` on a month's first week) and a `.calendar-ahead` tag (`+N ahead`) on its bottom-left when it needed workouts done ahead. Each `.calendar-day` shows its date, centred, with `aria-current="date"` on today. A workout day shows a `.calendar-workout` with `data-status` (`completed`: a white check, `incomplete`: a dashed amber circle), a quiet `.calendar-name` tag on the band's top edge (the program's first word, or its whole name when two programs share it, truncated with an ellipsis), and a `+1` `.calendar-extra` badge on a workout beyond the goal that next week needs. With one workout it is a link to `/gymtime/?id=`. With two or more it is a button with a `.calendar-count` badge that opens a `.calendar-popover` listing a link per workout with `Done` or `Started`.
- `workouts-new` opens `dialog#new-workout-dialog` (`Select program`), closed with ✕ only. Each `a.program-link` shows this week's status and `.last-completed-date`, and opens `/gymtime/?programId=`.
- `workouts-mode` opens `dialog#workout-mode-dialog` from `#week-progress`. Freestyle shows `Weekly workout goal` (1 to 7). A change saves to localStorage and draws the page again. The calendar is the same in both modes, with the goal from the mode: every program in rotation, the weekly goal in freestyle.

## How to get to it (user POV)

- Choose `Get started` on an empty home.
- Choose `Workouts` in the bottom nav.
- Choose `New` in the header (accessible name `Add new workout`).
- Choose a workout day to open its workout (`?id=`), or a day with a count badge to pick one of its workouts.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `02-workouts-empty` (Start with the 3-day split, Sign in with passkey and onboarding intro), `05-workouts` (the progress card, then the calendar from next week down, this week second and past weeks below), `06-workouts-new-dialog`, `07-workouts-mode-dialog`.
- **By hand: status after a start.** From a seeded calendar, choose `New`, pick a program, start the workout with `Add set` on the first card, wait for the toast `Workout started`, then `page.goBack()`. Today's `.calendar-workout` has `data-status="incomplete"`.
- **By hand: freestyle.** Click `#week-progress`, check `getByRole('radio', { name: 'Freestyle' })`, wait for the redraw. `#workout-mode-name` reads `Freestyle` and a week turns green once it holds the goal's number of workouts.

## Gotchas

- `Start with the 3-day split` checks raw rows, so a database whose only exercise was deleted shows no seed button.
- `Restore from cloud` needs saved credentials. With the verification server's dead API it can only show its failure toast, `Failed to restore from cloud.`.
- Changing the mode or the goal reloads the page. Wait for the reload before the next step.
