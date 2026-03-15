import EventEmitter from '../../eventEmitter'
import type { Exercise } from '../../db/stores/exercisesStore'
import ExercisesState from '../../state/ExercisesState'
import { nodeFromTemplate, setTextContent } from '../../utils'
import type { ExercisesListProps } from './programTypes'

type ProgramExercisesSortableListEventMap = {
  'reordered-exercises': { reorderedExerciseIds: Array<Exercise['id']> }
}

class ProgramExercisesSortableList extends EventEmitter<ProgramExercisesSortableListEventMap> {
  private selectedExercisesList: HTMLUListElement

  constructor(selector: string) {
    super()
    this.selectedExercisesList = document.querySelector(selector) as HTMLUListElement
    this.init()
  }

  private init() {
    let draggingItem: HTMLElement | null = null

    let isMoved = false

    const startDrag = (e: TouchEvent | MouseEvent) => {
      const target = e.target as HTMLElement

      const item = target.closest('.sortable-item') as HTMLElement
      if (!item) return

      draggingItem = item
      draggingItem.classList.add('dragging')
      isMoved = false

      // Add global listeners dynamically to handle dragging outside the container cleanly
      document.addEventListener('mousemove', moveDrag, { passive: false })
      document.addEventListener('mouseup', endDrag)
      document.addEventListener('touchmove', moveDrag, { passive: false })
      document.addEventListener('touchend', endDrag)
      document.addEventListener('touchcancel', endDrag)
    }

    const moveDrag = (e: TouchEvent | MouseEvent) => {
      if (!draggingItem) return

      e.preventDefault() // prevent scrolling while dragging
      isMoved = true

      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY
      const draggingOverItem = this.getDragAfterElement(this.selectedExercisesList, clientY)

      document.querySelectorAll('.sortable-item').forEach((item) => item.classList.remove('over'))

      if (draggingOverItem) {
        draggingOverItem.classList.add('over')
        this.selectedExercisesList.insertBefore(draggingItem, draggingOverItem)
      } else {
        this.selectedExercisesList.appendChild(draggingItem)
      }
    }

    const endDrag = () => {
      if (!draggingItem) return

      draggingItem.classList.remove('dragging')
      document.querySelectorAll('.sortable-item').forEach((item) => item.classList.remove('over'))
      draggingItem = null

      // Clean up global listeners
      document.removeEventListener('mousemove', moveDrag)
      document.removeEventListener('mouseup', endDrag)
      document.removeEventListener('touchmove', moveDrag)
      document.removeEventListener('touchend', endDrag)
      document.removeEventListener('touchcancel', endDrag)

      if (isMoved) {
        const reorderedExerciseIds = Array.from(this.selectedExercisesList.children)
          .map((child) => child.attributes.getNamedItem('data-exercise-id')?.value)
          .filter((id) => id !== undefined)
        this.emit('reordered-exercises', { reorderedExerciseIds })
      }
    }

    // Initialize list listeners to start the drag
    this.selectedExercisesList.addEventListener('touchstart', startDrag, { passive: false })
    this.selectedExercisesList.addEventListener('mousedown', startDrag)
  }

  private getDragAfterElement = (container: HTMLElement, y: number) => {
    const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')]

    const result = draggableElements.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect()
        const offset = y - box.top - box.height / 2
        if (offset < 0 && offset > closest.offset) {
          return { offset: offset, element: child }
        } else {
          return closest
        }
      },
      { offset: Number.NEGATIVE_INFINITY } as { offset: number; element: Element | null }
    )

    return result.element
  }

  render({ selectedExercises }: ExercisesListProps) {
    this.selectedExercisesList.innerHTML = ''
    const selectedExercisesIds = Array.from(selectedExercises)

    const exerciseListItems = selectedExercisesIds
      .map((exerciseId) => {
        const exercise = ExercisesState.getById(exerciseId)
        if (!exercise) return

        const exerciseItem = nodeFromTemplate('#selected-exercise-item-template')
        setTextContent('.selected-exercise-name', exercise.name, exerciseItem)
        setTextContent('.selected-exercise-muscle', exercise.muscle, exerciseItem)
        exerciseItem.firstElementChild?.setAttribute('data-exercise-id', exerciseId)

        return exerciseItem
      })
      .filter((exerciseItem) => exerciseItem !== undefined)

    this.selectedExercisesList.append(...exerciseListItems)
  }
}

export default ProgramExercisesSortableList
