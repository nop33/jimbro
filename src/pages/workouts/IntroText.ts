import { getWeekOfYear } from '../../dateUtils'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'

const WORKOUTS_PER_WEEK = 3

class IntroText {
  private static introText = document.querySelector('#intro') as HTMLDivElement

  static async render() {
    const currentWeek = getWeekOfYear(new Date())
    const workoutSessionsByWeek = await workoutSessionsStore.getAllWorkoutSessionsGroupedByWeek()
    const thisWeekWorkoutSessions = workoutSessionsByWeek[currentWeek] ?? []
    const thisWeekCompletedWorkoutSessions = thisWeekWorkoutSessions?.filter(
      (workoutSession) => workoutSession.status === 'completed'
    )

    if (thisWeekCompletedWorkoutSessions.length > 0 && thisWeekCompletedWorkoutSessions.length < WORKOUTS_PER_WEEK) {
      const remainingWorkouts = WORKOUTS_PER_WEEK - thisWeekCompletedWorkoutSessions.length
      this.introText.textContent = `You have ${remainingWorkouts} ${
        remainingWorkouts === 1 ? 'workout' : 'workouts'
      } left this week.`
    } else if (thisWeekCompletedWorkoutSessions.length === WORKOUTS_PER_WEEK) {
      this.introText.textContent = `You have completed all your workouts this week! 💪`
    } else {
      this.introText.textContent = `You have not completed any workouts this week. Time to get sweating! 💦`
    }
  }
}

export default IntroText
