import { account } from '../../sync/account'
import { exercisesStore } from '../../db/stores/exercisesStore'
import { programsStore } from '../../db/stores/programsStore'
import { storage } from '../../db/storage'
import { firstSyncDue } from '../../sync/queue'
import { passkeysSupported, preparePasskey, signInWithPasskey } from '../../sync/passkeys'
import { sync } from '../../sync/syncClient'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import type { WorkoutSession } from '../../db/types'
import { nodeFromTemplate, setTextContent } from '../../utils'
import { getSimpleDate, parseSimpleDate } from '../../dateUtils'
import renderIntroText from './IntroText'
import NewWorkoutDialog from './NewWorkoutDialog'
import WorkoutModeDialog from './WorkoutModeDialog'
import renderWeekProgress from './WeekProgress'
import { redraw, redrawOnNewDay } from '../../redraw'
import { isDbEmpty } from '../../db/utils'
import Toasts from '../../features/toasts'
import { getWorkoutModeSettings } from '../../settings'
import { trainingWeeks } from '../../weeks'
import { whileBusy } from '../busyButton'
import { confirmSignIn, showPasskeyFailure } from '../passkeyPrompts'

// A rotation program the week has no workout of: still to do this week, or skipped in an earlier one.
interface MissingWorkout {
  programId: WorkoutSession['programId']
  status: 'pending' | 'skipped'
  id?: undefined
  date?: undefined
}

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
    renderWeekProgress({ completed: thisWeek.completed, goal, settings })
  } else {
    await renderIntroText(canRestore ? 'restore' : empty ? 'seed' : 'none')
  }
  const newWorkoutDialog = new NewWorkoutDialog(programStatuses)
  new WorkoutModeDialog()

  const renderWorkoutSession = (workoutSession: WorkoutSession | MissingWorkout) => {
    const workoutItemTemplate = nodeFromTemplate('#workout-item-template')
    const workoutStatus = workoutItemTemplate.querySelector('.workout-status') as HTMLParagraphElement
    const workoutDate = workoutItemTemplate.querySelector('.workout-date') as HTMLParagraphElement

    setTextContent('.workout-title', programNames[workoutSession.programId], workoutItemTemplate)

    if (workoutSession.status !== 'completed') {
      setTextContent('.workout-status', workoutSession.status, workoutItemTemplate)

      if (workoutSession.status === 'incomplete') {
        workoutStatus.classList.add('text-jim-warning')
      } else if (workoutSession.status === 'skipped') {
        workoutStatus.classList.add('text-jim-error')
      }
    }

    if (workoutSession.date) {
      const dateObj = parseSimpleDate(workoutSession.date)
      const formattedDate = dateObj.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      })
      setTextContent('.workout-date', formattedDate, workoutItemTemplate)
    } else {
      workoutDate.remove()
    }

    const workoutItemDiv = workoutItemTemplate.querySelector('div') as HTMLDivElement
    workoutItemDiv.classList.add(
      {
        completed: 'card-success',
        skipped: 'card-danger',
        incomplete: 'card-warning',
        pending: 'card-pending'
      }[workoutSession.status]
    )

    if (workoutSession.status === 'incomplete') {
      workoutItemDiv.classList.add('border-dashed')
    }

    if (workoutSession.status !== 'skipped') {
      workoutItemDiv.addEventListener('click', () => {
        window.location.href =
          workoutSession.status === 'pending'
            ? `/gymtime/?programId=${workoutSession.programId}`
            : `/gymtime/?id=${workoutSession.id}`
      })
    }

    return workoutItemTemplate
  }

  // A freestyle week's workouts still to do toward the goal, as empty slots. Any program fills one, so a slot opens
  // the program picker. Only the first one says "Start", so the row reads as one call to action.
  const renderOpenSlot = (isFirst: boolean) => {
    const openSlot = nodeFromTemplate('#open-slot-template')
    if (!isFirst) openSlot.querySelector('.open-slot-label')?.remove()
    openSlot.querySelector('button')?.addEventListener('click', () => newWorkoutDialog.open())
    return openSlot
  }

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
    weeks.forEach(({ week, sessions: workoutsOfThisWeek }) => {
      const isThisWeek = week.monday === thisWeek.week.monday

      if (settings.mode === 'freestyle' && workoutsOfThisWeek.length === 0 && !isThisWeek) {
        return
      }

      const workoutWeekTemplate = nodeFromTemplate('#workout-week-template')
      const workoutsOfThisWeekList = workoutWeekTemplate.querySelector('.workout-week-list') as HTMLUListElement
      workoutsOfThisWeekList.style.gridTemplateColumns = `repeat(3, minmax(0, 1fr))`

      setTextContent('.workout-week-week', `Week ${week.number}`, workoutWeekTemplate)
      setTextContent('.workout-week-year', `of ${week.year}`, workoutWeekTemplate)

      workoutsOfThisWeek.forEach((workout) => {
        const workoutItem = renderWorkoutSession(workout)
        workoutsOfThisWeekList.appendChild(workoutItem)
      })

      if (settings.mode === 'freestyle' && isThisWeek) {
        for (let slot = workoutsOfThisWeek.length; slot < goal; slot++) {
          workoutsOfThisWeekList.appendChild(renderOpenSlot(slot === workoutsOfThisWeek.length))
        }
      }

      if (settings.mode === 'rotation' && workoutsOfThisWeek.length < goal) {
        const recordedWorkoutPrograms = workoutsOfThisWeek.map(({ programId }) => programId)
        const missingProgramsIds = Object.keys(programNames).filter(
          (programId) => !recordedWorkoutPrograms.includes(programId)
        )

        missingProgramsIds.forEach((missingProgramId) => {
          const status = isThisWeek ? 'pending' : 'skipped'
          workoutsOfThisWeekList.appendChild(renderWorkoutSession({ programId: missingProgramId, status }))
        })
      }

      workoutWeeksContainer.appendChild(workoutWeekTemplate)
    })
  }

  // The list is drawn once, so a new day draws it again. A restore or a changed workout mode redraws it right away.
  redrawOnNewDay(today, signal)
}
