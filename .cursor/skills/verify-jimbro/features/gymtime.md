# Gymtime

Gymtime is the live session. The user saves workout details, logs sets, and dismisses the break timer.

## Sub-features

- `gymtime-open` loads `/gymtime/?programId=` from Workouts.
- `gymtime-save` writes a session and changes the URL to `/gymtime/?id=`.
- `gymtime-log-set` records reps and weight on an expanded exercise.
- `gymtime-break` opens `#break-countdown-dialog` after a finished set and closes on `Skip`.
- `gymtime-edit-set` opens `#edit-set-dialog` from a completed set.

## How to get to it (user POV)

- Choose a pending week card on Workouts.
- Choose a program in the New workout dialog.
- Open `/gymtime/?id=<session-id>` for an existing session.
- Choose an incomplete or completed week card to resume or view.

## Driving it with control-jimbro

Preconditions:

- Jimbro is healthy at the verification URL.
- Database is seeded as in `features/workouts.md`.
- A gymtime page is open with `?programId=` from the first `a.program-link` in the New workout dialog.

- **Save session.** Click `getByRole('button', { name: 'Save & start workout' })`. Toast contains `Workout session saved.` URL contains `id=` and no longer needs `programId` to identify the row.
- **Expand exercise.** Click `summary` on `details.exercise-details` first. `.next-set-form` is visible.
- **Log set.** Fill that form's `input[name="set-reps"]` with `10` and `input[name="set-weight"]` with `100`. Click `getByRole('button', { name: 'Finished set' })`.
- **Break timer.** `#break-countdown-dialog` is visible. Click `getByRole('button', { name: 'Skip' })` with `{ force: true }`. The dialog is hidden.
- **Completed set.** `.completed-sets .set.isCompleted` first contains `10` and `100`.
- **Edit set.** Click that completed set. `#edit-set-dialog` is visible. Fill `input[name="set-weight"]` with `105`. Click `Save`. The completed set's `.set-weight` contains `105`.
- **Proof.** Reload the `?id=` URL. The completed set still shows `105`. Screenshot the expanded exercise and the workouts calendar card which must be `.card-warning` or later `.card-success`. Capture ARIA of the exercise card.

## Gotchas

- Opening `/gymtime/` with no `programId` or `id` is an error state, not a session. Use Workouts to enter.
- The set list includes pending placeholders. Only `.set.isCompleted` opens the edit dialog.
- Skip on the break timer needs `{ force: true }` in Playwright. A normal click can miss the dialog.
- Geolocation may prompt for location. Ignore it. Location is optional.
- Completing every set in the program is a longer path (confetti, auto-export). Logging one set is enough to prove the core loop. Do not claim a full completion unless every exercise is filled.
- After save, prefer the `id` URL. Starting a second session with the same `programId` creates another row.
