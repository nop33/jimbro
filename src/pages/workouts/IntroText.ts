import { getWeekOfYear } from '../../dateUtils'
import { db } from '../../db'
import type { WorkoutSession } from '../../db/types'
import { getEffectiveWorkoutsPerWeek } from '../../settings'

type EmptyStateButton = 'seed' | 'restore' | 'none'

class IntroText {
  private static introText = document.querySelector('#intro') as HTMLDivElement

  static async render(
    workoutSessionsByWeek: Record<string, Array<WorkoutSession>>,
    emptyStateButton: EmptyStateButton
  ) {
    const currentWeek = getWeekOfYear(new Date())
    const thisWeekWorkoutSessions = workoutSessionsByWeek[currentWeek] ?? []
    const thisWeekCompletedWorkoutSessions = thisWeekWorkoutSessions?.filter(
      (workoutSession) => workoutSession.status === 'completed'
    )

    const programNames = await db.programs.getNameMap()
    const programCount = Object.keys(programNames).length
    const workoutsPerWeek = getEffectiveWorkoutsPerWeek(programCount)

    if (emptyStateButton === 'seed') {
      this.introText.textContent = `Let's start by defining your exercises and programs! Would you like to start with a simple 3-day split program?`
    } else if (emptyStateButton === 'restore') {
      this.introText.textContent = `Your workouts are backed up in the cloud. Restore them to pick up where you left off.`
    } else if (
      thisWeekCompletedWorkoutSessions.length > 0 &&
      thisWeekCompletedWorkoutSessions.length < workoutsPerWeek
    ) {
      const remainingWorkouts = workoutsPerWeek - thisWeekCompletedWorkoutSessions.length
      this.introText.textContent = `You have ${remainingWorkouts} ${
        remainingWorkouts === 1 ? 'workout' : 'workouts'
      } left this week.`
    } else if (thisWeekCompletedWorkoutSessions.length > 0) {
      this.introText.textContent = `You have completed all your workouts this week! 💪`
    } else if (programCount > 0) {
      this.introText.textContent = `You have not completed any workouts this week. Time to get sweating! 💦`
    } else if ((await db.exercises.getAll()).length > 0) {
      this.introText.textContent = `Create a program from your exercises to start a workout.`
    } else {
      this.introText.textContent = `Let's start by defining your exercises and programs!`
    }
  }
}

export default IntroText
