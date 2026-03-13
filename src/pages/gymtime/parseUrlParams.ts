import { programsStore, type Program } from '../../db/stores/programsStore'
import { workoutSessionsStore, type WorkoutSession } from '../../db/stores/workoutSessionsStore'

export const parseUrlParams = async () => {
  const urlParams = new URLSearchParams(window.location.search)
  const programIdParam = urlParams.get('programId')
  const sessionIdParam = urlParams.get('id')

  let program: Program | undefined
  let workoutSession: WorkoutSession | undefined

  if (!programIdParam && !sessionIdParam) {
    throw new Error('One of programId or id parameter is required')
  }

  if (sessionIdParam) {
    workoutSession = await workoutSessionsStore.getWorkoutSession(sessionIdParam)
    program = workoutSession?.programId ? await programsStore.getProgram(workoutSession.programId) : undefined
  } else if (programIdParam) {
    program = await programsStore.getProgram(programIdParam)
  }

  if (!program) {
    throw new Error('Program not found')
  }

  return { program, workoutSession }
}
