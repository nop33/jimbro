# Programs

Programs are workout templates: a name and an ordered list of exercises. The user creates, reorders, renames and deletes them.

## Sub-features

- `program-list` shows one `#programs-grid > .card` per program with a pencil `.edit-program-btn` and a collapsed `Program exercises` section. Expanding it lists the exercises as condensed cards in program order, with their prescription. An empty grid shows no message.
- `program-new` opens `dialog#program-dialog` titled `New Program`: Name, the picker `#exercises-selection` (grouped by muscle, Cardio for none) and the `Reorder program exercises` list. The empty form opens on Name.
- `program-reorder` drags rows of `#selected-exercises-list` by mouse or touch. The saved order is the order the card shows.
- `program-save` saves with `Program saved!`. Only Name is required, so a program with no exercises saves.
- `program-edit` opens the dialog titled `Edit Program`, prefilled, with `Delete` on the left of `Save` (a new program has none, and there is no `Cancel`), and focuses its title, not a field.
- `program-delete` confirms, removes the card and shows `Program deleted.`.
- `program-cancel` closes the dialog with `Close dialog` or Escape.

## How to get to it (user POV)

- Choose `Programs` in the bottom nav.
- Choose `New` in the programs header.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `12-programs`, `13-programs-expanded`, `14-program-dialog` (an imported program in `Edit Program`, with its reorder list).
- **By hand: create, rename, delete.** Create an exercise on `/exercises/` and wait for `Exercise saved!`. On `/programs/` click `New`, fill `getByLabel('Name', { exact: true })`, `selectOption({ label: '<exercise>' })` on `#exercises-selection`, Save, and wait for `Program saved!`. Click the card's `.edit-program-btn` to rename. To delete, register `page.once('dialog', d => d.accept())` and click the dialog's `Delete` button.
- **By hand: reorder.** With two exercises selected, drag the second row above the first, Save, reload, expand the card, and check the order of `.exercise-name`.

## Gotchas

- Match the program card with `#programs-grid > .card`. A bare `.card` also matches the condensed exercise cards inside an expanded program.
- The pencil button has no accessible name. Use `.edit-program-btn`, and scope `Delete` to `#program-dialog`.
- Select options inside optgroups by label: `{ label: 'Squat' }`.
- The collapsed card still contains its exercises' text, so `toContainText` passes without expanding it. Expand it to prove what a user sees.
- Wait for the `Exercise saved!` toast before opening Programs, so the picker lists the new exercise.
