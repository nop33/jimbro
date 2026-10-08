import { legacySetId, rowsFromSession, sessionFromRows } from '../../sync/rows'
import {
  SESSION_STATUSES,
  type ExerciseExecution,
  type ExerciseSnapshot,
  type SessionHeader,
  type SessionStatus,
  type SetRow,
  type WorkoutSession
} from '../types'
import { OBJECT_STORES } from '../constants'
import type { ExerciseSetExecution } from '../exerciseLogging'
import { nowIso } from '../nowIso'
import { storage } from '../storage'
import type { Exercise } from './exercisesStore'
import type { Program } from './programsStore'

// What starting a workout provides. The store adds the id, the status and updatedAt.
export type NewWorkoutSession = Omit<WorkoutSession, 'id' | 'status' | 'updatedAt' | 'exercises'> & {
  exercises: Array<ExerciseSnapshot>
}

type SessionFields = Partial<Pick<WorkoutSession, 'date' | 'location' | 'notes'>>

export const snapshotFromExercise = (exercise: Exercise): ExerciseSnapshot => ({
  exerciseId: exercise.id,
  name: exercise.name,
  kind: exercise.kind,
  preset: exercise.preset,
  muscle: exercise.muscle,
  targetSets: exercise.targetSets,
  defaults: { ...exercise.defaults }
})

export const placeholderSnapshot = (exerciseId: string): ExerciseSnapshot => ({
  exerciseId,
  name: '(deleted)',
  kind: 'lifting',
  preset: 'lifting',
  muscle: 'core',
  targetSets: 1,
  defaults: {}
})

export function computeWorkoutSessionStatus(session: Pick<WorkoutSession, 'exercises'>): SessionStatus {
  if (session.exercises.length === 0) return 'incomplete'
  const allDone = session.exercises.every(({ sets, targetSets }) => sets.length >= targetSets)
  return allDone ? 'completed' : 'incomplete'
}

// A session holds each exercise once.
export const hasExercise = (
  session: { exercises: ReadonlyArray<ExerciseSnapshot> },
  exerciseId: Exercise['id']
): boolean => session.exercises.some((exercise) => exercise.exerciseId === exerciseId)

const indexOfExercise = (session: WorkoutSession, exerciseId: Exercise['id']): number => {
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId)
  if (index === -1) throw new Error('Exercise not found in workout session')
  return index
}

const withExerciseAt = (session: WorkoutSession, index: number, exercise: ExerciseExecution): WorkoutSession => ({
  ...session,
  exercises: session.exercises.map((current, position) => (position === index ? exercise : current))
})

const liveSets = (sets: Array<SetRow>, exerciseId: string): Array<SetRow> =>
  sets
    .filter((set) => set.exerciseId === exerciseId && !set.isDeleted)
    .sort((left, right) => left.position - right.position)

const tombstones = (sets: Array<SetRow>, updatedAt: string): Array<SetRow> =>
  sets.map((set) => ({ ...set, isDeleted: true, updatedAt }))

// Workout sessions, each read as its header joined with its live sets. A write takes the session it changes and
// resolves to the next one once it is stored. It never changes the session it was given, and every write but
// remove goes through save, which recomputes the status.
export class WorkoutSessionsStore {
  private storeName = OBJECT_STORES.WORKOUT_SESSIONS

  // A session that exists and is not deleted.
  async getById(id: string): Promise<WorkoutSession | undefined> {
    const header = await storage.get<SessionHeader>(this.storeName, id)
    if (!header || header.isDeleted) return undefined
    return this.assemble(header)
  }

  async getAll(): Promise<Array<WorkoutSession>> {
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

  // The sessions without their sets, by week of the year, each week in date order.
  async getAllGroupedByWeek(): Promise<Record<string, Array<WorkoutSession>>> {
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

  // The gyms named on live sessions, each with its session count, the most recently used first.
  async getGyms(): Promise<Array<{ name: string; sessions: number }>> {
    const headers = await storage.getAll<SessionHeader>(this.storeName)
    const gyms = new Map<string, { name: string; sessions: number; lastDate: string }>()
    for (const header of headers) {
      const name = header.location.trim()
      if (header.isDeleted || !name) continue
      const gym = gyms.get(name) ?? { name, sessions: 0, lastDate: header.date }
      gym.sessions++
      if (header.date > gym.lastDate) gym.lastDate = header.date
      gyms.set(name, gym)
    }
    return [...gyms.values()]
      .sort((left, right) => right.lastDate.localeCompare(left.lastDate) || left.name.localeCompare(right.name))
      .map(({ name, sessions }) => ({ name, sessions }))
  }

  // Moves every live session at the gym to the new name, in one write. Naming another known gym merges the two.
  async renameGym(from: string, to: string): Promise<number> {
    const name = to.trim()
    if (!name) throw new Error('A gym needs a name')
    const headers = await storage.getAll<SessionHeader>(this.storeName)
    const updatedAt = nowIso()
    const renamed = headers
      .filter((header) => !header.isDeleted && header.location.trim() === from && header.location !== name)
      .map((header) => ({ table: 'sessions' as const, row: { ...header, location: name, updatedAt } }))
    await storage.writeRows(renamed)
    return renamed.length
  }

  async getLatestSaved(): Promise<WorkoutSession | undefined> {
    const header = await this.firstHeader(
      'prev',
      (candidate) => !candidate.isDeleted && SESSION_STATUSES.includes(candidate.status)
    )
    if (!header) return undefined
    return this.assemble(header)
  }

  async getLatestCompletedOfProgram(programId: Program['id']): Promise<WorkoutSession | undefined> {
    const { parseSimpleDate } = await import('../../dateUtils')
    const headers = await storage.getAllByIndex<SessionHeader>(this.storeName, 'programId', programId)
    const latest = headers
      .filter((header) => !header.isDeleted && header.status === 'completed')
      .sort((left, right) => parseSimpleDate(right.date).getTime() - parseSimpleDate(left.date).getTime())[0]
    if (!latest) return undefined
    return this.assemble(latest)
  }

  // The latest session with at least requiredSets sets of the exercise, preferring one at the location.
  async getLatestWithCompletedExercise(
    exerciseId: Exercise['id'],
    requiredSets: number,
    location?: string
  ): Promise<WorkoutSession | undefined> {
    const hasEnoughSets = (session: WorkoutSession) => {
      const exercise = session.exercises.find((candidate) => candidate.exerciseId === exerciseId)
      return !!exercise && exercise.sets.length >= requiredSets
    }
    const headerHasExercise = (header: SessionHeader) => hasExercise(header, exerciseId)

    const session = await this.firstMatchingSession(
      'prev',
      (header) => headerHasExercise(header) && (!location || header.location === location),
      hasEnoughSets
    )
    if (session) return session
    if (!location) return undefined

    return this.firstMatchingSession('prev', headerHasExercise, hasEnoughSets)
  }

  async getDateOfFirst(): Promise<string | undefined> {
    const earliest = await this.firstHeader('next', (header) => !header.isDeleted)
    return earliest?.date
  }

  async create(fields: NewWorkoutSession): Promise<WorkoutSession> {
    return this.save({
      ...fields,
      id: crypto.randomUUID(),
      exercises: fields.exercises.map((exercise) => ({ ...exercise, sets: [] }))
    })
  }

  async update(session: WorkoutSession, fields: SessionFields): Promise<WorkoutSession> {
    return this.save({ ...session, ...fields })
  }

  // Soft-deletes the session and its sets.
  async remove(id: string): Promise<void> {
    const header = await storage.get<SessionHeader>(this.storeName, id)
    if (!header || header.isDeleted) {
      throw new Error('Workout session not found')
    }
    const updatedAt = nowIso()
    const sets = await this.setsOf(id)
    await storage.writeRows([
      { table: 'sessions', row: { ...header, isDeleted: true, updatedAt } },
      ...tombstones(sets, updatedAt).map((row) => ({ table: 'sets' as const, row }))
    ])
  }

  async addSet(
    session: WorkoutSession,
    exerciseId: Exercise['id'],
    set: ExerciseSetExecution
  ): Promise<WorkoutSession> {
    const index = indexOfExercise(session, exerciseId)
    const exercise = session.exercises[index]
    const updatedAt = nowIso()
    const position = exercise.sets.length
    const row: SetRow = {
      id: legacySetId(session.id, exerciseId, position),
      sessionId: session.id,
      exerciseId,
      position,
      set,
      isDeleted: false,
      updatedAt
    }
    return this.save(withExerciseAt(session, index, { ...exercise, sets: [...exercise.sets, set] }), [row], updatedAt)
  }

  async updateSet(
    session: WorkoutSession,
    exerciseId: Exercise['id'],
    setIndex: number,
    set: ExerciseSetExecution
  ): Promise<WorkoutSession> {
    const index = indexOfExercise(session, exerciseId)
    const stored = liveSets(await this.setsOf(session.id), exerciseId)[setIndex]
    if (!stored) throw new Error('Set not found in workout session')

    const exercise = session.exercises[index]
    const updatedAt = nowIso()
    const sets = exercise.sets.map((current, position) => (position === setIndex ? set : current))
    return this.save(withExerciseAt(session, index, { ...exercise, sets }), [{ ...stored, set, updatedAt }], updatedAt)
  }

  async addExercise(session: WorkoutSession, exercise: Exercise): Promise<WorkoutSession> {
    if (hasExercise(session, exercise.id)) throw new Error('Exercise already exists in workout session')
    return this.save({ ...session, exercises: [...session.exercises, { ...snapshotFromExercise(exercise), sets: [] }] })
  }

  // Soft-deletes the exercise's sets with it.
  async removeExercise(session: WorkoutSession, exerciseId: Exercise['id']): Promise<WorkoutSession> {
    const updatedAt = nowIso()
    const removed = tombstones(liveSets(await this.setsOf(session.id), exerciseId), updatedAt)
    const exercises = session.exercises.filter((exercise) => exercise.exerciseId !== exerciseId)
    return this.save({ ...session, exercises }, removed, updatedAt)
  }

  // Puts the exercise in the old one's place and soft-deletes the old one's sets.
  async swapExercise(
    session: WorkoutSession,
    oldExerciseId: Exercise['id'],
    exercise: Exercise
  ): Promise<WorkoutSession> {
    if (hasExercise(session, exercise.id)) throw new Error('Exercise already exists in workout session')
    const index = indexOfExercise(session, oldExerciseId)
    const updatedAt = nowIso()
    const removed = tombstones(liveSets(await this.setsOf(session.id), oldExerciseId), updatedAt)
    return this.save(
      withExerciseAt(session, index, { ...snapshotFromExercise(exercise), sets: [] }),
      removed,
      updatedAt
    )
  }

  // Resolves to the session as it is, with no write, when the exercise is already first or last.
  async moveExercise(
    session: WorkoutSession,
    exerciseId: Exercise['id'],
    direction: 'up' | 'down'
  ): Promise<WorkoutSession> {
    const index = indexOfExercise(session, exerciseId)
    const swapIndex = direction === 'up' ? index - 1 : index + 1
    if (swapIndex < 0 || swapIndex >= session.exercises.length) return session

    const exercises = [...session.exercises]
    exercises[swapIndex] = session.exercises[index]
    exercises[index] = session.exercises[swapIndex]
    return this.save({ ...session, exercises })
  }

  // Stores the header, with the status its sets give, in one write with the set rows the change made.
  private async save(
    session: Omit<WorkoutSession, 'status' | 'updatedAt'>,
    sets: Array<SetRow> = [],
    updatedAt = nowIso()
  ): Promise<WorkoutSession> {
    const next: WorkoutSession = { ...session, status: computeWorkoutSessionStatus(session), updatedAt }
    await storage.writeRows([
      { table: 'sessions', row: rowsFromSession(next).header },
      ...sets.map((row) => ({ table: 'sets' as const, row }))
    ])
    return next
  }

  private async setsOf(sessionId: string): Promise<Array<SetRow>> {
    return storage.getAllByIndex<SetRow>(OBJECT_STORES.SETS, 'sessionId', sessionId)
  }

  private async assemble(header: SessionHeader): Promise<WorkoutSession> {
    return sessionFromRows(header, await this.setsOf(header.id))
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
}

export const workoutSessionsStore = new WorkoutSessionsStore()
