import { getWeekOfYear } from '../../dateUtils'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { hasExercises, hasPrograms } from '../../db/utils'

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
    } else if (await hasPrograms()) {
      this.introText.textContent = `You have not completed any workouts this week. Time to get sweating! 💦`
    } else if (!(await hasExercises())) {
      this.introText.textContent = `Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?`
    }
  }
}

export default IntroText
