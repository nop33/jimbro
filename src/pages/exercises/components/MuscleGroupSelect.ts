import EventEmitter from '../../../db/eventEmitter'
import { MUSCLE_GROUPS } from '../../../db/stores/exercisesStore'

export type MuscleGroupSelectEventMap = {
  'muscle-group-selected': { muscleGroup: string }
}

class MuscleGroupSelect extends EventEmitter<MuscleGroupSelectEventMap> {
  private muscleGroupSelect: HTMLSelectElement
  public selectedMuscle: string

  constructor(selector: string) {
    super()
    this.selectedMuscle = 'All'
    this.muscleGroupSelect = document.querySelector(selector)!
    this.muscleGroupSelect.addEventListener('change', this.handleSelect)
  }

  handleSelect = (e: Event) => {
    const selectedMuscle = (e.target as HTMLSelectElement).value
    this.selectedMuscle = selectedMuscle
    this.emit('muscle-group-selected', { muscleGroup: selectedMuscle })
  }

  render({ includeOptionAll }: { includeOptionAll: boolean }) {
    const options = ['<option value="">Select muscle group...</option>']
    if (includeOptionAll) {
      options.push(`<option value="All">All</option>`)
    }
    options.push(...MUSCLE_GROUPS.map((muscle) => `<option value="${muscle}">${muscle}</option>`))
    this.muscleGroupSelect.innerHTML = options.join('')
  }

  destroy() {
    this.muscleGroupSelect.removeEventListener('change', this.handleSelect)
  }
}

export default MuscleGroupSelect
