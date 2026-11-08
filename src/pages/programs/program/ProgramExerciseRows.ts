import { exercisesStore, type Exercise } from '../../../db/stores/exercisesStore'
import { nodeFromTemplate, setTextContent } from '../../../utils'
import { exerciseDetail } from '../programExercises'

interface RowActions {
  // The visible rows' new order, after a drag or an arrow key on a handle.
  reorder: (ids: Array<Exercise['id']>) => void
  remove: (id: Exercise['id']) => void
}

// The program's exercises in order. A row moves only by its handle, dragged or with the arrow keys, so a thumb
// anywhere else on the list scrolls the page as any list does.
class ProgramExerciseRows {
  private list = document.querySelector('#program-exercises') as HTMLUListElement
  private dragging: HTMLLIElement | undefined

  private actions: RowActions

  constructor(actions: RowActions) {
    this.actions = actions
  }

  // Redraws the rows, unless one is being dragged, and keeps focus on the handle or button it was on.
  render(ids: Array<Exercise['id']>) {
    if (this.dragging) return
    const focused = document.activeElement
    const focusedRow = focused instanceof HTMLElement ? focused.closest<HTMLLIElement>('.program-row') : null
    const refocus = focusedRow && this.list.contains(focusedRow) ? focused?.className : undefined
    const refocusId = focusedRow?.dataset.exerciseId

    this.list.replaceChildren(
      ...ids
        .map((id) => exercisesStore.find(id))
        .filter((exercise): exercise is Exercise => exercise !== undefined)
        .map((exercise) => this.row(exercise))
    )

    if (refocus && refocusId) {
      const row = this.list.querySelector<HTMLLIElement>(`[data-exercise-id="${CSS.escape(refocusId)}"]`)
      row?.querySelector<HTMLElement>(`.${refocus.split(' ')[0]}`)?.focus()
    }
  }

  private row(exercise: Exercise) {
    const fragment = nodeFromTemplate('#program-exercise-template')
    const row = fragment.querySelector('li') as HTMLLIElement
    row.dataset.exerciseId = exercise.id
    setTextContent('.program-row-name', exercise.name, row)
    setTextContent('.program-row-detail', exerciseDetail(exercise), row)

    const handle = row.querySelector('.program-row-handle') as HTMLButtonElement
    handle.setAttribute('aria-label', `Reorder ${exercise.name}`)
    handle.setAttribute('aria-description', 'Drag, or use the up and down arrow keys')
    this.wireHandle(row, handle)

    const remove = row.querySelector('.program-row-remove') as HTMLButtonElement
    remove.setAttribute('aria-label', `Remove ${exercise.name}`)
    remove.addEventListener('click', () => this.actions.remove(exercise.id))
    return fragment
  }

  private order() {
    return [...this.list.querySelectorAll<HTMLLIElement>('.program-row')].map((row) => row.dataset.exerciseId ?? '')
  }

  // Pointer events with the pointer captured by the handle, so one handler follows a finger or a mouse anywhere on
  // the screen, and nothing listens on the document. The arrow keys move the row by one.
  private wireHandle(row: HTMLLIElement, handle: HTMLButtonElement) {
    let before: string | undefined

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      handle.setPointerCapture(event.pointerId)
      before = this.order().join()
      this.dragging = row
      row.classList.add('dragging')
    })

    // The dragged row itself never leaves its place in the document, which would take the pointer capture from its
    // handle: the neighbour it passes moves to its other side instead.
    handle.addEventListener('pointermove', (event) => {
      if (this.dragging !== row) return
      const middle = (other: Element) => {
        const box = other.getBoundingClientRect()
        return box.top + box.height / 2
      }
      for (;;) {
        const previous = row.previousElementSibling
        const next = row.nextElementSibling
        if (previous && event.clientY < middle(previous)) row.after(previous)
        else if (next && event.clientY > middle(next)) row.before(next)
        else break
      }
      this.scrollNearEdge(event.clientY)
    })

    const drop = () => {
      if (this.dragging !== row) return
      this.dragging = undefined
      row.classList.remove('dragging')
      if (this.order().join() !== before) this.actions.reorder(this.order())
    }
    handle.addEventListener('pointerup', drop)
    handle.addEventListener('pointercancel', drop)
    handle.addEventListener('lostpointercapture', drop)

    handle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
      event.preventDefault()
      const neighbour = event.key === 'ArrowUp' ? row.previousElementSibling : row.nextElementSibling
      if (!neighbour) return
      if (event.key === 'ArrowUp') row.after(neighbour)
      else row.before(neighbour)
      handle.focus()
      this.actions.reorder(this.order())
    })
  }

  // A row dragged near the top or bottom of the screen scrolls the page under it, so it can reach any place in a
  // long program.
  private scrollNearEdge(y: number) {
    const scroller = this.list.closest('.app-page-content')
    if (!scroller) return
    const { top, bottom } = scroller.getBoundingClientRect()
    const edge = 64
    if (y < top + edge) scroller.scrollBy(0, -12)
    else if (y > bottom - edge) scroller.scrollBy(0, 12)
  }
}

export default ProgramExerciseRows
