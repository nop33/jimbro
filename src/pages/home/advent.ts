import { parseSimpleDate } from '../../dateUtils'
import type { WorkoutSession } from '../../db/types'
import { pullDownToClose } from '../../features/bottomSheet'
import { volumeOf } from '../../trainingNumbers'

// Advent of gains: a card on Home from Dec 1 to Dec 26 with a door for each day up to Christmas Eve. A workout on a day
// opens its door, and Christmas Eve's door opens with any workout in Christmas week, since few lift on the 24th. A tap on
// an open door shows a fun fact from that day's workouts. Nothing is stored: the doors come from the workouts.

export type DoorState = 'open' | 'missed' | 'today' | 'shut'

export interface Door {
  day: number
  date: string
  state: DoorState
  workouts: Array<WorkoutSession>
}

const DOORS = 24

// Home shows the card from the first door to Boxing Day.
export const adventShown = (today: string): boolean => {
  const monthDay = today.slice(5)
  return monthDay >= '12-01' && monthDay <= '12-26'
}

export const adventDoors = (sessions: Array<WorkoutSession>, today: string): Array<Door> => {
  const year = today.slice(0, 4)
  const dateOf = (day: number) => `${year}-12-${String(day).padStart(2, '0')}`
  return Array.from({ length: DOORS }, (_, index): Door => {
    const day = index + 1
    const date = dateOf(day)
    const from = day === DOORS ? dateOf(21) : date
    const workouts = sessions.filter((session) => session.date >= from && session.date <= date)
    const state: DoorState = workouts.length > 0 ? 'open' : date < today ? 'missed' : date === today ? 'today' : 'shut'
    return { day, date, state, workouts }
  })
}

const SLEIGH_KG = 4500
const REINDEER_KG = 150
const PRESENT_KG = 2
const GINGERBREAD_KG = 0.05
const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times']

const number = (value: number, digits = 0) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: digits }).format(value)
const weight = (kg: number) =>
  kg >= 1000 ? `${number(kg / 1000, 1)} ${kg === 1000 ? 'tonne' : 'tonnes'}` : `${number(kg)} kg`
const plural = (count: number, one: string, many = `${one}s`) => `${number(count)} ${count === 1 ? one : many}`

export interface DoorFact {
  title: string
  line: string
}

// What was behind a door, made from its workouts: the weight lifted, compared each day with something else of Santa's.
export const doorFact = (door: Door): DoorFact => {
  const volume = door.workouts.reduce((total, workout) => total + volumeOf(workout), 0)
  const sets = door.workouts.reduce(
    (total, workout) => total + workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    0
  )
  if (volume === 0) {
    return sets > 0
      ? { title: `You did ${plural(sets, 'set')}.`, line: 'Rudolph ran laps just watching you.' }
      : { title: 'You showed up.', line: "That's the hardest rep of all. Santa noticed." }
  }
  const title = `You lifted ${weight(volume)}.`
  if (door.day === DOORS) return { title, line: 'Gains in Christmas week. The elves are taking notes.' }
  switch (door.day % 4) {
    case 0: {
      const reindeer = Math.round(volume / REINDEER_KG)
      return reindeer >= 1
        ? { title, line: `That's ${plural(reindeer, 'reindeer', 'reindeer')}, antlers and all.` }
        : { title, line: `That's ${number((volume / REINDEER_KG) * 100)}% of a reindeer. A small one, but still.` }
    }
    case 1: {
      const sleighs = volume / SLEIGH_KG
      const times = Math.round(sleighs)
      return sleighs >= 0.75
        ? { title, line: `That's Santa's sleigh, fully loaded, ${TIMES[times] ?? `${times} times`} over.` }
        : { title, line: `That's ${number(sleighs * 100)}% of Santa's sleigh, fully loaded.` }
    }
    case 2:
      return {
        title,
        line: `That's ${plural(Math.round(volume / PRESENT_KG), 'present')}. The elves want you on the team.`
      }
    default:
      return {
        title,
        line: `That's ${plural(Math.round(volume / GINGERBREAD_KG), 'gingerbread man', 'gingerbread men')}. Don't eat them all.`
      }
  }
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const longDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

const STATE_LABELS: Record<DoorState, string> = {
  open: 'open',
  missed: 'shut, no workout that day',
  today: 'today, opens with a workout',
  shut: 'not yet'
}

// The card and the sheet an open door shows. Home makes one per visit.
export class AdventCalendar {
  private card = document.getElementById('advent') as HTMLElement
  private dialog = document.getElementById('advent-door-dialog') as HTMLDialogElement
  private nameOf: (programId: string) => string

  constructor(nameOf: (programId: string) => string) {
    this.nameOf = nameOf
    pullDownToClose(this.dialog)
  }

  show(sessions: Array<WorkoutSession>, today: string) {
    const doors = adventDoors(sessions, today)
    const opened = doors.filter((door) => door.state === 'open')
    const list = document.getElementById('advent-doors') as HTMLOListElement
    for (const door of doors) {
      const item = document.createElement('li')
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'advent-door'
      button.dataset.state = door.state
      button.textContent = String(door.day)
      button.setAttribute('aria-label', `Door ${door.day}, ${STATE_LABELS[door.state]}`)
      if (door.state === 'open') {
        const present = document.createElement('span')
        present.className = 'advent-present'
        present.setAttribute('aria-hidden', 'true')
        button.append(present)
        button.addEventListener('click', () => this.open(door))
      } else {
        button.disabled = true
      }
      if (door.day === DOORS) button.dataset.eve = ''
      item.append(button)
      list.append(item)
    }

    const christmasCame = today.slice(5) >= '12-25'
    ;(document.getElementById('advent-heading') as HTMLHeadingElement).textContent = christmasCame
      ? 'Merry Christmas!'
      : 'Advent of gains'
    ;(document.getElementById('advent-count') as HTMLParagraphElement).textContent = `${opened.length} of ${DOORS} open`
    const volume = opened.reduce(
      (total, door) => total + door.workouts.reduce((sum, workout) => sum + volumeOf(workout), 0),
      0
    )
    const todayDoor = doors.find((door) => door.date === today)
    ;(document.getElementById('advent-note') as HTMLParagraphElement).textContent = christmasCame
      ? `You lifted ${weight(volume)} this Advent. Santa's impressed.`
      : todayDoor?.state === 'open'
        ? "Today's door is open. Tap it to see what's inside."
        : "Every workout opens that day's door. Today's is waiting for you."
    this.card.hidden = false
  }

  private open(door: Door) {
    const fact = doorFact(door)
    const date = parseSimpleDate(door.date)
    ;(document.getElementById('advent-door-day') as HTMLParagraphElement).textContent =
      `Door ${door.day} · ${dayFormat.format(date)}`
    ;(document.getElementById('advent-door-title') as HTMLHeadingElement).textContent = fact.title
    ;(document.getElementById('advent-door-line') as HTMLParagraphElement).textContent = fact.line
    const sets = door.workouts.reduce(
      (total, workout) => total + workout.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
      0
    )
    const names = door.workouts.map((workout) => this.nameOf(workout.programId)).join(' and ')
    const when = door.workouts.length === 1 && door.workouts[0].date !== door.date
    ;(document.getElementById('advent-door-detail') as HTMLParagraphElement).textContent =
      `${names}${when ? ` on ${longDayFormat.format(parseSimpleDate(door.workouts[0].date))}` : ''} · ${plural(sets, 'set')}`
    this.dialog.showModal()
  }
}
