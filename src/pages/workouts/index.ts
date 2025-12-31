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
      const workoutItemDiv = workoutItem.querySelector('div') as HTMLDivElement
      workoutItemDiv.classList.add(
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

      workoutItemDiv.addEventListener('click', () => {
        window.location.href = `/gymtime/?programId=${workout.programId}`
      })

      workoutWeekList.appendChild(workoutItem)
    })

    if (workouts.length < 3) {
      const isPending = weekKey === currentWeek
      const workoutPrograms = workouts.map((workout) => workout.programId)
      Object.entries(programNames).forEach(([programId, programName]) => {
        if (!workoutPrograms.includes(programId)) {
          const workoutItem = nodeFromTemplate('#workout-item-template')
          setTextContent('.workout-title', programName, workoutItem)
          setTextContent('.workout-status', isPending ? 'pending' : 'skipped', workoutItem)

          const workoutItemDiv = workoutItem.querySelector('div') as HTMLDivElement
          if (isPending) {
            workoutItemDiv.classList.add('bg-neutral-100', 'border-dashed', 'cursor-pointer')
          } else {
            workoutItemDiv.classList.add('bg-red-100', 'border-red-300')
          }
          workoutItemDiv.addEventListener('click', () => {
            window.location.href = `/gymtime/?programId=${programId}`
          })
          workoutWeekList.appendChild(workoutItem)
        }
      })
    }

    workoutWeeksContainer.appendChild(workoutWeek)
  })
