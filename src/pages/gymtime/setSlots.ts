import {
  buildSet,
  fromDisplayValues,
  inputLabel,
  setFieldName,
  setFields,
  slotsForPreset,
  toDisplayValues,
  type ExerciseDefaults,
  type ExerciseSetExecution,
  type LogPreset
} from '../../db/exerciseLogging'

// Spelled out so Tailwind emits them; an interpolated `grid-cols-${n}` never reaches its scanner.
const GRID_COLS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'] as const

const applyGrid = (container: HTMLElement, columns: number) => {
  container.classList.add('grid', 'gap-3')
  container.classList.remove(...GRID_COLS)
  container.classList.add(GRID_COLS[Math.min(columns, GRID_COLS.length) - 1])
}

export const renderSetInputs = (container: HTMLElement, preset: LogPreset, values: ExerciseDefaults) => {
  const slots = slotsForPreset(preset)
  const display = toDisplayValues(preset, values)

  container.replaceChildren(
    ...slots.map((spec) => {
      const field = document.createElement('label')
      field.className =
        'flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-jim-neutral-secondary'
      field.append(inputLabel(spec))

      const input = document.createElement('input')
      input.type = 'number'
      input.name = setFieldName(spec.slot)
      input.min = String(spec.min)
      input.step = String(spec.step)
      input.required = spec.required
      input.inputMode = spec.step === 1 ? 'numeric' : 'decimal'
      input.placeholder = '0'
      input.className = 'text-center text-2xl font-bold text-jim-accent'

      const value = display[spec.slot]
      if (value !== undefined) input.value = String(value)

      field.append(input)
      return field
    })
  )

  applyGrid(container, slots.length)
}

export const readSetFromForm = (form: HTMLFormElement, preset: LogPreset): ExerciseSetExecution => {
  const formData = new FormData(form)
  const entered: Record<string, FormDataEntryValue | null> = {}

  for (const { slot } of slotsForPreset(preset)) {
    entered[slot] = formData.get(setFieldName(slot))
  }

  return buildSet(preset, fromDisplayValues(preset, entered))
}

export const configureSetRowGrid = (container: HTMLElement, preset: LogPreset) => {
  container.style.setProperty('--set-field-count', String(slotsForPreset(preset).length))
}

export const renderSetFields = (container: HTMLElement, set: ExerciseSetExecution) => {
  container.replaceChildren(
    ...setFields(set).map(({ slot, label, text, unit }) => {
      const field = document.createElement('div')
      field.className = 'set-field text-jim-neutral-secondary whitespace-nowrap'
      field.append(`${label} `)

      const value = document.createElement('span')
      value.className = `set-${slot} font-bold text-jim-accent`
      value.textContent = text

      field.append(value)
      if (unit) {
        const suffix = document.createElement('span')
        suffix.className = 'text-xs text-jim-neutral-tertiary'
        suffix.textContent = unit === '%' ? unit : ` ${unit}`
        field.append(suffix)
      }
      return field
    })
  )
}
