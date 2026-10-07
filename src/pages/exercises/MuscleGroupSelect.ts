import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS } from '../../db/muscleGroups'

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
    const options = [new Option('Select muscle group...', '')]
    if (includeOptionAll) {
      options.push(new Option('All', 'All'))
    }
    options.push(...MUSCLE_GROUPS.map((muscle) => new Option(MUSCLE_GROUP_LABELS[muscle], muscle)))
    this.muscleGroupSelect.replaceChildren(...options)
  }
}

export default MuscleGroupSelect
