import { exercisesStore } from '../../db/stores/exercisesStore'

type EmptyStateButton = 'seed' | 'restore' | 'none'

class IntroText {
  private static introText = document.querySelector('#intro') as HTMLDivElement

  static async render(
    { completed, goal, programCount }: { completed: number; goal: number; programCount: number },
    emptyStateButton: EmptyStateButton
  ) {
    if (emptyStateButton === 'seed') {
      this.introText.textContent = `Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?`
    } else if (emptyStateButton === 'restore') {
      this.introText.textContent = `Your workouts are backed up in the cloud. Restore them to pick up where you left off.`
    } else if (completed > 0 && completed < goal) {
      const remainingWorkouts = goal - completed
      this.introText.textContent = `You have ${remainingWorkouts} ${
        remainingWorkouts === 1 ? 'workout' : 'workouts'
      } left this week.`
    } else if (completed > 0) {
      this.introText.textContent = `You have completed all your workouts this week! 💪`
    } else if (programCount > 0) {
      this.introText.textContent = `You have not completed any workouts this week. Time to get sweating! 💦`
    } else if ((await exercisesStore.load()).length > 0) {
      this.introText.textContent = `Create a program from your exercises to start a workout.`
    } else {
      this.introText.textContent = `Let's start by defining your exercises and programs!`
    }
  }
}

export default IntroText
