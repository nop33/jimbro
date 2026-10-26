import { legacySetId, rowsFromSession, sessionFromRows } from '../../sync/rows'
import {
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

// What starting a workout provides. The store adds the id, the status and updatedAt, and sets each exercise's
// starting target.
export type NewWorkoutSession = Omit<WorkoutSession, 'id' | 'status' | 'updatedAt' | 'exercises'> & {
  exercises: Array<ExerciseSnapshot>
}

// The day and gym of a workout that has not started yet.
export type PlannedSession = Pick<WorkoutSession, 'date' | 'location'>

// An exercise's sets as one earlier session holds them.
export type LastTime = Pick<WorkoutSession, 'id' | 'date' | 'location'> & Pick<ExerciseExecution, 'sets'>

// How far an exercise in a session is: the sets logged, the sets to do, and whether they are all logged.
export interface ExerciseProgress {
  logged: number
  target: number
  done: boolean
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

// The target an exercise starts with when a session starts or it joins one: as many sets as the exercise asks for,
// or as last time had when more.
export const startingTargetSets = (
  { targetSets }: Pick<ExerciseSnapshot, 'targetSets'>,
  lastTime: LastTime | undefined
): number => Math.max(targetSets, lastTime?.sets.length ?? 0)

// The target is the stored one, or the sets logged when more.
export const progressOf = ({ targetSets, sets }: Pick<ExerciseExecution, 'targetSets' | 'sets'>): ExerciseProgress => {
  const target = Math.max(targetSets, sets.length)
  return { logged: sets.length, target, done: sets.length >= target }
}

// Whether removeSetSlot can drop one of the exercise's sets: one that isn't logged, while more than one is left.
export const canRemoveSetSlot = ({ logged, target }: ExerciseProgress): boolean => target > Math.max(logged, 1)

// A session is completed when every exercise in it is done.
export function computeWorkoutSessionStatus(session: Pick<WorkoutSession, 'exercises'>): SessionStatus {
  if (session.exercises.length === 0) return 'incomplete'
  return session.exercises.every((exercise) => progressOf(exercise).done) ? 'completed' : 'incomplete'
}

// The first exercise after this one, wrapping round, that still has sets to do.
export const nextUnfinished = (session: WorkoutSession, exerciseId: Exercise['id']): ExerciseExecution | undefined => {
  const index = session.exercises.findIndex((exercise) => exercise.exerciseId === exerciseId)
  const after = [...session.exercises.slice(index + 1), ...session.exercises.slice(0, index)]
  return after.find((exercise) => !progressOf(exercise).done)
}

// A session holds each exercise once.
const hasExercise = (session: { exercises: ReadonlyArray<ExerciseSnapshot> }, exerciseId: Exercise['id']): boolean =>
  session.exercises.some((exercise) => exercise.exerciseId === exerciseId)

// Whether a session came before the given one, which it is not, and has the exercise.
const isEarlierWith = (
  candidate: Pick<SessionHeader, 'id' | 'date' | 'exercises'>,
  exerciseId: Exercise['id'],
  session: PlannedSession & { id?: WorkoutSession['id'] }
): boolean => hasExercise(candidate, exerciseId) && candidate.id !== session.id && candidate.date <= session.date

const loggedSetsOf = (session: WorkoutSession, exerciseId: Exercise['id']) =>
  session.exercises.find((exercise) => exercise.exerciseId === exerciseId)?.sets ?? []

// The exercise's sets in a session, when it logged any.
const lastTimeIn = (session: WorkoutSession, exerciseId: Exercise['id']): LastTime | undefined => {
  const sets = loggedSetsOf(session, exerciseId)
  return sets.length > 0 ? { id: session.id, date: session.date, location: session.location, sets } : undefined
}

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
class WorkoutSessionsStore {
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
    const header = await this.firstHeader('prev', (candidate) => !candidate.isDeleted)
    if (!header) return undefined
    return this.assemble(header)
  }

  // The exercise's sets the last time it was done before the session: the latest other session up to its date with
  // a set of the exercise, preferring one at the same gym. A planned session has no id yet.
  async lastTimeOf(
    exerciseId: Exercise['id'],
    session: PlannedSession & { id?: WorkoutSession['id'] }
  ): Promise<LastTime | undefined> {
    const earlier = (header: SessionHeader) => isEarlierWith(header, exerciseId, session)
    const hasSets = (candidate: WorkoutSession) => loggedSetsOf(candidate, exerciseId).length > 0

    const found =
      (session.location &&
        (await this.firstMatchingSession(
          'prev',
          (header) => earlier(header) && header.location === session.location,
          hasSets
        ))) ||
      (await this.firstMatchingSession('prev', earlier, hasSets))
    return found && lastTimeIn(found, exerciseId)
  }

  // Every session before this one that logged the exercise, at any gym, newest first, in the order lastTimeOf reads.
  async earlierTimesOf(
    exerciseId: Exercise['id'],
    session: PlannedSession & { id?: WorkoutSession['id'] }
  ): Promise<Array<LastTime>> {
    return (await this.getAll())
      .filter((candidate) => isEarlierWith(candidate, exerciseId, session))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .map((candidate) => lastTimeIn(candidate, exerciseId))
      .filter((lastTime): lastTime is LastTime => lastTime !== undefined)
  }

  // Each exercise starts with the target startingTargetSets gives for last time at the session's gym.
  async create(fields: NewWorkoutSession): Promise<WorkoutSession> {
    const exercises = await Promise.all(fields.exercises.map((snapshot) => this.starting(snapshot, fields)))
    return this.save({ ...fields, id: crypto.randomUUID(), exercises })
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

  // The exercise joins with the target startingTargetSets gives for last time before the session.
  async addExercise(session: WorkoutSession, exercise: Exercise): Promise<WorkoutSession> {
    if (hasExercise(session, exercise.id)) throw new Error('Exercise already exists in workout session')
    const added = await this.starting(snapshotFromExercise(exercise), session)
    return this.save({ ...session, exercises: [...session.exercises, added] })
  }

  // One more set to do for the exercise today, which leaves the session incomplete until it is logged.
  async addSetSlot(session: WorkoutSession, exerciseId: Exercise['id']): Promise<WorkoutSession> {
    const index = indexOfExercise(session, exerciseId)
    const exercise = session.exercises[index]
    const targetSets = progressOf(exercise).target + 1
    return this.save(withExerciseAt(session, index, { ...exercise, targetSets }))
  }

  // One set fewer to do for the exercise today. The target stays at or above the sets logged, and at least 1, since
  // removeExercise drops an exercise.
  async removeSetSlot(session: WorkoutSession, exerciseId: Exercise['id']): Promise<WorkoutSession> {
    const index = indexOfExercise(session, exerciseId)
    const exercise = session.exercises[index]
    if (!canRemoveSetSlot(progressOf(exercise))) throw new Error('No set left to remove')
    const targetSets = progressOf(exercise).target - 1
    return this.save(withExerciseAt(session, index, { ...exercise, targetSets }))
  }

  // Takes a logged set out, so its slot is one to do again. The sets after it move up a position, keeping the row IDs
  // in order, and the last row becomes a tombstone.
  async removeSet(session: WorkoutSession, exerciseId: Exercise['id'], setIndex: number): Promise<WorkoutSession> {
    const index = indexOfExercise(session, exerciseId)
    const stored = liveSets(await this.setsOf(session.id), exerciseId)
    if (!stored[setIndex]) throw new Error('Set not found in workout session')

    const exercise = session.exercises[index]
    const updatedAt = nowIso()
    const sets = exercise.sets.filter((_, position) => position !== setIndex)
    const moved = stored.slice(setIndex, -1).map((row, offset) => ({ ...row, set: sets[setIndex + offset], updatedAt }))
    const removed = tombstones(stored.slice(-1), updatedAt)
    return this.save(withExerciseAt(session, index, { ...exercise, sets }), [...moved, ...removed], updatedAt)
  }

  // Soft-deletes the exercise's sets with it.
  async removeExercise(session: WorkoutSession, exerciseId: Exercise['id']): Promise<WorkoutSession> {
    const updatedAt = nowIso()
    const removed = tombstones(liveSets(await this.setsOf(session.id), exerciseId), updatedAt)
    const exercises = session.exercises.filter((exercise) => exercise.exerciseId !== exerciseId)
    return this.save({ ...session, exercises }, removed, updatedAt)
  }

  // Puts the exercise in the old one's place, with the target addExercise gives it, and soft-deletes the old one's
  // sets.
  async swapExercise(
    session: WorkoutSession,
    oldExerciseId: Exercise['id'],
    exercise: Exercise
  ): Promise<WorkoutSession> {
    if (hasExercise(session, exercise.id)) throw new Error('Exercise already exists in workout session')
    const index = indexOfExercise(session, oldExerciseId)
    const swapped = await this.starting(snapshotFromExercise(exercise), session)
    const updatedAt = nowIso()
    const removed = tombstones(liveSets(await this.setsOf(session.id), oldExerciseId), updatedAt)
    return this.save(withExerciseAt(session, index, swapped), removed, updatedAt)
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

  // The exercise with no sets yet and its starting target in the session.
  private async starting(
    snapshot: ExerciseSnapshot,
    session: PlannedSession & { id?: WorkoutSession['id'] }
  ): Promise<ExerciseExecution> {
    const lastTime = await this.lastTimeOf(snapshot.exerciseId, session)
    return { ...snapshot, targetSets: startingTargetSets(snapshot, lastTime), sets: [] }
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
