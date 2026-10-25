import { exercisesStore } from '../../db/stores/exercisesStore'

type EmptyStateButton = 'seed' | 'restore' | 'none'

// The message for a user with no program yet. Once there is one, the week's progress card takes its place.
const renderIntroText = async (emptyStateButton: EmptyStateButton) => {
  const introText = document.querySelector('#intro') as HTMLDivElement
  if (emptyStateButton === 'seed') {
    introText.textContent = `Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?`
  } else if (emptyStateButton === 'restore') {
    introText.textContent = `Your workouts are backed up in the cloud. Restore them to pick up where you left off.`
  } else if ((await exercisesStore.load()).length > 0) {
    introText.textContent = `Create a program from your exercises to start a workout.`
  } else {
    introText.textContent = `Let's start by defining your exercises and programs!`
  }
  introText.hidden = false
}

export default renderIntroText
