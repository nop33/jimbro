import {
  defaultFieldName,
  defaultLabel,
  defaultPresetForKind,
  defaultSlotsForPreset,
  EXERCISE_KIND_LABELS,
  EXERCISE_KINDS,
  fromDisplayValues,
  LOG_PRESET_SPECS,
  muscleRequired,
  parseExerciseKind,
  parseLogPreset,
  presetsForKind,
  toDisplayValues,
  type ExerciseKind,
  type LogPreset
} from '../../db/exerciseLogging'
import type { Exercise } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'
import ExercisesState from '../../state/ExercisesState'
import MuscleGroupSelect from './MuscleGroupSelect'

class ExerciseDialog {
  private static newExerciseButton = document.querySelector('#new-exercise-btn') as HTMLButtonElement
  private static exerciseDialog = document.querySelector('#exercise-dialog') as HTMLDialogElement
  private static dialogCancel = document.querySelector('#dialog-cancel') as HTMLButtonElement
  private static exerciseForm = document.querySelector('#exercise-form') as HTMLFormElement
  private static exerciseIdInput = document.querySelector('#exercise-id') as HTMLInputElement
  private static exerciseNameInput = document.querySelector('#exercise-name') as HTMLInputElement
  private static exerciseKindSelect = document.querySelector('#exercise-kind') as HTMLSelectElement
  private static exercisePresetField = document.querySelector('#exercise-preset-field') as HTMLDivElement
  private static exercisePresetSelect = document.querySelector('#exercise-preset') as HTMLSelectElement
  private static exerciseMuscleField = document.querySelector('#exercise-muscle-field') as HTMLDivElement
  private static exerciseMuscleSelect = document.querySelector('#exercise-muscle') as HTMLSelectElement
  private static exerciseSetsInput = document.querySelector('#exercise-sets') as HTMLInputElement
  private static exerciseDefaults = document.querySelector('#exercise-defaults') as HTMLDivElement
  private static dialogTitle = document.querySelector('#dialog-title') as HTMLHeadingElement
  private static deleteExerciseBtn = document.querySelector('#delete-exercise-btn') as HTMLButtonElement

  static openDialog() {
    this.exerciseDialog.showModal()
  }

  static closeDialog() {
    this.exerciseDialog.close()
  }

  static init() {
    this.renderKindPicker()
    this.renderMusclePicker()
    this.populateForm()

    this.exerciseKindSelect.addEventListener('change', () => this.onKindChanged())
    this.exercisePresetSelect.addEventListener('change', () => this.renderPresetFields())

    window.addEventListener('exercise-clicked', (e) => {
      const exercise = (e as CustomEvent<{ exercise: Exercise }>).detail.exercise
      this.populateForm(exercise)
      this.openDialog()
    })

    this.newExerciseButton.addEventListener('click', () => {
      this.populateForm()
      this.openDialog()
    })

    this.dialogCancel.addEventListener('click', () => {
      this.closeDialog()
    })

    this.exerciseDialog.querySelector('.close-dialog-btn')?.addEventListener('click', () => {
      this.closeDialog()
    })

    this.deleteExerciseBtn.addEventListener('click', () => {
      this.deleteExercise()
    })

    this.exerciseForm.addEventListener('submit', async (e) => {
      e.preventDefault()
      const formData = new FormData(this.exerciseForm)
      const id = this.exerciseIdInput.value
      const preset = this.selectedPreset()
      const name = formData.get('name') as string
      const targetSets = parseInt(formData.get('sets') as string)
      const muscle = muscleRequired(preset) ? (formData.get('muscle') as Exercise['muscle']) : undefined
      const defaults = fromDisplayValues(preset, this.enteredDefaults(preset))

      const fields = { name, kind: LOG_PRESET_SPECS[preset].kind, preset, muscle, targetSets, defaults }

      try {
        if (id) {
          const existing = ExercisesState.getById(id)
          if (!existing) throw new Error('Exercise not found')
          await ExercisesState.updateExercise({ ...existing, ...fields })
        } else {
          await ExercisesState.createExercise({ ...fields, isDeleted: false })
        }

        this.closeDialog()
        Toasts.show({ message: 'Exercise saved!' })
      } catch (error) {
        console.error('Error saving exercise:', error)
        Toasts.show({ message: `Could not save exercise: ${error}`, type: 'error' })
      }
    })
  }

  static populateForm(exercise?: Exercise) {
    if (exercise) {
      this.dialogTitle.textContent = 'Edit Exercise'
      this.exerciseIdInput.value = exercise.id
      this.deleteExerciseBtn.classList.remove('hidden')
      this.exerciseNameInput.value = exercise.name
      this.exerciseKindSelect.value = exercise.kind
      this.exerciseMuscleSelect.value = exercise.muscle ?? ''
      this.exerciseSetsInput.value = exercise.targetSets.toString()
      this.renderPresetPicker(exercise.kind, exercise.preset)
      this.renderPresetFields(exercise.defaults)
    } else {
      this.dialogTitle.textContent = 'New Exercise'
      this.exerciseForm.reset()
      this.exerciseIdInput.value = ''
      this.exerciseKindSelect.value = 'lifting'
      this.deleteExerciseBtn.classList.add('hidden')
      this.onKindChanged()
    }
  }

  private static selectedKind(): ExerciseKind {
    return parseExerciseKind(this.exerciseKindSelect.value) ?? 'lifting'
  }

  private static selectedPreset(): LogPreset {
    const kind = this.selectedKind()
    const preset = parseLogPreset(this.exercisePresetSelect.value)
    return preset && LOG_PRESET_SPECS[preset].kind === kind ? preset : defaultPresetForKind(kind)
  }

  private static onKindChanged() {
    const kind = this.selectedKind()
    this.renderPresetPicker(kind, defaultPresetForKind(kind))
    this.renderPresetFields()
  }

  private static renderKindPicker() {
    this.exerciseKindSelect.replaceChildren(
      ...EXERCISE_KINDS.map((kind) => new Option(EXERCISE_KIND_LABELS[kind], kind))
    )
  }

  private static renderPresetPicker(kind: ExerciseKind, preset: LogPreset) {
    const presets = presetsForKind(kind)

    this.exercisePresetSelect.replaceChildren(
      ...presets.map((option) => new Option(LOG_PRESET_SPECS[option].label, option))
    )
    this.exercisePresetSelect.value = presets.includes(preset) ? preset : presets[0]
    this.exercisePresetField.classList.toggle('hidden', presets.length < 2)
  }

  private static renderPresetFields(defaults: Exercise['defaults'] = {}) {
    const preset = this.selectedPreset()
    const needsMuscle = muscleRequired(preset)
    const display = toDisplayValues(preset, defaults)

    this.exerciseMuscleField.classList.toggle('hidden', !needsMuscle)
    this.exerciseMuscleSelect.required = needsMuscle

    this.exerciseDefaults.replaceChildren(
      ...defaultSlotsForPreset(preset).map((spec) => {
        const wrapper = document.createElement('div')
        const inputId = defaultFieldName(spec.slot)

        const label = document.createElement('label')
        label.htmlFor = inputId
        label.textContent = defaultLabel(spec)

        const input = document.createElement('input')
        input.type = 'number'
        input.id = inputId
        input.name = inputId
        input.min = String(spec.min)
        input.step = String(spec.step)
        input.required = true

        const value = display[spec.slot]
        if (value !== undefined) input.value = String(value)

        wrapper.append(label, input)
        return wrapper
      })
    )
  }

  private static enteredDefaults(preset: LogPreset): Record<string, FormDataEntryValue | null> {
    const formData = new FormData(this.exerciseForm)
    const entered: Record<string, FormDataEntryValue | null> = {}

    for (const { slot } of defaultSlotsForPreset(preset)) {
      entered[slot] = formData.get(defaultFieldName(slot))
    }

    return entered
  }

  private static renderMusclePicker() {
    const musclePicker = new MuscleGroupSelect({ selector: '#exercise-muscle' })
    musclePicker.render({ includeOptionAll: false })
  }

  private static async deleteExercise() {
    if (confirm('Are you sure you want to delete this exercise?')) {
      try {
        await ExercisesState.softDeleteExercise(this.exerciseIdInput.value)
        this.closeDialog()
        Toasts.show({ message: 'Exercise deleted.' })
      } catch (error) {
        console.error('Error deleting exercise:', error)
        Toasts.show({ message: `Could not delete exercise: ${error}`, type: 'error' })
      }
    }
  }
}

export default ExerciseDialog
