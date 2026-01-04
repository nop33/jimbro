import { MUSCLE_GROUPS } from '../../db/stores/exercisesStore'

interface MuscleGroupSelectProps {
  selector: string
  onSelect?: (muscleGroup: string) => void
}

interface MuscleGroupSelectRenderProps {
  includeOptionAll: boolean
}

class MuscleGroupSelect {
  private muscleGroupSelect: HTMLSelectElement
  public selectedMuscle: string

  constructor({ selector, onSelect }: MuscleGroupSelectProps) {
    this.selectedMuscle = 'All'
    this.muscleGroupSelect = document.querySelector(selector) as HTMLSelectElement
    this.muscleGroupSelect.addEventListener('change', (e) => {
      const selectedMuscle = (e.target as HTMLSelectElement).value
      onSelect?.(selectedMuscle)
      this.selectedMuscle = selectedMuscle
    })
  }

  render({ includeOptionAll }: MuscleGroupSelectRenderProps) {
    const options = ['<option value="">Select muscle group...</option>']
    if (includeOptionAll) {
      options.push(`<option value="All">All</option>`)
    }
    options.push(...MUSCLE_GROUPS.map((muscle) => `<option value="${muscle}">${muscle}</option>`))
    this.muscleGroupSelect.innerHTML = options.join('')
  }
}

export default MuscleGroupSelect
