import { describe, expect, it } from 'vite-plus/test'
import { exerciseSection, exerciseSections } from '../src/pages/exerciseSections'

describe('exercise sections', () => {
  it('puts a lift under its muscle, and rehab and cardio under their kind', () => {
    expect(exerciseSection({ kind: 'lifting', muscle: 'chest' })).toBe('Chest')
    expect(exerciseSection({ kind: 'rehab', muscle: 'shoulders' })).toBe('Rehab')
    expect(exerciseSection({ kind: 'cardio' })).toBe('Cardio')
  })

  it('orders the muscles alphabetically, then Rehab, then Cardio, each by name', () => {
    const sections = exerciseSections([
      { name: 'Treadmill', kind: 'cardio' },
      { name: 'Wall sit', kind: 'rehab', muscle: 'quads' },
      { name: 'Squat', kind: 'lifting', muscle: 'quads' },
      { name: 'Band rotation', kind: 'rehab', muscle: 'shoulders' },
      { name: 'Bench', kind: 'lifting', muscle: 'chest' },
      { name: 'Lunge', kind: 'lifting', muscle: 'quads' }
    ])
    expect(sections.map(([section, exercises]) => [section, exercises.map(({ name }) => name)])).toEqual([
      ['Chest', ['Bench']],
      ['Quads', ['Lunge', 'Squat']],
      ['Rehab', ['Band rotation', 'Wall sit']],
      ['Cardio', ['Treadmill']]
    ])
  })
})
