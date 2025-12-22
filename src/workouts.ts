import './style.css'
import { getCurrentWeekWorkoutSessions, getLastWeekWorkoutSessions, type WeekWorkoutSession } from './data/db'

const workoutListThisWeek = document.querySelector('.workout-list.this-week') as HTMLUListElement
const workoutListLastWeek = document.querySelector('.workout-list.last-week') as HTMLUListElement
const workoutItemTemplate = document.querySelector('#workout-item') as HTMLTemplateElement

if (!workoutListThisWeek || !workoutListLastWeek || !workoutItemTemplate)
  throw new Error('Workout list or workout item template not found')

const renderWorkoutList = (workoutList: HTMLUListElement, workoutSessions: Array<WeekWorkoutSession>) => {
  workoutSessions.forEach((workoutSession) => {
    const workoutItem = document.importNode(workoutItemTemplate.content, true)
    const workoutTitle = workoutItem.querySelector('.workout-title') as HTMLHeadingElement
    const workoutStatus = workoutItem.querySelector('.workout-status') as HTMLParagraphElement

    workoutTitle.textContent = workoutSession.name
    workoutStatus.textContent = workoutSession.status

    const cardDiv = workoutItem.querySelector('.workout-card') as HTMLDivElement;
    if (cardDiv) {
      cardDiv.classList.remove('bg-green-500', 'bg-red-500', 'bg-yellow-500', 'bg-neutral-800');
      if (workoutSession.status === 'completed') {
        cardDiv.classList.add('bg-green-500');
      } else if (workoutSession.status === 'skipped') {
        cardDiv.classList.add('bg-red-500');
      } else if (workoutSession.status === 'incomplete') {
        cardDiv.classList.add('bg-yellow-500');
      } else {
        cardDiv.classList.add('bg-neutral-800');
      }
    }

    workoutList.appendChild(workoutItem)
  });
}

renderWorkoutList(workoutListThisWeek, getCurrentWeekWorkoutSessions())
renderWorkoutList(workoutListLastWeek, getLastWeekWorkoutSessions())
