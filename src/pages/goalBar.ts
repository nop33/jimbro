// The week's goal bar, on the home page's week card and the workouts page's progress card: one segment per workout
// the goal asks for, filled for each one that counts, first those done ahead last week, then this week's own. A
// workout beyond the goal adds a lighter segment, since it counts toward next week.
export const fillGoalBar = (
  bar: HTMLElement,
  { goal, completed, ahead, extra }: { goal: number; completed: number; ahead: number; extra: number }
) => {
  for (let index = 0; index < goal; index++) {
    const segment = document.createElement('span')
    if (index < ahead) segment.classList.add('met', 'ahead')
    else if (index < ahead + completed) segment.classList.add('met')
    bar.appendChild(segment)
  }
  for (let index = 0; index < extra; index++) {
    const segment = document.createElement('span')
    segment.classList.add('extra')
    bar.appendChild(segment)
  }
}

const workouts = (count: number) => `${count} ${count === 1 ? 'workout' : 'workouts'}`

// What the bar's lighter segments mean, in words: workouts done ahead last week, or this week's extras.
export const carryNote = ({ ahead, extra }: { ahead: number; extra: number }) =>
  extra > 0 ? `+${workouts(extra)} toward next week` : ahead > 0 ? `${workouts(ahead)} done ahead last week` : ''
