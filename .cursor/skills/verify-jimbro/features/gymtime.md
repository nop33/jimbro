# Gymtime

Gymtime is the live workout. The page opens on the program's exercises, and the first change the user makes starts the workout. The user logs sets on each exercise card, rests on the break timer, and edits, removes or reviews sets.

## Sub-features

- `gymtime-form` is `#workout-details`, collapsed, whose summary line (`Workout details`) shows the day (`#workout-date-label`: `Today`, `Yesterday` or `Oct 11`) and gym (`#workout-gym-label`, `No gym` when empty). Open, it has date (today at most), Gym (suggestions from gyms already used, prefilled from the latest workout, `Clear gym` button) and Notes. It has no submit: before the start the fields say what the start stores, and after it each change saves when the field is left.
- `gymtime-start` is the first change on the page: logging a set, `Add set`, removing a set to do, a menu action or adding an exercise. It creates the workout with the form's day, gym and notes, shows `Workout started.`, moves the URL to `?id=` and shows the header's `Delete`. Opening a program and leaving saves nothing.
- `gymtime-cards` shows one card per exercise with an `Exercise sets` section: set rows (`.set.isCompleted` logged, `.isPending` target), `Add set` (accent text on the `Exercise sets` row, inside the details so a closed card hides it), the next-set form with `Finished set` (and a `Max` pill on a weight prefilled with last time's heaviest), `Previous sets` (only when an earlier workout logged it) and `View History` (not for cardio).
- `gymtime-menu` is each card's `Actions for <name>` popover: Move up, Move down, Swap exercise, Delete exercise. Move buttons hide at the ends. Swap and Delete hide on a finished exercise and ask a confirm.
- `gymtime-break` opens `#break-countdown-dialog` after a lifting or cardio set that does not finish its exercise: `#sets-done`, `#countdown`, `Coming up`, `Minimize`, `View exercise history`, `Skip`. It closes itself 1.5 s after 0:00. Rehab sets never open it.
- `gymtime-set-menu` opens the card's `.set-menu` popover from a set to do (`Set N, to do`), with `Remove set N`, which removes one set to do. The rows are buttons only while more than one set is left to do and more than the sets logged, so an exercise keeps at least one set.
- `gymtime-edit-set` opens `#edit-set-dialog` from a logged set. Saving shows `Set updated.`. A 0 value asks a confirm. `Delete` confirms, shows `Set deleted.` and leaves the slot to do again.
- `gymtime-previous` opens `#last-set-dialog` (`Previous sets`, `in <gym> on <date>`).
- `gymtime-history` opens `#exercise-history-dialog`: a chart with toggles `Average weight`, `Estimated 1RM`, `Total volume`, and gym bands with a legend in `#exercise-history-gyms`.
- `gymtime-add` opens `#add-exercise-dialog` from `#add-exercise-card`, with a muscle filter. Adding an exercise already in the workout shows an alert. Swap reuses it titled `Swap exercise`.
- `gymtime-save-to-program` shows `#save-to-program-card` when the workout's exercises differ from the program's. It saves with the toast `Saved to program`.
- `gymtime-done` throws `Exercise done!` confetti when an exercise's last set is logged, and `Workout done!` when the workout's is, then downloads a JSON export when cloud backup is off.
- `gymtime-passkey-offer` is the `Back up your workouts` card (`#passkey-offer`, a region, not a dialog) under the exercises after `Workout done!`, where the browser has passkeys and no passkey backs the phone up. `Create passkey` signs up and shows `Passkey created. Your workouts are backing up.`. `Already have a passkey? Sign in` confirms when the phone holds data, signs in, shows `Signed in. Restoring your workouts.` and loads the page again after the sync. `Not now` hides it for 14 days.
- `gymtime-delete` is the header's `Delete`, shown once the workout has started. It confirms, shows `Workout session deleted` and returns to `/workouts/`.
- `gymtime-error` shows `Could not load workout. The program or session may no longer exist.` and `Back to workouts` for a missing or unknown `programId` or `id`.

## How to get to it (user POV)

- Choose a suggested pick on Home.
- Choose a pending card on Workouts, or a program in the New workout dialog.
- Choose an incomplete or completed card on Workouts to resume or view it (`?id=`).

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes. The tour imports a year of history first, so `Previous sets`, the history chart and gym suggestions have data.

- **Tour stops.** `20-gymtime-new` (summary line, cards before the start), `21-gymtime-details` (the details open), `22-gymtime-started` (Add set started it), `23-gymtime-card-open`, `24-gymtime-set-menu`, `25-break-timer`, `26-break-timer-minimized`, `27-edit-set-dialog`, `28-previous-sets-dialog`, `29-history-chart-dialog`, `30-gymtime-card-menu`, `31-add-exercise-dialog`, `32-gymtime-passkey-offer` (deletes all but the first exercise and logs its sets until `Workout done!`), `35-gymtime-error`.
- **By hand: a logged set persists.** After logging, reload the `?id=` URL and expand the card. The `.set.isCompleted` row still shows the values.
- **By hand: cardio and rehab.** Create a cardio or rehab exercise on `/exercises/`, add it with `#add-exercise-card`, and expand it. Cardio has `set-durationSec`, `set-speed` and `set-incline` inputs and no `View History`. A rehab set opens no break timer.

## Gotchas

- Open gymtime from Workouts or Home. `/gymtime/` with no `programId` or `id` is the error state.
- Only `.set.isCompleted` opens the edit dialog. An `.isPending` row opens the set menu, when it can be removed.
- The break timer closes itself after its countdown, so a slow step can miss `Skip`. The tour minimizes it instead.
- Completing every set of a workout downloads a JSON file. Handle the download, or log fewer sets.
- The passkey offer's `Create passkey` needs a passkey the browser can make: WebAuthn refuses the IP address origin `127.0.0.1`, and the verification server's API is dead. The tour only shows the card here, and signs up on `localhost` in `33-settings-passkey`.
- After the start, keep using the `?id=` URL. Opening the same `programId` again and changing anything starts another workout.
- Never force a click. A click that needs force means something covers the control, which is a finding.
