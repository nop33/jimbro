import { account } from '../../sync/account'
import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import { storage } from '../../db/storage'
import { firstSyncDue } from '../../sync/queue'
import { passkeysSupported, preparePasskey, signInWithPasskey } from '../../sync/passkeys'
import { sync } from '../../sync/syncClient'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { getSimpleDate } from '../../dateUtils'
import renderIntroText from './IntroText'
import NewWorkoutDialog from './NewWorkoutDialog'
import WorkoutModeDialog from './WorkoutModeDialog'
import renderWeekProgress from './WeekProgress'
import { calendarLabels, calendarWeeks } from './calendar'
import { renderWorkoutCalendar } from './WorkoutCalendar'
import { redraw, redrawOnNewDay } from '../../redraw'
import { isDbEmpty } from '../../db/utils'
import Toasts from '../../features/toasts'
import { getWorkoutModeSettings } from '../../settings'
import { trainingWeeks } from '../../weeks'
import { whileBusy } from '../busyButton'
import { confirmSignIn, showPasskeyFailure } from '../passkeyPrompts'

export const mount = async (signal: AbortSignal) => {
  const workoutWeeksContainer = document.getElementById('workout-weeks') as HTMLDivElement

  const [sessions, programs] = await Promise.all([workoutSessionsStore.getAll(), programsStore.load()])
  const programNames = Object.fromEntries(programs.map((program) => [program.id, program.name]))
  const empty = await isDbEmpty()
  const canRestore = empty && account.current() !== null && (await firstSyncDue(storage))
  const settings = getWorkoutModeSettings()
  const today = getSimpleDate(new Date())
  const { goal, weeks, programs: programStatuses } = trainingWeeks(sessions, programs, settings, today)
  const [thisWeek] = weeks

  if (programs.length > 0) {
    renderWeekProgress({
      completed: thisWeek.completed,
      ahead: thisWeek.ahead.length,
      extra: thisWeek.extra.length,
      goal,
      settings
    })
  } else {
    await renderIntroText(canRestore ? 'restore' : empty ? 'seed' : 'none')
  }
  new NewWorkoutDialog(programStatuses)
  new WorkoutModeDialog()

  if (empty) {
    if (canRestore) {
      const restoreButton = document.createElement('button')
      restoreButton.classList.add('btn-primary', 'mx-auto')
      restoreButton.textContent = 'Restore from cloud'
      restoreButton.addEventListener('click', async () => {
        try {
          await whileBusy(restoreButton, 'Restoring…', () => sync({ again: false }))
          await redraw()
        } catch (error) {
          console.error('Error restoring from cloud:', error)
          Toasts.show({ message: 'Failed to restore from cloud.', type: 'error' })
        }
      })
      workoutWeeksContainer.appendChild(restoreButton)
    } else {
      const seedDbButton = document.createElement('button')
      seedDbButton.classList.add('btn-primary', 'mx-auto')
      seedDbButton.textContent = 'Start with the 3-day split'
      seedDbButton.addEventListener('click', async () => {
        try {
          await exercisesStore.seed()
          await programsStore.seed()
          await redraw()
        } catch (error) {
          console.error('Error seeding database:', error)
          Toasts.show({ message: 'Could not add the 3-day split.', type: 'error' })
        }
      })
      workoutWeeksContainer.appendChild(seedDbButton)

      // A returning user on a new phone signs in with the passkey the phone's password manager brought along, and the
      // sign-in's first sync restores their workouts.
      if (passkeysSupported()) {
        const signInButton = document.createElement('button')
        signInButton.classList.add('btn-secondary', 'mx-auto', '-mt-3')
        signInButton.textContent = 'Sign in with passkey'
        // The tap goes straight to the passkey sheet, with options fetched as the button shows.
        preparePasskey('signin', signal)
        // The sign-in restores the account before it resolves, and the sync after it pushes what only this phone has.
        signInButton.addEventListener('click', () =>
          whileBusy(
            signInButton,
            'Signing in…',
            async () => {
              try {
                if (!(await signInWithPasskey({ confirmSignIn }))) return
              } catch (error) {
                showPasskeyFailure(error)
                return
              }
              try {
                await sync({ again: false })
                await redraw()
              } catch (error) {
                console.error('Error restoring from cloud:', error)
                Toasts.show({ message: 'Failed to restore from cloud.', type: 'error' })
              }
            },
            [seedDbButton]
          )
        )
        workoutWeeksContainer.appendChild(signInButton)
      }
    }
  } else {
    const calendar = document.getElementById('workout-calendar') as HTMLElement
    renderWorkoutCalendar(
      calendar.querySelector('#calendar-weeks') as HTMLOListElement,
      calendarWeeks(weeks, goal, today),
      goal,
      programNames,
      calendarLabels(programs)
    )
    calendar.hidden = false
  }

  // The calendar is drawn once, so a new day draws it again. A restore or a changed workout mode redraws it right away.
  redrawOnNewDay(today, signal)
}
