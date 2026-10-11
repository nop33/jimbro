# Workouts

Workouts is the calendar of training weeks. An empty database offers seeding. Week cards start, resume or show a workout, and a mode badge switches between rotation and freestyle.

## Sub-features

- `workouts-empty` shows `Seed Database` when the database has no exercise and no program rows, deleted ones included. The `#intro` text then offers a 3-day split.
- `workouts-intro` shows an `#intro` text for each state: onboarding, `Create a program from your exercises to start a workout.` (exercises only), workouts left this week, all done, or none done yet.
- `workouts-restore` shows `Restore from cloud` instead of `Seed Database` when the database is empty, cloud credentials are saved and the database has never synced.
- `workouts-weeks` shows one `.workout-week` per week (`Week N of YYYY`) with a card per program: `.card-success` completed, `.card-warning` incomplete, `.card-pending` this week and not started, `.card-danger` skipped in a past week.
- `workouts-new` opens `dialog#new-workout-dialog` (`Select program`). Each `a.program-link` shows this week's status and `.last-completed-date`, and opens `/gymtime/?programId=`.
- `workouts-mode` opens `dialog#workout-mode-dialog` from `#workout-mode-badge` (`Rotation` or `Freestyle (N/wk)`). Freestyle shows `Weekly workout goal` (1 to 7). A change saves to localStorage and reloads the page. In freestyle the calendar drops pending and skipped placeholders.

## How to get to it (user POV)

- Choose `Get started` on an empty home.
- Choose `Workouts` in the bottom nav.
- Choose `New` in the header (accessible name `Add new workout`).
- Choose a pending card to start a program, or a completed or incomplete card to open its workout (`?id=`).

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `02-workouts-empty` (Seed Database and onboarding intro), `05-workouts` (a week of pending cards above past completed weeks), `06-workouts-new-dialog`, `07-workouts-mode-dialog`.
- **By hand: status after a start.** From a seeded calendar, count `.card-pending`, click the first, click `Save & start workout`, wait for the toast `Workout session saved.`, then `page.goBack()`. `.card-pending` is one fewer and `.card-warning` is visible.
- **By hand: freestyle.** Click `#workout-mode-badge`, check `getByRole('radio', { name: 'Freestyle' })`, wait for the reload. The badge reads `Freestyle (3/wk)` and no `.card-pending` shows.

## Gotchas

- `Seed Database` checks raw rows, so a database whose only exercise was deleted shows no Seed button.
- `Restore from cloud` needs saved credentials. With the verification server's dead API it can only show its failure toast, `Failed to restore from cloud.`.
- Skipped cards (`.card-danger`) do not navigate.
- Changing the mode or the goal reloads the page. Wait for the reload before the next step.
