# Exercises

Exercises lets a user create, edit, filter, and soft-delete exercises in the library.

## Sub-features

- `exercise-open` opens the exercise dialog from `New` and from an existing card.
- `exercise-save` persists name, muscle group, default sets, and default reps.
- `exercise-filter` hides cards that do not match `Filter by muscle group`.
- `exercise-delete` removes the card after the native confirm dialog.
- `exercise-cancel` closes the dialog without saving.

## How to get to it (user POV)

- Choose `Exercises` in the bottom nav.
- Open `/exercises/` directly.
- Choose `New` in the exercises header.

## Driving it with control-jimbro

Preconditions:

- Jimbro is healthy at the verification URL.
- IndexedDB is empty. Reset through Settings if a reused browser profile left data.
- No card is titled `Bench Press`.

- **Run it.** `control-jimbro drive exercises` runs the steps below and writes `artifacts/<device>/exercises/`.
- **Open library.** `page.goto('/exercises/')`. Heading is `Exercises`.
- **Open then cancel.** Click `getByRole('button', { name: 'New' })`. `dialog#exercise-dialog` is visible. Click `getByRole('button', { name: 'Close dialog' })`. The dialog is hidden.
- **Create.** Open `New` again. Fill `getByLabel('Name')` with `Bench Press`. Select `getByLabel('Muscle group', { exact: true })` option `Chest`. Fill `getByLabel('Default sets')` with `3` and `getByLabel('Default reps')` with `10`. Click `getByRole('button', { name: 'Save' })`. Locator `.card` with text `Bench Press` is visible and contains `Chest` and `3 sets × 10 reps`.
- **Edit.** Click that card. The same dialog opens. Fill `Default reps` with `8`. Save. The card contains `3 sets × 8 reps`.
- **Filter.** `getByLabel('Filter by muscle group')` set to `Back` hides the card. Set to `Chest` shows it again.
- **Delete.** Click the card. Register `page.once('dialog', d => d.accept())`. Click `#delete-exercise-btn`. The `Bench Press` card is gone.
- **Proof.** Reload `/exercises/` after create and confirm the card is still there before editing. After the delete, the `exercises` store holds the row with `isDeleted: true`. Evidence: `after-edit.png` and `after-delete.png` with their ARIA.

## Gotchas

- Muscle group uses `{ exact: true }` because the filter label also contains those words.
- Register the confirm handler before clicking delete. A missed handler hangs the page.
- Filter `All` is the default after reset. A leftover filter from an earlier run hides a just-created card.
- An empty grid has no empty-state text, so a reload after deleting the last exercise has nothing to wait for. Prove the delete from the stored row.
- Soft-delete hides the row. A later import of the same id can collide if you skip Settings reset.
