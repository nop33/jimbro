import type { Exercise } from "../../db/stores/exercisesStore";
import { nodeFromTemplate, setTextContent } from "../../utils";
import type { ExercisesListProps } from "./programTypes";

type ProgramExercisesSortableListProps = {
  onReorder: (reorderedExerciseIds: Array<Exercise['id']>) => void;
}

class ProgramExercisesSortableList {
  private static selectedExercisesList = document.querySelector('#selected-exercises-list') as HTMLUListElement;

  static init({ onReorder }: ProgramExercisesSortableListProps) {
    let draggingItem: HTMLElement | null = null;

    this.selectedExercisesList.addEventListener('dragstart', (e) => {
      draggingItem = e.target as HTMLElement;
      draggingItem?.classList.add('dragging');
    });

    this.selectedExercisesList.addEventListener('dragend', () => {
      draggingItem?.classList.remove('dragging');
      document.querySelectorAll('.sortable-item').forEach(item => item.classList.remove('over'));
      draggingItem = null;

      const reorderedExerciseIds = Array.from(this.selectedExercisesList.children).map((child) => child.attributes.getNamedItem('data-exercise-id')?.value).filter((id) => id !== undefined)
      onReorder(reorderedExerciseIds)
    });

    this.selectedExercisesList.addEventListener('dragover', (e) => {
      e.preventDefault();
      const draggingOverItem = this.getDragAfterElement(this.selectedExercisesList, e.clientY);
      document.querySelectorAll('.sortable-item').forEach(item => item.classList.remove('over'));
      if (draggingOverItem) {
        draggingOverItem.classList.add('over');
        if (draggingItem) {
          this.selectedExercisesList.insertBefore(draggingItem, draggingOverItem);
        }
      } else {
        if (draggingItem) {
          this.selectedExercisesList.appendChild(draggingItem);
        }
      }
    });
  }

  private static getDragAfterElement = (container: HTMLElement, y: number) => {
    const draggableElements = [...container.querySelectorAll('.sortable-item:not(.dragging)')];

    const result = draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY } as { offset: number, element: Element | null });

    return result.element;
  }

  static render({ selectedExercises, allExercises }: ExercisesListProps) {
    this.selectedExercisesList.innerHTML = ''
    const selectedExercisesIds = Array.from(selectedExercises)

    const exerciseListItems = selectedExercisesIds.map((exerciseId) => {
      const exercise = allExercises.find((exercise) => exercise.id === exerciseId)
      if (!exercise) return

      const exerciseItem = nodeFromTemplate('#selected-exercise-item-template')
      setTextContent('.selected-exercise-name', exercise.name, exerciseItem)
      setTextContent('.selected-exercise-muscle', exercise.muscle, exerciseItem)
      exerciseItem.firstElementChild?.setAttribute('data-exercise-id', exerciseId)

      return exerciseItem;
    }).filter((exerciseItem) => exerciseItem !== undefined);

    this.selectedExercisesList.append(...exerciseListItems)
  }
}

export default ProgramExercisesSortableList
