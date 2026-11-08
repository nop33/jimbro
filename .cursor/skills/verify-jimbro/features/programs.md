# Programs

Programs are workout templates: a name and an ordered list of exercises. The programs page lists them, and each program has a page of its own at `/programs/program/?id=<id>`, where every change saves as it is made.

## Sub-features

- `program-list` shows one `#programs-grid .program-card` per program: a link to its page with the name, `N exercises · N sets` and a chip per muscle group. An empty grid shows no message.
- `program-new` (tour stop `program-new-dialog`): `New` opens `dialog#new-program-dialog`, which asks only for a name and opens on it. `Create` stores the program and opens its page on the exercise picker.
- `program-page` shows the program's name as the page heading, `Start this program` (a link to `/gymtime/?programId=<id>`, hidden while the program has no exercises), the exercises in order in `#program-exercises`, `Add exercises`, `Rename` and `Delete program`. A program that is gone shows `This program was deleted.`.
- `program-reorder` drags a row by its handle (`Reorder <exercise>`), by mouse or touch, or moves it one place with the up and down arrow keys on the handle. The rest of the row scrolls the page. The order saves on drop.
- `program-remove`: `Remove <exercise>` asks `Remove <exercise> from this program?` and takes it out of the program on OK.
- `program-add` opens the exercise picker, `dialog#exercise-picker` (`partials/exercise-picker.html`, shared with gymtime), a full-height sheet with `Search exercises`, a sideways-scrolling row of filter chips (the radiogroup `Show`: `All`, then a chip per section) and a checklist by section: lifts under their muscle in alphabetical order, then `Rehab` (each row names its muscle) and `Cardio`, names in alphabetical order. A chip and the search filter together. The chips hide when there is one section. The program's exercises show ticked, greyed and disabled, with `In program`. The button counts the checked ones (`Add 2 exercises`), and they join the program's end in the order checked.
- `program-rename` (tour stop `program-rename-dialog`) opens `dialog#rename-program-dialog` on its name, selected.
- `program-delete` confirms, then goes back to `/programs/` with `Program deleted.`.

## How to get to it (user POV)

- Choose `Programs` in the bottom nav, then a program.
- Choose `New` in the programs header.

## Driving it with control-jimbro

Preconditions: `control-jimbro doctor` passes.

- **Tour stops.** `12-programs` (the list), `13-program-new-dialog` (New, on its empty name), `14-program-page` (the first imported program), `15-program-rename-dialog`, `16-program-add-exercises` (the picker with one more exercise checked).
- **By hand: create.** Create an exercise on `/exercises/` and wait until it is stored. On `/programs/` click `New`, fill `getByLabel('Name', { exact: true })`, click `Create`, check the exercise in `#exercise-picker` with `getByLabel('<exercise>')`, and click `Add 1 exercise`.
- **By hand: reorder.** Drag `getByRole('button', { name: 'Reorder <exercise>' })` with `page.mouse` above another row, or press `ArrowUp` on it, then reload and read `#program-exercises .program-row-name`.
- **By hand: delete.** Register `page.once('dialog', d => d.accept())` and click `Delete program`.

## Gotchas

- A drag moves the neighbouring rows, not the dragged one, so the handle keeps the pointer capture. A locator `dragTo` works, but `page.mouse` with steps is closer to a finger.
- In the picker, read names from `.exercise-choice-name`: a row's text also holds its `In program` or `In workout` note and, for rehab, its muscle, so a rehab checkbox's label is `<name> <muscle>`.
- An exercise's card on `/exercises/` shows before the exercise is stored, so wait for the stored row (or its toast) before opening a program.
