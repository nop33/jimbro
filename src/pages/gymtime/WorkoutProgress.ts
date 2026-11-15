import type { ExerciseProgress } from '../../db/stores/workoutSessionsStore'
import { setTextContent } from '../../utils'

// How far the workout is, over its exercises: the exercises done and the sets logged, of what it holds, and a bar of
// the sets. A native <progress>, so a screen reader reads it as one.
class WorkoutProgress {
  private element = document.querySelector('#workout-progress') as HTMLDivElement
  private bar = this.element.querySelector('.workout-progress-bar') as HTMLProgressElement

  show(progresses: ExerciseProgress[]) {
    const logged = progresses.reduce((sum, { logged }) => sum + logged, 0)
    const target = progresses.reduce((sum, { target }) => sum + target, 0)
    setTextContent('.workout-exercises-done', String(progresses.filter(({ done }) => done).length), this.element)
    setTextContent('.workout-exercises-total', String(progresses.length), this.element)
    setTextContent('.workout-sets-done', String(logged), this.element)
    setTextContent('.workout-sets-total', String(target), this.element)
    this.bar.max = Math.max(target, 1)
    this.bar.value = logged
  }
}

export default WorkoutProgress
