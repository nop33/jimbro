import { test, expect } from '@playwright/test';

test.describe('Gymtime Page', () => {
  test.beforeEach(async ({ page }) => {
    // Reset database to ensure clean state
    await page.goto('/settings/');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset Database' }).click();
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset');

    // Seed DB
    await page.goto('/workouts/');
    await page.getByRole('button', { name: 'Seed Database' }).click();
    await expect(page.locator('.workout-week')).toBeVisible();

    // Go to new workout and start first program
    await page.getByRole('button', { name: 'New' }).click();
    const dialog = page.locator('dialog#new-workout-dialog');
    await expect(dialog).toBeVisible();

    await dialog.locator('a.program-link').first().click();

    // Make sure we are on gymtime page
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/);
  });

  test('Start workout, log set, and add exercise on the fly', async ({ page }) => {
    // 1. Start Workout Session
    await page.getByRole('button', { name: 'Save & start workout' }).click();

    // 2. Expand first exercise
    const firstExercise = page.locator('details.exercise-details').first();
    await firstExercise.click(); // Expand the details

    // Check form is visible
    const setForm = firstExercise.locator('.next-set-form');
    await expect(setForm).toBeVisible();

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').fill('10');
    await setForm.locator('input[name="set-weight"]').fill('100');

    // Using force click or locator because standard click seems to timeout sometimes if it thinks something overlays it
    await setForm.getByRole('button', { name: 'Finished set' }).click({ force: true });

    // 4. Wait for event to trigger break timer
    const breakTimer = page.locator('#break-countdown-dialog');
    await expect(breakTimer).toBeVisible();

    // Click "Skip" on break timer
    await breakTimer.getByRole('button', { name: 'Skip' }).click({ force: true });
    await expect(breakTimer).not.toBeVisible();
  });

  test('Break timer automatically closes when it reaches 0:00', async ({ page }) => {
    // 1. Start Workout Session
    await page.getByRole('button', { name: 'Save & start workout' }).click();

    // Install clock to manipulate time after start, or just wait for elements
    await page.clock.install();

    // 2. Expand first exercise
    const firstExercise = page.locator('details.exercise-details').first();
    await firstExercise.click(); // Expand the details

    const setForm = firstExercise.locator('.next-set-form');
    await expect(setForm).toBeVisible();

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').fill('10');
    await setForm.locator('input[name="set-weight"]').fill('100');
    await setForm.getByRole('button', { name: 'Finished set' }).click({ force: true });

    // 4. Wait for break timer dialog
    const breakTimer = page.locator('#break-countdown-dialog');
    await expect(breakTimer).toBeVisible();

    // 5. Fast forward time by 2 minutes and 30 seconds (timer default)
    // 2 minutes 30 seconds = 150000 ms.
    // The interval runs every 1 second (1000ms), we will advance time in ticks
    await page.waitForTimeout(500); // Wait for the dialog to open fully

    // Fast forward until the dialog closes or we hit a timeout.
    // By jumping in 1 second increments, we trigger setInterval callbacks.
    for (let i = 0; i < 160; i++) {
        await page.clock.fastForward(1000);
    }

    // 6. Verify that the break timer automatically closes
    await expect(breakTimer).not.toBeVisible();

    // Verify it was logged (completed sets wrapper should have a set now)
    const completedSetsList = firstExercise.locator('.completed-sets .set');
    await expect(completedSetsList.first()).toBeVisible();

    // 5. Edit the completed set
    await completedSetsList.first().click();

    const editSetDialog = page.locator('#edit-set-dialog');
    await expect(editSetDialog).toBeVisible();
    await editSetDialog.locator('input[name="set-weight"]').fill('105');
    await editSetDialog.getByRole('button', { name: 'Save' }).click();

    // Verify changes are saved (the weight span is inside the set)
    await expect(completedSetsList.first().locator('.set-weight')).toContainText('105');

    // 6. Add exercise on the fly
    const addExerciseCard = page.locator('#add-exercise-card');
    await addExerciseCard.scrollIntoViewIfNeeded();
    await addExerciseCard.click();

    const addExerciseDialog = page.locator('#add-exercise-dialog');
    await expect(addExerciseDialog).toBeVisible();

    // Select an exercise from the dialog list (it has class .card in the dialog)
    const dialogExercises = addExerciseDialog.locator('.card.card-hover');
    const firstDialogExercise = dialogExercises.first();
    const newExerciseName = await firstDialogExercise.locator('.exercise-name').textContent();

    // Click to add
    await firstDialogExercise.click();

    // Verify dialog closed
    await expect(addExerciseDialog).not.toBeVisible();

    // Verify it was added to our exercises list by checking for the name
    const exercisesList = page.locator('#exercises-list');
    await expect(exercisesList).toContainText(newExerciseName?.trim() || '');

    // 7. Test Swap Functionality
    // First, verify that an exercise with progress throws a warning
    // We will set up a handler to accept any dialogs
    let dialogMessage = '';
    page.once('dialog', dialog => {
      dialogMessage = dialog.message();
      dialog.dismiss(); // Cancel the swap that would cause progress loss
    });

    // Try to swap first exercise which has a logged set
    // Open the first exercise details first to make the button visible
    await firstExercise.click(); // Expand again to make sure it's open (sometimes clicking add closes it)
    const swapBtnFirst = firstExercise.locator('..').locator('.swap-workout-session-exercise-btn');
    await expect(swapBtnFirst).toBeVisible();
    await swapBtnFirst.click();
    expect(dialogMessage).toContain('lost progress');
    await firstExercise.click(); // Close again

    // Get the second exercise (since the first one has progress)
    const secondExercise = page.locator('details.exercise-details').nth(1);
    const secondExerciseCard = secondExercise.locator('..'); // Get parent card
    const oldExerciseName = await secondExerciseCard.locator('.exercise-name').textContent();

    // Open details to reveal swap button
    await secondExercise.click();

    const swapBtn = secondExerciseCard.locator('.swap-workout-session-exercise-btn');
    await expect(swapBtn).toBeVisible();
    await swapBtn.click(); // This shouldn't show a confirm dialog because no progress

    const swapDialog = page.locator('#add-exercise-dialog');
    await expect(swapDialog).toBeVisible();
    await expect(swapDialog.locator('h2')).toContainText('Swap exercise');

    // Select the second exercise in the dialog
    const dialogSecondExercise = swapDialog.locator('.card.card-hover').nth(1);
    const swapExerciseName = await dialogSecondExercise.locator('.exercise-name').textContent();
    await dialogSecondExercise.click();

    // Verify dialog closed
    await expect(swapDialog).not.toBeVisible();

    // Verify the exercise was swapped in the list
    await expect(exercisesList).not.toContainText(oldExerciseName?.trim() || '');
    await expect(exercisesList).toContainText(swapExerciseName?.trim() || '');

    // 8. Delete Session (Clean up)
    // Set up dialog handler for the delete confirmation
    page.once('dialog', async confirmDialog => {
      await confirmDialog.accept();
    });

    await page.locator('#delete-workout-session-btn').click();

    // Should navigate back to workouts
    await expect(page).toHaveURL(/.*\/workouts\//);
  });
});
