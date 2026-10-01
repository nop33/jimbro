# Programs

Programs lets a user name a workout template, attach exercises, and delete the template.

## Sub-features

- `program-open` opens the program dialog from `New` and from a card's edit control.
- `program-save` persists a name and at least one selected exercise.
- `program-edit` renames a saved program from the card.
- `program-delete` removes the card after the native confirm dialog.

## How to get to it (user POV)

- Choose `Programs` in the bottom nav.
- Open `/programs/` directly.
- Choose `New` in the programs header.

## Driving it with control-jimbro

Preconditions:

- Jimbro is healthy at the verification URL.
- IndexedDB is empty, then one exercise exists named `Squat` (Quads, 4 sets, 8 reps) created through the Exercises user path.
- No program is titled `Leg Day`.

- **Create the exercise first.** Follow `features/exercises.md` `exercise-save` with name `Squat`, muscle `Quads`, sets `4`, reps `8`. Confirm the card on `/exercises/` before leaving.
- **Open programs.** `page.goto('/programs/')`. Heading is `Programs`.
- **Open then cancel.** Click `getByRole('button', { name: 'New' })`. `dialog#program-dialog` is visible. Click `getByRole('button', { name: 'Close dialog' })`. The dialog is hidden.
- **Create.** Open `New` again. Fill `getByLabel('Name', { exact: true })` with `Leg Day`. Select `#exercises-selection` option label `Squat`. Click `getByRole('button', { name: 'Save' })`. Locator `.card` with text `Leg Day` is visible and contains `Squat`.
- **Edit.** Click `button.link-primary` on that card (pencil). Fill Name with `Mega Leg Day`. Save. The card contains `Mega Leg Day`.
- **Delete.** Open edit again. Register `page.once('dialog', d => d.accept())`. Click `#delete-program-btn`. The card is gone.
- **Proof.** After create, reload `/programs/` and confirm `Leg Day` still lists `Squat`. Screenshot plus ARIA of the grid.

## Gotchas

- A program cannot be proven without an exercise in the library. Seeded programs from Workouts are a different path.
- Playwright often fails to select `<select>` options inside optgroups by value. Use `{ label: 'Squat' }` on `#exercises-selection`.
- Name uses `{ exact: true }` because other labels exist on the page.
- The edit control is the pencil `button.link-primary` on the card, not the card body.
- Wait for the exercise write to finish before opening Programs. The exercises spec uses a short pause after Save if the program dialog's select is empty.
