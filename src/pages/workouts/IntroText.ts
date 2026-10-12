import { exercisesStore } from '../../db/stores/exercisesStore'

type EmptyStateButton = 'seed' | 'restore' | 'none'

// The message for a user with no program yet. Once there is one, the week's progress card takes its place.
class IntroText {
  private static introText = document.querySelector('#intro') as HTMLDivElement

  static async render(emptyStateButton: EmptyStateButton) {
    if (emptyStateButton === 'seed') {
      this.introText.textContent = `Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?`
    } else if (emptyStateButton === 'restore') {
      this.introText.textContent = `Your workouts are backed up in the cloud. Restore them to pick up where you left off.`
    } else if ((await exercisesStore.load()).length > 0) {
      this.introText.textContent = `Create a program from your exercises to start a workout.`
    } else {
      this.introText.textContent = `Let's start by defining your exercises and programs!`
    }
    this.introText.hidden = false
  }
}

export default IntroText
