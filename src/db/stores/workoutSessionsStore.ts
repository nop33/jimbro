import {
  legacySetId,
  rowsFromSession,
  sessionFromRows,
  type ExerciseSnapshot,
  type SessionHeader,
  type SetRow
} from '../../sync/rows'
import { OBJECT_STORES } from '../constants'
import type { ExerciseSetExecution } from '../exerciseLogging'
import { nowIso } from '../nowIso'
import { storage } from '../storage'
import type { Exercise } from './exercisesStore'
import type { Program } from './programsStore'
import { setsStore } from './setsStore'

export type { ExerciseSetExecution } from '../exerciseLogging'
export type { ExerciseSnapshot } from '../../sync/rows'

export const PERSISTED_WORKOUT_SESSION_STATUSES = ['completed', 'incomplete'] as const
export type PersistedWorkoutSessionStatus = (typeof PERSISTED_WORKOUT_SESSION_STATUSES)[number]

export const UI_WORKOUT_SESSION_STATUSES = ['pending', 'skipped'] as const
export type WorkoutSessionStatus = PersistedWorkoutSessionStatus | (typeof UI_WORKOUT_SESSION_STATUSES)[number]

export interface WorkoutSession {
  id: string
  date: string
  programId: Program['id']
  exercises: Array<ExerciseExecution>
  location: string
  status: PersistedWorkoutSessionStatus
  notes?: string
  updatedAt: string
}

export type NewWorkoutSession = Omit<WorkoutSession, 'id' | 'updatedAt'>

export interface ExerciseExecution {
  exerciseId: Exercise['id']
  name: string
  kind: Exercise['kind']
  preset: Exercise['preset']
  muscle?: Exercise['muscle']
  targetSets: number
  defaults: Exercise['defaults']
  sets: Array<ExerciseSetExecution>
}

export const snapshotFromExercise = (exercise: Exercise): ExerciseSnapshot => ({
  exerciseId: exercise.id,
  name: exercise.name,
  kind: exercise.kind,
  preset: exercise.preset,
  muscle: exercise.muscle,
  targetSets: exercise.targetSets,
  defaults: { ...exercise.defaults }
})

export const placeholderSnapshot = (exerciseId: string, loggedSetCount = 0): ExerciseSnapshot => ({
  exerciseId,
  name: '(deleted)',
  kind: 'lifting',
  preset: 'lifting',
  muscle: 'core',
  targetSets: Math.max(loggedSetCount, 1),
  defaults: {}
})

const liveSets = (sets: Array<SetRow>, exerciseId: string): Array<SetRow> =>
  sets
    .filter((set) => set.exerciseId === exerciseId && !set.isDeleted)
    .sort((left, right) => left.position - right.position)

export class WorkoutSessionsStore {
  private storeName = OBJECT_STORES.WORKOUT_SESSIONS

  private async putRows(session: WorkoutSession, sets: Array<SetRow> = []): Promise<void> {
    await storage.writeRows([
      { table: 'sessions', row: rowsFromSession(session).header },
      ...sets.map((row) => ({ table: 'sets' as const, row }))
    ])
  }

  private async assemble(header: SessionHeader): Promise<WorkoutSession> {
    return sessionFromRows(header, await setsStore.getBySession(header.id))
  }

  private async firstHeader(
    direction: IDBCursorDirection,
    predicate: (header: SessionHeader) => boolean
  ): Promise<SessionHeader | undefined> {
    return storage.getFirstByPredicate<SessionHeader>(this.storeName, 'date', direction, predicate)
  }

  private async firstMatchingSession(
    direction: IDBCursorDirection,
    headerOk: (header: SessionHeader) => boolean,
    sessionOk: (session: WorkoutSession) => boolean
  ): Promise<WorkoutSession | undefined> {
    const db = await storage.connection()
    return new Promise((resolve, reject) => {
      let settled = false
      const ok = (value: WorkoutSession | undefined) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        reject(error)
      }
      const tx = db.transaction([this.storeName, OBJECT_STORES.SETS], 'readonly')
      tx.onerror = () => fail(tx.error)
      tx.onabort = () => fail(tx.error ?? new Error('session read aborted'))
      const request = tx.objectStore(this.storeName).index('date').openCursor(null, direction)
      request.onerror = () => fail(request.error)
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) {
          ok(undefined)
          return
        }
        const header = cursor.value as SessionHeader
        if (header.isDeleted || !headerOk(header)) {
          cursor.continue()
          return
        }
        const setsRequest = tx.objectStore(OBJECT_STORES.SETS).index('sessionId').getAll(header.id)
        setsRequest.onerror = () => fail(setsRequest.error)
        setsRequest.onsuccess = () => {
          const session = sessionFromRows(header, setsRequest.result as Array<SetRow>)
          if (sessionOk(session)) ok(session)
          else cursor.continue()
        }
      }
    })
  }

  async createWorkoutSession(item: NewWorkoutSession): Promise<WorkoutSession> {
    const workoutSession: WorkoutSession = { ...item, id: crypto.randomUUID(), updatedAt: nowIso() }
    const sets: Array<SetRow> = []
    for (const exercise of workoutSession.exercises) {
      exercise.sets.forEach((set, position) => {
        sets.push({
          id: legacySetId(workoutSession.id, exercise.exerciseId, position),
          sessionId: workoutSession.id,
          exerciseId: exercise.exerciseId,
          position,
          set,
          isDeleted: false,
          updatedAt: workoutSession.updatedAt
        })
      })
    }
    await this.putRows(workoutSession, sets)
    return workoutSession
  }

  async importWorkoutSession(workoutSession: WorkoutSession): Promise<WorkoutSession> {
    const session = { ...workoutSession, updatedAt: workoutSession.updatedAt || nowIso() }
    const sets: Array<SetRow> = []
    for (const exercise of session.exercises) {
      exercise.sets.forEach((set, position) => {
        sets.push({
          id: legacySetId(session.id, exercise.exerciseId, position),
          sessionId: session.id,
          exerciseId: exercise.exerciseId,
          position,
          set,
          isDeleted: false,
          updatedAt: session.updatedAt
        })
      })
    }
    await this.putRows(session, sets)
    return session
  }

  async getWorkoutSession(id: string): Promise<WorkoutSession | undefined> {
    const header = await storage.get<SessionHeader>(this.storeName, id)
    if (!header || header.isDeleted) return undefined
    return this.assemble(header)
  }

  async getLatestCompletedWorkoutSessionOfProgram(programId: Program['id']): Promise<WorkoutSession | undefined> {
    const { parseSimpleDate } = await import('../../dateUtils')
    const headers = await storage.getAllByIndex<SessionHeader>(this.storeName, 'programId', programId)
    const latest = headers
      .filter((header) => !header.isDeleted && header.status === 'completed')
      .sort((left, right) => parseSimpleDate(right.date).getTime() - parseSimpleDate(left.date).getTime())[0]
    if (!latest) return undefined
    return this.assemble(latest)
  }

  async getLatestSavedWorkoutSession(): Promise<WorkoutSession | undefined> {
    const header = await this.firstHeader(
      'prev',
      (candidate) => !candidate.isDeleted && PERSISTED_WORKOUT_SESSION_STATUSES.includes(candidate.status)
    )
    if (!header) return undefined
    return this.assemble(header)
  }

  async getLatestWorkoutSessionWithCompletedExercise(
    exerciseId: Exercise['id'],
    requiredSets: number,
    location?: string
  ): Promise<WorkoutSession | undefined> {
    const hasEnoughSets = (session: WorkoutSession) => {
      const exercise = session.exercises.find((candidate) => candidate.exerciseId === exerciseId)
      return !!exercise && exercise.sets.length >= requiredSets
    }
    const headerHasExercise = (header: SessionHeader) =>
      header.exercises.some((exercise) => exercise.exerciseId === exerciseId)

    const session = await this.firstMatchingSession(
      'prev',
      (header) => headerHasExercise(header) && (!location || header.location === location),
      hasEnoughSets
    )
    if (session) return session
    if (!location) return undefined

    return this.firstMatchingSession('prev', headerHasExercise, hasEnoughSets)
  }

  async getDateOfFirstWorkoutSession(): Promise<string | undefined> {
    const earliest = await this.firstHeader('next', (header) => !header.isDeleted)
    return earliest?.date
  }

  async getAllWorkoutSessions(): Promise<Array<WorkoutSession>> {
    const db = await storage.connection()
    const { headers, groups } = await new Promise<{
      headers: Array<SessionHeader>
      groups: Array<{ sessionId: string; sets: Array<SetRow> }>
    }>((resolve, reject) => {
      const tx = db.transaction([this.storeName, OBJECT_STORES.SET_GROUPS], 'readonly')
      const headersRequest = tx.objectStore(this.storeName).getAll()
      const groupsRequest = tx.objectStore(OBJECT_STORES.SET_GROUPS).getAll()
      tx.oncomplete = () =>
        resolve({
          headers: headersRequest.result as Array<SessionHeader>,
          groups: groupsRequest.result as Array<{ sessionId: string; sets: Array<SetRow> }>
        })
      tx.onerror = () => reject(tx.error)
    })
    const bySession = new Map(groups.map((group) => [group.sessionId, group.sets]))
    return headers
      .filter((header) => !header.isDeleted)
      .map((header) => sessionFromRows(header, bySession.get(header.id) ?? []))
  }

  async getAllWorkoutSessionsGroupedByWeek(): Promise<Record<string, Array<WorkoutSession>>> {
    const { getWeekOfYear, parseSimpleDate } = await import('../../dateUtils')
    const headers = await storage.getAll<SessionHeader>(this.storeName)
    const workoutSessions = headers.filter((header) => !header.isDeleted).map((header) => sessionFromRows(header, []))

    const grouped = workoutSessions.reduce(
      (acc, workoutSession) => {
        const week = getWeekOfYear(parseSimpleDate(workoutSession.date))
        if (acc[week]) {
          acc[week].push(workoutSession)
        } else {
          acc[week] = [workoutSession]
        }
        return acc
      },
      {} as Record<string, Array<WorkoutSession>>
    )

    for (const week in grouped) {
      grouped[week].sort((a, b) => parseSimpleDate(a.date).getTime() - parseSimpleDate(b.date).getTime())
    }

    return grouped
  }

  async updateWorkoutSession(item: WorkoutSession): Promise<WorkoutSession> {
    const updated = { ...item, updatedAt: nowIso() }
    await this.putRows(updated)
    return updated
  }

  async addExerciseExecutionSetToWorkoutSession({
    workoutSession,
    exerciseId,
    exerciseExecutionSet
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
    exerciseExecutionSet: ExerciseSetExecution
  }): Promise<WorkoutSession> {
    const workoutSessionExercise = workoutSession.exercises.find(({ exerciseId: id }) => id === exerciseId)

    if (!workoutSessionExercise) {
      throw new Error('Exercise not found in workout session')
    }

    const updatedAt = nowIso()
    const position = workoutSessionExercise.sets.length
    const setRow: SetRow = {
      id: legacySetId(workoutSession.id, exerciseId, position),
      sessionId: workoutSession.id,
      exerciseId,
      position,
      set: exerciseExecutionSet,
      isDeleted: false,
      updatedAt
    }
    workoutSessionExercise.sets.push(exerciseExecutionSet)
    workoutSession.updatedAt = updatedAt
    await this.putRows(workoutSession, [setRow])
    return workoutSession
  }

  async countWorkoutSessions(): Promise<number> {
    const headers = await storage.getAll<SessionHeader>(this.storeName)
    return headers.filter((header) => !header.isDeleted).length
  }

  async deleteWorkoutSession(id: string): Promise<void> {
    const header = await storage.get<SessionHeader>(this.storeName, id)
    if (!header || header.isDeleted) {
      throw new Error('Workout session not found')
    }
    const updatedAt = nowIso()
    const sets = await setsStore.getBySession(id)
    await storage.writeRows([
      { table: 'sessions', row: { ...header, isDeleted: true, updatedAt } },
      ...sets.map((set) => ({ table: 'sets' as const, row: { ...set, isDeleted: true, updatedAt } }))
    ])
  }

  async updateExerciseExecutionSetInWorkoutSession({
    workoutSession,
    exerciseId,
    exerciseExecutionSetIndex,
    exerciseExecutionSet
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
    exerciseExecutionSetIndex: number
    exerciseExecutionSet: ExerciseSetExecution
  }): Promise<WorkoutSession> {
    const workoutSessionExercise = workoutSession.exercises.find(({ exerciseId: id }) => id === exerciseId)
    if (!workoutSessionExercise) {
      throw new Error('Exercise not found')
    }
    const current = liveSets(await setsStore.getBySession(workoutSession.id), exerciseId)[exerciseExecutionSetIndex]
    if (!current) {
      throw new Error('Exercise not found')
    }
    const updatedAt = nowIso()
    workoutSessionExercise.sets[exerciseExecutionSetIndex] = exerciseExecutionSet
    workoutSession.updatedAt = updatedAt
    await this.putRows(workoutSession, [{ ...current, set: exerciseExecutionSet, updatedAt }])
    return workoutSession
  }

  async addExerciseToWorkoutSession({
    workoutSession,
    exercise
  }: {
    workoutSession: WorkoutSession
    exercise: ExerciseExecution
  }): Promise<WorkoutSession> {
    const updatedAt = nowIso()
    const next: WorkoutSession = {
      ...workoutSession,
      exercises: [...workoutSession.exercises, exercise],
      updatedAt
    }
    const sets: Array<SetRow> = exercise.sets.map((set, position) => ({
      id: legacySetId(workoutSession.id, exercise.exerciseId, position),
      sessionId: workoutSession.id,
      exerciseId: exercise.exerciseId,
      position,
      set,
      isDeleted: false,
      updatedAt
    }))
    await this.putRows(next, sets)
    return next
  }

  async deleteExerciseFromWorkoutSession({
    workoutSession,
    exerciseId
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
  }): Promise<WorkoutSession> {
    const updatedAt = nowIso()
    const next: WorkoutSession = {
      ...workoutSession,
      exercises: workoutSession.exercises.filter(({ exerciseId: id }) => id !== exerciseId),
      updatedAt
    }
    const tombstones = liveSets(await setsStore.getBySession(workoutSession.id), exerciseId).map((set) => ({
      ...set,
      isDeleted: true,
      updatedAt
    }))
    await this.putRows(next, tombstones)
    return next
  }

  async swapExerciseInWorkoutSession({
    workoutSession,
    oldExerciseId,
    replacement
  }: {
    workoutSession: WorkoutSession
    oldExerciseId: Exercise['id']
    replacement: ExerciseExecution
  }): Promise<WorkoutSession> {
    const exerciseIndex = workoutSession.exercises.findIndex(({ exerciseId }) => exerciseId === oldExerciseId)
    if (exerciseIndex === -1) {
      throw new Error('Exercise not found in workout session')
    }

    const updatedAt = nowIso()
    const updatedExercises = [...workoutSession.exercises]
    updatedExercises[exerciseIndex] = replacement
    const next: WorkoutSession = { ...workoutSession, exercises: updatedExercises, updatedAt }
    const tombstones = liveSets(await setsStore.getBySession(workoutSession.id), oldExerciseId).map((set) => ({
      ...set,
      isDeleted: true,
      updatedAt
    }))
    const added = replacement.sets.map((set, position) => ({
      id: legacySetId(workoutSession.id, replacement.exerciseId, position),
      sessionId: workoutSession.id,
      exerciseId: replacement.exerciseId,
      position,
      set,
      isDeleted: false,
      updatedAt
    }))
    await this.putRows(next, [...tombstones, ...added])
    return next
  }

  async moveExerciseInWorkoutSession({
    workoutSession,
    exerciseId,
    direction
  }: {
    workoutSession: WorkoutSession
    exerciseId: Exercise['id']
    direction: 'up' | 'down'
  }): Promise<WorkoutSession> {
    const exerciseIndex = workoutSession.exercises.findIndex(({ exerciseId: id }) => id === exerciseId)
    if (exerciseIndex === -1) {
      throw new Error('Exercise not found in workout session')
    }

    if (direction === 'up' && exerciseIndex === 0) {
      return workoutSession
    }

    if (direction === 'down' && exerciseIndex === workoutSession.exercises.length - 1) {
      return workoutSession
    }

    const updatedExercises = [...workoutSession.exercises]
    const swapIndex = direction === 'up' ? exerciseIndex - 1 : exerciseIndex + 1
    const temp = updatedExercises[swapIndex]
    updatedExercises[swapIndex] = updatedExercises[exerciseIndex]
    updatedExercises[exerciseIndex] = temp

    const next: WorkoutSession = { ...workoutSession, exercises: updatedExercises, updatedAt: nowIso() }
    await this.putRows(next)
    return next
  }
}

export const workoutSessionsStore = new WorkoutSessionsStore()
