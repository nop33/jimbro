export const EXERCISE_KINDS = ['lifting', 'rehab', 'cardio'] as const
export type ExerciseKind = (typeof EXERCISE_KINDS)[number]

export const EXERCISE_KIND_LABELS: Record<ExerciseKind, string> = {
  lifting: 'Lifting',
  rehab: 'Rehab',
  cardio: 'Cardio'
}

export const LOG_PRESETS = ['lifting', 'rehabReps', 'rehabHold', 'cardioTreadmill'] as const
export type LogPreset = (typeof LOG_PRESETS)[number]

export const SET_SLOTS = ['reps', 'weight', 'durationSec', 'speed', 'incline'] as const
export type SetSlot = (typeof SET_SLOTS)[number]

export type ExerciseDefaults = Partial<Record<SetSlot, number>>

export interface LiftingSet {
  preset: 'lifting'
  reps: number
  weight: number
}

export interface RehabRepsSet {
  preset: 'rehabReps'
  reps: number
  weight?: number
}

export interface RehabHoldSet {
  preset: 'rehabHold'
  durationSec: number
  weight?: number
}

export interface CardioTreadmillSet {
  preset: 'cardioTreadmill'
  durationSec: number
  speed: number
  incline: number
}

export type ExerciseSetExecution = LiftingSet | RehabRepsSet | RehabHoldSet | CardioTreadmillSet
export type RepsSetExecution = LiftingSet | RehabRepsSet

export interface SetSlotSpec {
  slot: SetSlot
  rowLabel: string
  required: boolean
  min: number
  step: number
  displayScale: number
  hasDefault: boolean
  unit?: string
}

const withUnit = (name: string, unit?: string): string => (unit ? `${name} (${unit})` : name)

export const inputLabel = ({ rowLabel, unit }: SetSlotSpec): string => withUnit(rowLabel, unit)

export const defaultLabel = ({ rowLabel, unit }: SetSlotSpec): string =>
  withUnit(`Default ${rowLabel.toLowerCase()}`, unit)

export interface Prescription {
  preset: LogPreset
  targetSets: number
  defaults: ExerciseDefaults
}

export interface LogPresetSpec {
  preset: LogPreset
  kind: ExerciseKind
  label: string
  slots: ReadonlyArray<SetSlotSpec>
  breakTimer: boolean
  muscleRequired: boolean
  buildSet: (values: ExerciseDefaults) => ExerciseSetExecution
  formatPrescription: (prescription: Prescription) => string
}

const REPS_SLOT: SetSlotSpec = {
  slot: 'reps',
  rowLabel: 'Reps',
  required: true,
  min: 1,
  step: 1,
  displayScale: 1,
  hasDefault: true
}

const WEIGHT_SLOT: SetSlotSpec = {
  slot: 'weight',
  rowLabel: 'Weight',
  required: true,
  min: 0,
  step: 0.01,
  displayScale: 1,
  hasDefault: false,
  unit: 'kg'
}

const OPTIONAL_WEIGHT_SLOT: SetSlotSpec = { ...WEIGHT_SLOT, required: false }

const HOLD_SLOT: SetSlotSpec = {
  slot: 'durationSec',
  rowLabel: 'Hold',
  required: true,
  min: 1,
  step: 1,
  displayScale: 1,
  hasDefault: true,
  unit: 'sec'
}

const TREADMILL_TIME_SLOT: SetSlotSpec = {
  slot: 'durationSec',
  rowLabel: 'Time',
  required: true,
  min: 0.5,
  step: 0.5,
  displayScale: 60,
  hasDefault: false,
  unit: 'min'
}

const SPEED_SLOT: SetSlotSpec = {
  slot: 'speed',
  rowLabel: 'Speed',
  required: true,
  min: 0,
  step: 0.1,
  displayScale: 1,
  hasDefault: false,
  unit: 'km/h'
}

const INCLINE_SLOT: SetSlotSpec = {
  slot: 'incline',
  rowLabel: 'Incline',
  required: true,
  min: 0,
  step: 0.5,
  displayScale: 1,
  hasDefault: false,
  unit: '%'
}

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)))

const setsPhrase = (targetSets: number): string => `${targetSets} ${targetSets === 1 ? 'set' : 'sets'}`

const repsPrescription = ({ targetSets, defaults }: Prescription): string =>
  `${setsPhrase(targetSets)} × ${formatNumber(defaults.reps ?? 0)} reps`

export const LOG_PRESET_SPECS: Record<LogPreset, LogPresetSpec> = {
  lifting: {
    preset: 'lifting',
    kind: 'lifting',
    label: 'Lifting',
    slots: [REPS_SLOT, WEIGHT_SLOT],
    breakTimer: true,
    muscleRequired: true,
    buildSet: (values) => ({ preset: 'lifting', reps: values.reps ?? 0, weight: values.weight ?? 0 }),
    formatPrescription: repsPrescription
  },
  rehabReps: {
    preset: 'rehabReps',
    kind: 'rehab',
    label: 'Reps',
    slots: [REPS_SLOT, OPTIONAL_WEIGHT_SLOT],
    breakTimer: false,
    muscleRequired: true,
    buildSet: (values) => ({ preset: 'rehabReps', reps: values.reps ?? 0, weight: values.weight }),
    formatPrescription: repsPrescription
  },
  rehabHold: {
    preset: 'rehabHold',
    kind: 'rehab',
    label: 'Hold',
    slots: [HOLD_SLOT, OPTIONAL_WEIGHT_SLOT],
    breakTimer: false,
    muscleRequired: true,
    buildSet: (values) => ({ preset: 'rehabHold', durationSec: values.durationSec ?? 0, weight: values.weight }),
    formatPrescription: ({ targetSets, defaults }) =>
      `${setsPhrase(targetSets)} × ${formatNumber(defaults.durationSec ?? 0)}s hold`
  },
  cardioTreadmill: {
    preset: 'cardioTreadmill',
    kind: 'cardio',
    label: 'Treadmill',
    slots: [TREADMILL_TIME_SLOT, SPEED_SLOT, INCLINE_SLOT],
    breakTimer: true,
    muscleRequired: false,
    buildSet: (values) => ({
      preset: 'cardioTreadmill',
      durationSec: values.durationSec ?? 0,
      speed: values.speed ?? 0,
      incline: values.incline ?? 0
    }),
    formatPrescription: ({ targetSets }) => setsPhrase(targetSets)
  }
}

export const presetsForKind = (kind: ExerciseKind): ReadonlyArray<LogPreset> =>
  LOG_PRESETS.filter((preset) => LOG_PRESET_SPECS[preset].kind === kind)

export const defaultPresetForKind = (kind: ExerciseKind): LogPreset => presetsForKind(kind)[0]

export const slotsForPreset = (preset: LogPreset): ReadonlyArray<SetSlotSpec> => LOG_PRESET_SPECS[preset].slots

export const defaultSlotsForPreset = (preset: LogPreset): ReadonlyArray<SetSlotSpec> =>
  LOG_PRESET_SPECS[preset].slots.filter((spec) => spec.hasDefault)

export const hasSlot = (preset: LogPreset, slot: SetSlot): boolean =>
  LOG_PRESET_SPECS[preset].slots.some((spec) => spec.slot === slot)

export const breakTimerEnabled = (preset: LogPreset): boolean => LOG_PRESET_SPECS[preset].breakTimer

export const historyChartEnabled = (kind: ExerciseKind): boolean => kind !== 'cardio'

export const muscleRequired = (preset: LogPreset): boolean => LOG_PRESET_SPECS[preset].muscleRequired

export const kindOfPreset = (preset: LogPreset): ExerciseKind => LOG_PRESET_SPECS[preset].kind

export const setFieldName = (slot: SetSlot): string => `set-${slot}`

export const defaultFieldName = (slot: SetSlot): string => `default-${slot}`

export const formatPrescription = (prescription: Prescription): string =>
  LOG_PRESET_SPECS[prescription.preset].formatPrescription(prescription)

export const parseExerciseKind = (value: unknown): ExerciseKind | undefined =>
  EXERCISE_KINDS.find((kind) => kind === value)

export const parseLogPreset = (value: unknown): LogPreset | undefined => LOG_PRESETS.find((preset) => preset === value)

export const isRepsSet = (set: ExerciseSetExecution): set is RepsSetExecution =>
  set.preset === 'lifting' || set.preset === 'rehabReps'

const unhandledPreset = (set: never): never => {
  throw new Error(`Unhandled log preset: ${JSON.stringify(set)}`)
}

export const setValues = (set: ExerciseSetExecution): ExerciseDefaults => {
  switch (set.preset) {
    case 'lifting':
      return { reps: set.reps, weight: set.weight }
    case 'rehabReps':
      return { reps: set.reps, weight: set.weight }
    case 'rehabHold':
      return { durationSec: set.durationSec, weight: set.weight }
    case 'cardioTreadmill':
      return { durationSec: set.durationSec, speed: set.speed, incline: set.incline }
    default:
      return unhandledPreset(set)
  }
}

const toFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export const buildSet = (preset: LogPreset, values: ExerciseDefaults): ExerciseSetExecution =>
  LOG_PRESET_SPECS[preset].buildSet(values)

export const emptySet = (preset: LogPreset): ExerciseSetExecution => buildSet(preset, {})

/** Reads the slots of `preset` out of an untrusted record already expressed in stored units. */
export const coerceDefaults = (preset: LogPreset, raw: unknown): ExerciseDefaults => {
  const source = isRecord(raw) ? raw : {}
  const values: ExerciseDefaults = {}

  for (const { slot } of slotsForPreset(preset)) {
    const value = toFiniteNumber(source[slot])
    if (value !== undefined) values[slot] = value
  }

  return values
}

export const parseSet = (raw: unknown, fallbackPreset: LogPreset): ExerciseSetExecution => {
  const source = isRecord(raw) ? raw : {}
  const preset = parseLogPreset(source.preset) ?? fallbackPreset
  return buildSet(preset, coerceDefaults(preset, source))
}

export const toDisplayValues = (preset: LogPreset, values: ExerciseDefaults): ExerciseDefaults => {
  const display: ExerciseDefaults = {}

  for (const { slot, displayScale } of slotsForPreset(preset)) {
    const value = values[slot]
    if (value !== undefined) display[slot] = value / displayScale
  }

  return display
}

export const fromDisplayValues = (preset: LogPreset, raw: unknown): ExerciseDefaults => {
  const source = isRecord(raw) ? raw : {}
  const values: ExerciseDefaults = {}

  for (const { slot, displayScale } of slotsForPreset(preset)) {
    const value = toFiniteNumber(source[slot])
    if (value !== undefined) values[slot] = value * displayScale
  }

  return values
}

export interface SetField {
  slot: SetSlot
  label: string
  text: string
  unit?: string
}

export const setFields = (set: ExerciseSetExecution): Array<SetField> => {
  const slots = slotsForPreset(set.preset)
  const display = toDisplayValues(set.preset, setValues(set))
  const isPlaceholder = slots.every(({ slot }) => !display[slot])

  return slots.map(({ slot, rowLabel, unit }) => ({
    slot,
    label: rowLabel,
    text: isPlaceholder ? '-' : formatNumber(display[slot] ?? 0),
    ...(isPlaceholder || !unit ? {} : { unit })
  }))
}
