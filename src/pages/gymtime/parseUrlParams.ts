import { programsStore, type Program } from '../../db/stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from '../../db/stores/workoutSessionsStore'

export const parseUrlParams = async () => {
  const urlParams = new URLSearchParams(window.location.search)
  const programIdParam = urlParams.get('programId')
  const dateParam = urlParams.get('date')

  let program: Program | undefined
  let workoutSession: WorkoutSession | undefined = undefined

  if (!programIdParam && !dateParam) {
    throw new Error('One of programId or date parameter is required')
  }

  if (programIdParam) {
    program = await programsStore.getProgram(programIdParam)
    workoutSession = undefined
  } else if (dateParam) {
    workoutSession = await workoutSessionsStore.getWorkoutSession(dateParam)
    program = workoutSession?.programId ? await programsStore.getProgram(workoutSession.programId) : undefined
  }

  if (!program) {
    throw new Error('Program not found')
  }

  return { program, workoutSession }
}
