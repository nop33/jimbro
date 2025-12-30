import { programsStore } from '../../db/stores/programsStore'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import '../../style.css'
import { getWeekOfYear, nodeFromTemplate, setTextContent } from '../../utils'

const workoutWeeksContainer = document.getElementById('workout-weeks') as HTMLDivElement

const workoutWeeks = await workoutSessionsStore.getAllWorkoutSessionsGroupedByWeek()
const programNames = await programsStore.getProgramsByNames()
const currentWeek = getWeekOfYear(new Date())

Object.entries(workoutWeeks)
  .reverse()
  .forEach(([weekKey, workouts]) => {
    const workoutWeek = nodeFromTemplate('#workout-week-template')
    const workoutWeekList = workoutWeek.querySelector('#workout-week-list') as HTMLUListElement
    const [year, week] = weekKey.split('-')
    const weekNumber = week.replace('W', '')
    setTextContent('.workout-week-week', `Week ${weekNumber}`, workoutWeek)
    setTextContent('.workout-week-year', `of ${year}`, workoutWeek)

    workouts.forEach((workout) => {
      const workoutItem = nodeFromTemplate('#workout-item-template')
      setTextContent('.workout-title', programNames[workout.programId], workoutItem)
      setTextContent('.workout-status', workout.status, workoutItem)
      setTextContent('.workout-date', new Date(workout.date).toLocaleDateString(), workoutItem)
      workoutItem.querySelector('div')?.classList.add(
        {
          completed: 'bg-green-200',
          skipped: 'bg-red-200',
          incomplete: 'bg-yellow-100'
        }[workout.status],
        {
          completed: 'border-green-400',
          skipped: 'border-red-200',
          incomplete: 'border-yellow-400'
        }[workout.status]
      )
      workoutWeekList.appendChild(workoutItem)
    })

    if (workouts.length < 3) {
      const isSkipped = weekKey !== currentWeek
      const workoutPrograms = workouts.map((workout) => workout.programId)
      Object.entries(programNames).forEach(([programId, programName]) => {
        if (!workoutPrograms.includes(programId)) {
          const workoutItem = nodeFromTemplate('#workout-item-template')
          setTextContent('.workout-title', programName, workoutItem)
          setTextContent('.workout-status', isSkipped ? 'skipped' : 'pending', workoutItem)
          workoutItem
            .querySelector('div')
            ?.classList.add(isSkipped ? 'bg-red-100' : 'bg-neutral-100', isSkipped ? 'border-red-300' : 'border-dashed')
          workoutWeekList.appendChild(workoutItem)
        }
      })
    }

    workoutWeeksContainer.appendChild(workoutWeek)
  })
