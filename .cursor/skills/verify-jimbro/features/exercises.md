# Exercises

Exercises is the library. The user creates, edits, filters and deletes exercises of three kinds: lifting, rehab and cardio.

## Sub-features

- `exercise-list` shows one card per exercise: name, muscle badge (or `Cardio`), a `Rehab` badge for rehab, and a prescription such as `3 sets × 10 reps`, `3 sets × 30s hold` or `1 set`. An empty library is an empty grid with no message.
- `exercise-new` opens `dialog#exercise-dialog` titled `New Exercise` with Name, Kind, Muscle group, Default sets and Default reps. The empty form opens on Name, so the keyboard comes up.
- `exercise-kinds` changes the form by Kind: Rehab shows `Log as` (Reps or Hold, Hold asking `Default hold (sec)`). Cardio hides Muscle group and the defaults.
- `exercise-save` saves and shows `Exercise saved!`. Empty required fields keep the dialog open with the browser's validation.
- `exercise-edit` opens the same dialog titled `Edit Exercise`, prefilled, with a trash button `#delete-exercise-btn`. The focus goes to the title, not a field, so no keyboard covers the form.
- `exercise-filter` filters by `Filter by muscle group`. A muscle filter hides cardio, which has no muscle.
- `exercise-delete` confirms, soft-deletes the row and shows `Exercise deleted.`.
- `exercise-cancel` closes the dialog with `Close dialog`, `Cancel` or Escape, saving nothing.

## How to get to it (user POV)

- Choose `Exercises` in the bottom nav.
- Choose `New` in the exercises header.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `08-exercises` (the library), `09-exercise-dialog-edit`, `10-exercise-dialog-new-cardio`, `11-exercise-dialog-new-rehab`.
- **By hand: create, edit, delete.** Click `New`, fill `getByLabel('Name')`, choose `getByLabel('Muscle group', { exact: true })`, fill `Default sets` and `Default reps`, Save. Wait for `Exercise saved!` and the card. Reload and click the card: the title is `Edit Exercise`. Register `page.once('dialog', d => d.accept())`, click `#delete-exercise-btn`, and wait for `Exercise deleted.`.
- **Proof of a delete.** The grid has no empty state to wait for, so read the `exercises` store: the row has `isDeleted: true`.

## Gotchas

- Muscle group needs `{ exact: true }` because the filter's label contains the same words.
- The trash and the delete button have no accessible name. Use `#delete-exercise-btn`.
- Register the confirm handler before clicking delete. A missed handler hangs the page.
- The filter starts on `Select muscle group...`, which shows everything, and is not remembered across loads.
- Seeded exercises are all lifting. Cardio and rehab need one created here.
