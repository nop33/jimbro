# Workouts

Workouts is the calendar of training weeks. An empty database offers seeding. Week cards start, resume or show a workout, and this week's progress card shows the mode and opens its dialog.

## Sub-features

- `workouts-empty` shows `Seed Database` when the database has no exercise and no program rows, deleted ones included. The `#intro` text then offers a 3-day split.
- `workouts-intro` shows an `#intro` text while there is no program: onboarding, restore, or `Create a program from your exercises to start a workout.` (exercises only).
- `workouts-progress` replaces `#intro` once a program exists: `#week-progress` shows the mode (`#workout-mode-name`, `Rotation` or `Freestyle`, and `#workout-mode-rule`, `Every program` or `Goal N`), `#week-progress-count` (`N of M programs done` or `N of M workouts done`), the goal bar `#week-progress-goal` and a note: none done yet, workouts left, or all done.
- `workouts-restore` shows `Restore from cloud` instead of `Seed Database` when the database is empty, cloud credentials are saved and the database has never synced.
- `workouts-weeks` shows one `.workout-week` per week (`Week N of YYYY`) with a card per program: `.card-success` completed, `.card-warning` incomplete, `.card-pending` this week and not started, `.card-danger` skipped in a past week.
- `workouts-new` opens `dialog#new-workout-dialog` (`Select program`). Each `a.program-link` shows this week's status and `.last-completed-date`, and opens `/gymtime/?programId=`.
- `workouts-mode` opens `dialog#workout-mode-dialog` from `#week-progress`. Freestyle shows `Weekly workout goal` (1 to 7). A change saves to localStorage and reloads the page. In freestyle the calendar drops the per-program pending and skipped cards, and this week shows an empty `.open-slot` button (`Start a workout`, a `+`, the first one also labelled `Start`) per workout still to do toward the goal, which opens the program picker.

## How to get to it (user POV)

- Choose `Get started` on an empty home.
- Choose `Workouts` in the bottom nav.
- Choose `New` in the header (accessible name `Add new workout`).
- Choose a pending card to start a program, or a completed or incomplete card to open its workout (`?id=`).

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `02-workouts-empty` (Seed Database and onboarding intro), `05-workouts` (the progress card, then a week of pending cards above past completed weeks), `06-workouts-new-dialog`, `07-workouts-mode-dialog`.
- **By hand: status after a start.** From a seeded calendar, count `.card-pending`, click the first, start the workout with `Add set` on the first card, wait for the toast `Workout started.`, then `page.goBack()`. `.card-pending` is one fewer and `.card-warning` is visible.
- **By hand: freestyle.** Click `#week-progress`, check `getByRole('radio', { name: 'Freestyle' })`, wait for the reload. `#workout-mode-name` reads `Freestyle` and this week shows `Start a workout` `.open-slot` buttons up to the goal.

## Gotchas

- `Seed Database` checks raw rows, so a database whose only exercise was deleted shows no Seed button.
- `Restore from cloud` needs saved credentials. With the verification server's dead API it can only show its failure toast, `Failed to restore from cloud.`.
- Skipped cards (`.card-danger`) do not navigate.
- Changing the mode or the goal reloads the page. Wait for the reload before the next step.
