# Workouts

Workouts is the weekly calendar. An empty database offers seeding. Cards start a session or resume one.

## Sub-features

- `workouts-empty` shows `Seed Database` when no programs exist.
- `workouts-seed` replaces that button with `.workout-week` rows after seed.
- `workouts-new` opens `dialog#new-workout-dialog` and lists programs.
- `workouts-start` follows a program link to `/gymtime/?programId=`.
- `workouts-status` turns a pending card into an incomplete card after a session is saved.

## How to get to it (user POV)

- Choose `Start workout` on home.
- Choose `Workouts` in the bottom nav.
- Open `/workouts/` directly.
- Choose `New` in the workouts header.
- Choose a pending or incomplete week card.

## Driving it with control-jimbro

Preconditions:

- Jimbro is healthy at the verification URL.
- IndexedDB is empty (Settings reset).

- **Empty state.** `page.goto('/workouts/')`. `getByRole('button', { name: 'Seed Database' })` is visible. `.workout-week` is not.
- **Seed.** Click `Seed Database`. The page reloads. `.workout-week` is visible. `Seed Database` is gone. Week cards include `Push day`, `Pull day`, and `Legs day`.
- **New workout.** Click `getByRole('button', { name: 'New' })`. `dialog#new-workout-dialog` is visible. Close with `getByRole('button', { name: 'Close dialog' })`, then reopen.
- **Start from dialog.** Click `dialog#new-workout-dialog` locator `a.program-link` first. URL matches `/gymtime/?programId=`. Header title is a seeded program name.
- **Pending card.** From `/workouts/` after seed, click `.card-pending` first. URL matches `/gymtime/?programId=`.
- **Status after save.** On gymtime, click `getByRole('button', { name: 'Save & start workout' })`. Toast contains `Workout session saved.` Navigate back to `/workouts/`. `.workout-week` is visible. Count of `.card-pending` is one less than before. `.card-warning` is visible.
- **Proof.** Screenshot the seeded week list and the week list after the incomplete session. Record pending counts in `proof.txt`.

## Gotchas

- `Seed Database` exists only on an empty database. A leftover seed from the Cursor browser profile skips the empty-state proof.
- The New control's accessible name is `Add new workout`. Playwright `name: 'New'` still matches.
- Skipped cards (`.card-danger`) do not navigate. Do not use them as a start entry.
- `page.goBack()` after gymtime is the path the workouts spec uses. A fresh `goto('/workouts/')` also works and is clearer if history is empty.
- Status classes: pending `.card-pending`, incomplete `.card-warning`, completed `.card-success`, skipped `.card-danger`.
