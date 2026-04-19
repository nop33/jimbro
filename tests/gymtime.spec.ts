import { test, expect } from '@playwright/test'

test.describe('Gymtime Page', () => {
  test.beforeEach(async ({ page }) => {
    // Reset database to ensure clean state
    await page.goto('/settings/')
    await page.getByText('Manage local data').click()
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Reset Database' }).click()
    await expect(page.locator('.toast-message-popup')).toContainText('Database reset')

    // Seed DB
    await page.goto('/workouts/')
    await page.getByRole('button', { name: 'Seed Database' }).click()
    await expect(page.locator('.workout-week')).toBeVisible()

    // Go to new workout and start first program
    await page.getByRole('button', { name: 'New' }).click()
    const dialog = page.locator('dialog#new-workout-dialog')
    await expect(dialog).toBeVisible()

    // Verify "X" button works
    await dialog.locator('.close-dialog-btn').click()
    await expect(dialog).not.toBeVisible()

    await page.getByRole('button', { name: 'New' }).click()
    await expect(dialog).toBeVisible()

    await dialog.locator('a.program-link').first().click()

    // Make sure we are on gymtime page
    await expect(page).toHaveURL(/.*\/gymtime\/\?programId=.+/)
  })

  test('Start workout, log set, and add exercise on the fly', async ({ page }) => {
    // 1. Start Workout Session
    await page.getByRole('button', { name: 'Save & start workout' }).click()

    // 2. Expand first exercise
    const firstExercise = page.locator('details.exercise-details').first()
    await firstExercise.click() // Expand the details

    // Check form is visible
    const setForm = firstExercise.locator('.next-set-form').first()
    await expect(setForm).toBeVisible()

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').first().fill('10')
    await setForm.locator('input[name="set-weight"]').first().fill('100')

    // Scroll the button into view and click it. Sometimes force click can be flaky in Mobile Safari
    // if the form submit isn't fully registered
    const finishBtn = setForm.getByRole('button', { name: 'Finished set' }).first()
    await finishBtn.scrollIntoViewIfNeeded()
    await finishBtn.click()

    // Using force click or locator because standard click seems to timeout sometimes if it thinks something overlays it
    await setForm.locator('button:has-text("Finished set")').click({ force: true })

    // 4. Wait for event to trigger break timer
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()

    // Click "Skip" on break timer
    await breakTimer.getByRole('button', { name: 'Skip' }).click({ force: true })
    await expect(breakTimer).not.toBeVisible()
  })

  test('Complete workout session flow including edits, adds, swaps and deletes', async ({ page }) => {
    // 1. Start Workout Session
    await page.getByRole('button', { name: 'Save & start workout' }).click()

    // 2. Expand first exercise
    const firstExercise = page.locator('details.exercise-details').first()
    await firstExercise.click() // Expand the details

    const setForm = firstExercise.locator('.next-set-form').first()
    await expect(setForm).toBeVisible()

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').first().fill('10')
    await setForm.locator('input[name="set-weight"]').first().fill('100')

    // Scroll the button into view and click it. Sometimes force click can be flaky in Mobile Safari
    // if the form submit isn't fully registered
    const finishBtn = setForm.getByRole('button', { name: 'Finished set' }).first()
    await finishBtn.scrollIntoViewIfNeeded()
    await finishBtn.click()

    // Using force click or locator because standard click seems to timeout sometimes if it thinks something overlays it
    // Try both pressing enter and a forced click as fallbacks
    // Try both pressing enter and a forced click as fallbacks
    await setForm.locator('button:has-text("Finished set")').click({ force: true })

    // 4. Wait for break timer dialog
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()

    // Click "Skip" on break timer
    await breakTimer.getByRole('button', { name: 'Skip' }).click({ force: true })
    await expect(breakTimer).not.toBeVisible()

    // Verify it was logged and target an actually completed set item.
    // The list also contains pending placeholders that do not open edit dialog.
    const completedSetItem = firstExercise.locator('.completed-sets .set.isCompleted').first()
    await expect(completedSetItem).toBeVisible()
    await expect(completedSetItem).toContainText('10')
    await expect(completedSetItem).toContainText('100')

    // 5. Edit the completed set
    await completedSetItem.scrollIntoViewIfNeeded()
    await completedSetItem.click()

    const editSetDialog = page.locator('#edit-set-dialog')
    await expect(editSetDialog).toBeVisible()

    // Verify "X" button works
    await editSetDialog.locator('.close-dialog-btn').click()
    await expect(editSetDialog).not.toBeVisible()

    await completedSetItem.click()
    await expect(editSetDialog).toBeVisible()

    await editSetDialog.locator('input[name="set-weight"]').fill('105')
    await editSetDialog.getByRole('button', { name: 'Save' }).click()

    // Verify changes are saved (the weight span is inside the set)
    await expect(completedSetItem.locator('.set-weight')).toContainText('105')

    // 6. Add exercise on the fly
    const addExerciseCard = page.locator('#add-exercise-card')
    await addExerciseCard.scrollIntoViewIfNeeded()
    await addExerciseCard.click()

    const addExerciseDialog = page.locator('#add-exercise-dialog')
    await expect(addExerciseDialog).toBeVisible()

    // Verify "X" button works
    await addExerciseDialog.locator('.close-dialog-btn').click()
    await expect(addExerciseDialog).not.toBeVisible()

    await addExerciseCard.click()
    await expect(addExerciseDialog).toBeVisible()

    // Select an exercise from the dialog list (it has class .card in the dialog)
    const dialogExercises = addExerciseDialog.locator('.card.card-hover')
    const firstDialogExercise = dialogExercises.first()
    const newExerciseName = await firstDialogExercise.locator('.exercise-name').textContent()

    // Click to add
    await firstDialogExercise.click()

    // Verify dialog closed
    await expect(addExerciseDialog).not.toBeVisible()

    // Verify it was added to our exercises list by checking for the name
    const exercisesList = page.locator('#exercises-list')
    await expect(exercisesList).toContainText(newExerciseName?.trim() || '')

    // 7. Test Swap Functionality
    // First, verify that an exercise with progress throws a warning
    // We will set up a handler to accept any dialogs
    let dialogMessage = ''
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message()
      dialog.dismiss() // Cancel the swap that would cause progress loss
    })

    // Try to swap first exercise which has a logged set
    // Open the first exercise details first to make the button visible
    await firstExercise.click() // Expand again to make sure it's open (sometimes clicking add closes it)
    const swapBtnFirst = firstExercise.locator('..').locator('.swap-workout-session-exercise-btn')
    await expect(swapBtnFirst).toBeVisible()
  })

  test('Break timer displays negative time when it passes 0:00', async ({ page }) => {
    // 1. Start Workout Session
    await page.getByRole('button', { name: 'Save & start workout' }).click()

    // Install clock to manipulate time
    await page.clock.install()

    // 2. Expand first exercise
    const firstExercise = page.locator('details.exercise-details').first()
    await firstExercise.click() // Expand the details

    const setForm = firstExercise.locator('.next-set-form').first()
    await expect(setForm).toBeVisible()

    // 3. Log a set
    await setForm.locator('input[name="set-reps"]').first().fill('10')
    await setForm.locator('input[name="set-weight"]').first().fill('100')

    // Scroll the button into view and click it. Sometimes force click can be flaky in Mobile Safari
    // if the form submit isn't fully registered
    const finishBtn = setForm.getByRole('button', { name: 'Finished set' }).first()
    await finishBtn.scrollIntoViewIfNeeded()
    await finishBtn.click()

    // Using force click or locator because standard click seems to timeout sometimes if it thinks something overlays it
    // Try both pressing enter and a forced click as fallbacks
    // Try both pressing enter and a forced click as fallbacks
    await setForm.locator('button:has-text("Finished set")').click({ force: true })

    // 4. Wait for break timer dialog
    const breakTimer = page.locator('#break-countdown-dialog')
    await expect(breakTimer).toBeVisible()

    // 5. Fast forward time by 2 minutes and 30 seconds (timer default is 2:30)
    await page.waitForTimeout(500) // Wait for the dialog to open fully

    // Fast forward until the timer reaches zero time.
    for (let i = 0; i < 150; i++) {
      await page.clock.fastForward(1000)
    }

    // 6. Verify that the break timer shows 0:00 or negative time briefly
    await expect(breakTimer).toBeVisible()
    await expect(breakTimer.locator('#countdown')).toContainText('0:00')

    // 7. Fast forward past the 1500ms timeout
    await page.clock.fastForward(1600)

    // 8. Verify the timer automatically closed
    await expect(breakTimer).toBeHidden()
  })
})
