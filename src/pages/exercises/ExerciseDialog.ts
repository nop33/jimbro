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
  type LogPreset,
  type SetSlotSpec
} from '../../db/exerciseLogging'
import { exercisesStore, type Exercise } from '../../db/stores/exercisesStore'
import Toasts from '../../features/toasts'
import MuscleGroupSelect from './MuscleGroupSelect'
import { pullDownToClose } from '../../features/bottomSheet'

// One choice of a segmented switch: a radio filling its label, so a tap anywhere on the segment picks it.
const segment = (name: string, value: string, text: string): HTMLLabelElement => {
  const label = document.createElement('label')
  const radio = document.createElement('input')
  radio.type = 'radio'
  radio.name = name
  radio.value = value
  label.append(radio, text)
  return label
}

// A default as a Settings row: its name on the left, and − and + around the number on the right.
const stepperRow = (spec: SetSlotSpec, value: number | undefined): HTMLDivElement => {
  const inputId = defaultFieldName(spec.slot)
  const row = document.createElement('div')
  row.className = 'settings-row'
  row.dataset.default = spec.slot

  const label = document.createElement('label')
  label.htmlFor = inputId
  label.className = 'settings-row-label'
  label.textContent = spec.rowLabel
  if (spec.unit) {
    const unit = document.createElement('span')
    unit.className = 'settings-row-detail'
    unit.textContent = spec.unit
    label.append(unit)
  }

  const input = document.createElement('input')
  input.type = 'number'
  input.id = inputId
  input.name = inputId
  input.min = String(spec.min)
  input.step = String(spec.step)
  input.inputMode = Number.isInteger(spec.step) ? 'numeric' : 'decimal'
  input.ariaLabel = defaultLabel(spec)
  input.required = true
  if (value !== undefined) input.value = String(value)

  const stepper = document.createElement('div')
  stepper.className = 'stepper'
  stepper.append(stepButton(spec, -1), input, stepButton(spec, 1))

  row.append(label, stepper)
  return row
}

const stepButton = (spec: SetSlotSpec, direction: 1 | -1): HTMLButtonElement => {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.step = String(direction)
  button.ariaLabel = `${spec.rowLabel} ${direction > 0 ? 'up' : 'down'}`
  button.textContent = direction > 0 ? '+' : '−'
  return button
}

class ExerciseDialog {
  private newExerciseButton = document.querySelector('#new-exercise-btn') as HTMLButtonElement
  private exerciseDialog = document.querySelector('#exercise-dialog') as HTMLDialogElement
  private exerciseForm = document.querySelector('#exercise-form') as HTMLFormElement
  private exerciseIdInput = document.querySelector('#exercise-id') as HTMLInputElement
  private exerciseNameInput = document.querySelector('#exercise-name') as HTMLInputElement
  private exerciseKindPicker = document.querySelector('#exercise-kind') as HTMLDivElement
  private exercisePresetField = document.querySelector('#exercise-preset-field') as HTMLFieldSetElement
  private exercisePresetPicker = document.querySelector('#exercise-preset') as HTMLDivElement
  private exerciseMuscleField = document.querySelector('#exercise-muscle-field') as HTMLDivElement
  private exerciseMuscleSelect = document.querySelector('#exercise-muscle') as HTMLSelectElement
  private exerciseSetsInput = document.querySelector('#exercise-sets') as HTMLInputElement
  private exerciseDefaults = document.querySelector('#exercise-defaults') as HTMLDivElement
  private dialogTitle = document.querySelector('#dialog-title') as HTMLHeadingElement
  private deleteExerciseBtn = this.exerciseDialog.querySelector('.delete-btn') as HTMLButtonElement

  constructor() {
    pullDownToClose(this.exerciseDialog)
    this.renderKindPicker()
    this.renderMusclePicker()
    this.populateForm()

    this.exerciseKindPicker.addEventListener('change', () => this.onKindChanged())
    this.exercisePresetPicker.addEventListener('change', () => this.renderPresetFields())
    this.exerciseDefaults.addEventListener('click', (event) => this.onStepperClick(event))
    this.exerciseDefaults.addEventListener('input', () => this.updateSteppers())

    this.newExerciseButton.addEventListener('click', () => this.open())

    this.deleteExerciseBtn.addEventListener('click', () => {
      void this.deleteExercise()
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
          const existing = exercisesStore.find(id)
          if (!existing) throw new Error('Exercise not found')
          await exercisesStore.update({ ...existing, ...fields })
        } else {
          await exercisesStore.create(fields)
        }

        this.closeDialog()
        Toasts.show({ message: 'Exercise saved!' })
      } catch (error) {
        console.error('Error saving exercise:', error)
        Toasts.show({ message: `Could not save exercise: ${String(error)}`, type: 'error' })
      }
    })
  }

  // Opens on the exercise to edit, or on an empty form for a new one.
  open(exercise?: Exercise) {
    this.populateForm(exercise)
    this.exerciseDialog.showModal()
  }

  private closeDialog() {
    this.exerciseDialog.close()
  }

  private populateForm(exercise?: Exercise) {
    // showModal() focuses the autofocus element: the name of a new exercise, so the keyboard opens to type it, or the
    // title when editing, so no field takes the focus and opens the keyboard over what you came to see.
    this.exerciseNameInput.autofocus = !exercise
    this.dialogTitle.autofocus = Boolean(exercise)

    if (exercise) {
      this.dialogTitle.textContent = 'Edit Exercise'
      this.exerciseIdInput.value = exercise.id
      this.deleteExerciseBtn.hidden = false
      this.exerciseNameInput.value = exercise.name
      this.checkRadio('kind', exercise.kind)
      this.exerciseMuscleSelect.value = exercise.muscle ?? ''
      this.exerciseSetsInput.value = exercise.targetSets.toString()
      this.renderPresetPicker(exercise.kind, exercise.preset)
      this.renderPresetFields(exercise.defaults)
    } else {
      this.dialogTitle.textContent = 'New Exercise'
      this.exerciseForm.reset()
      this.exerciseIdInput.value = ''
      this.checkRadio('kind', 'lifting')
      this.deleteExerciseBtn.hidden = true
      this.onKindChanged()
    }
  }

  private selectedKind(): ExerciseKind {
    return parseExerciseKind(this.radioValue('kind')) ?? 'lifting'
  }

  private selectedPreset(): LogPreset {
    const kind = this.selectedKind()
    const preset = parseLogPreset(this.radioValue('preset'))
    return preset && LOG_PRESET_SPECS[preset].kind === kind ? preset : defaultPresetForKind(kind)
  }

  private onKindChanged() {
    const kind = this.selectedKind()
    this.renderPresetPicker(kind, defaultPresetForKind(kind))
    this.renderPresetFields()
  }

  private renderKindPicker() {
    this.exerciseKindPicker.replaceChildren(
      ...EXERCISE_KINDS.map((kind) => segment('kind', kind, EXERCISE_KIND_LABELS[kind]))
    )
  }

  private renderPresetPicker(kind: ExerciseKind, preset: LogPreset) {
    const presets = presetsForKind(kind)

    this.exercisePresetPicker.replaceChildren(
      ...presets.map((option) => segment('preset', option, LOG_PRESET_SPECS[option].label))
    )
    this.checkRadio('preset', presets.includes(preset) ? preset : presets[0])
    this.exercisePresetField.classList.toggle('hidden', presets.length < 2)
  }

  private radios(name: 'kind' | 'preset'): HTMLInputElement[] {
    return [...this.exerciseForm.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`)]
  }

  private radioValue(name: 'kind' | 'preset'): string {
    return this.radios(name).find((radio) => radio.checked)?.value ?? ''
  }

  private checkRadio(name: 'kind' | 'preset', value: string) {
    for (const radio of this.radios(name)) radio.checked = radio.value === value
  }

  // − and + step the number in their row through the input's own stepDown() and stepUp(), which keep to its min
  // and step. The number stays a field, so a value far from the default can still be typed.
  private onStepperClick(event: Event) {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-step]')
    const input = button?.parentElement?.querySelector('input')
    if (!button || !input) return

    if (button.dataset.step === '1') input.stepUp()
    else input.stepDown()
    this.updateSteppers()
  }

  // A − at the input's minimum can take nothing off, so it shows as disabled.
  private updateSteppers() {
    for (const input of this.exerciseDefaults.querySelectorAll('input')) {
      const less = input.parentElement?.querySelector<HTMLButtonElement>('button[data-step="-1"]')
      if (less) less.disabled = input.value !== '' && Number(input.value) <= Number(input.min)
    }
  }

  private renderPresetFields(defaults: Exercise['defaults'] = {}) {
    const preset = this.selectedPreset()
    const needsMuscle = muscleRequired(preset)
    const display = toDisplayValues(preset, defaults)

    this.exerciseMuscleField.classList.toggle('hidden', !needsMuscle)
    this.exerciseMuscleSelect.required = needsMuscle

    // The sets row stays, and each of the preset's defaults gets a row after it.
    for (const row of this.exerciseDefaults.querySelectorAll('[data-default]')) row.remove()
    this.exerciseDefaults.append(...defaultSlotsForPreset(preset).map((spec) => stepperRow(spec, display[spec.slot])))
    this.updateSteppers()
  }

  private enteredDefaults(preset: LogPreset): Record<string, FormDataEntryValue | null> {
    const formData = new FormData(this.exerciseForm)
    const entered: Record<string, FormDataEntryValue | null> = {}

    for (const { slot } of defaultSlotsForPreset(preset)) {
      entered[slot] = formData.get(defaultFieldName(slot))
    }

    return entered
  }

  private renderMusclePicker() {
    const musclePicker = new MuscleGroupSelect({ selector: '#exercise-muscle' })
    musclePicker.render({ includeOptionAll: false })
  }

  private async deleteExercise() {
    if (confirm('Are you sure you want to delete this exercise?')) {
      try {
        await exercisesStore.remove(this.exerciseIdInput.value)
        this.closeDialog()
        Toasts.show({ message: 'Exercise deleted.' })
      } catch (error) {
        console.error('Error deleting exercise:', error)
        Toasts.show({ message: `Could not delete exercise: ${String(error)}`, type: 'error' })
      }
    }
  }
}

export default ExerciseDialog
