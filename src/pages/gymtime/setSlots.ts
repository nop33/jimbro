import {
  buildSet,
  fromDisplayValues,
  inputLabel,
  setFieldName,
  setFields,
  setValues,
  slotsForPreset,
  toDisplayValues,
  type ExerciseDefaults,
  type ExerciseSetExecution,
  type LogPreset,
  type SetSlot
} from '../../db/exerciseLogging'
import { tapToDismiss } from './tapToDismiss'

// Spelled out so Tailwind emits them; an interpolated `grid-cols-${n}` never reaches its scanner.
const GRID_COLS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3'] as const

const applyGrid = (container: HTMLElement, columns: number) => {
  container.classList.add('grid', 'gap-3')
  container.classList.remove(...GRID_COLS)
  container.classList.add(GRID_COLS[Math.min(columns, GRID_COLS.length) - 1])
}

// A badge on a slot's input: a short label, and the details its popover shows on tap.
export interface SetSlotBadge {
  label: string
  details: string
}

// A badge sits on its slot's input until the value is edited, as with "Max" on a prefilled weight. It is a button
// that opens a popover, which gives light dismiss and aria-expanded, and CSS anchor positioning puts it by the badge.
// A tap outside the popover only closes it.
// The input sits in a div with its own label, since a label may hold no button besides its control.
export const renderSetInputs = (
  container: HTMLElement,
  preset: LogPreset,
  values: ExerciseDefaults,
  badges: Partial<Record<SetSlot, SetSlotBadge>> = {}
) => {
  const slots = slotsForPreset(preset)
  const display = toDisplayValues(preset, values)

  container.replaceChildren(
    ...slots.map((spec) => {
      const id = `set-field-${crypto.randomUUID()}`
      const field = document.createElement('div')
      field.className = 'flex flex-col gap-1.5'

      const label = document.createElement('label')
      label.htmlFor = id
      label.className = 'text-xs font-semibold uppercase tracking-wider text-jim-neutral-secondary'
      label.textContent = inputLabel(spec)

      const input = document.createElement('input')
      input.id = id
      input.type = 'number'
      input.name = setFieldName(spec.slot)
      input.min = String(spec.min)
      input.step = String(spec.step)
      input.required = spec.required
      input.inputMode = spec.step === 1 ? 'numeric' : 'decimal'
      input.placeholder = '0'
      input.className = 'w-full text-center text-2xl font-bold text-jim-accent'

      const value = display[spec.slot]
      if (value !== undefined) input.value = String(value)

      const box = document.createElement('div')
      box.className = 'relative'
      box.append(input)
      field.append(label, box)

      const badge = badges[spec.slot]
      if (badge) {
        const details = document.createElement('div')
        details.id = `${id}-badge`
        details.popover = 'auto'
        details.className = 'set-badge-details'
        details.textContent = badge.details
        tapToDismiss(details)

        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'set-badge'
        button.style.setProperty('anchor-name', `--${id}-badge`)
        details.style.setProperty('position-anchor', `--${id}-badge`)
        button.popoverTargetElement = details
        const pill = document.createElement('span')
        pill.textContent = badge.label
        button.append(pill)

        input.setAttribute('aria-describedby', details.id)
        input.addEventListener('input', () => clearSetBadges(field), { once: true })
        box.append(button, details)
      }

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

// A set of 0 reps, or a lifting set of 0 kg, is most likely a slip, so it asks first. Resolves to whether to log it.
export const confirmZeroSet = (set: ExerciseSetExecution): boolean => {
  const { reps } = setValues(set)
  if (reps !== 0 && !(set.preset === 'lifting' && set.weight === 0)) return true
  return confirm(`Are you sure you want to submit a set with 0 ${reps === 0 ? 'reps' : 'weight'}?`)
}

export const configureSetRowGrid = (container: HTMLElement, preset: LogPreset) => {
  container.style.setProperty('--set-field-count', String(slotsForPreset(preset).length))
}

export const renderSetFields = (container: HTMLElement, set: ExerciseSetExecution) => {
  container.replaceChildren(
    ...setFields(set).map(({ slot, label, text, unit }) => {
      // When a row runs out of room, the value wraps under its label instead of running into the next field.
      const field = document.createElement('div')
      field.className = 'set-field text-jim-neutral-secondary flex flex-wrap items-baseline gap-x-1'
      field.append(`${label} `)

      const reading = document.createElement('span')
      reading.className = 'whitespace-nowrap'

      const value = document.createElement('span')
      value.className = `set-${slot} font-bold text-jim-accent`
      value.textContent = text

      reading.append(value)
      if (unit) {
        const suffix = document.createElement('span')
        suffix.className = 'text-xs text-jim-neutral-tertiary'
        suffix.textContent = unit === '%' ? unit : ` ${unit}`
        reading.append(suffix)
      }
      field.append(reading)
      return field
    })
  )
}

export const clearSetBadges = (container: HTMLElement) => {
  for (const badge of container.querySelectorAll('.set-badge, .set-badge-details')) badge.remove()
  for (const input of container.querySelectorAll('input[aria-describedby$="-badge"]')) {
    input.removeAttribute('aria-describedby')
  }
}
