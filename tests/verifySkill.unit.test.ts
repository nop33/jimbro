import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const skill = path.resolve(import.meta.dirname, '..', '.cursor', 'skills', 'verify-jimbro')
const features = path.join(skill, 'features')

// The tour's stops in order, as `control-jimbro tour` numbers their screenshots.
const stops = [
  ...readFileSync(path.join(skill, 'scripts', 'drive.mjs'), 'utf8').matchAll(/^ {2}\['([a-z0-9-]+)', async/gm)
].map(([, slug]) => slug)
const shotOf = (slug: string) => `${String(stops.indexOf(slug) + 1).padStart(2, '0')}-${slug}`

// Every `NN-slug` a feature file names under its tour stops.
const named = readdirSync(features)
  .filter((file) => file.endsWith('.md') && file !== 'README.md')
  .flatMap((file) =>
    [...readFileSync(path.join(features, file), 'utf8').matchAll(/`(\d{2})-([a-z0-9-]+)`/g)].map(
      ([, number, slug]) => ({
        file,
        shot: `${number}-${slug}`,
        slug
      })
    )
  )

describe('verify-jimbro feature map', () => {
  it('reads the tour stops', () => {
    expect(stops.length).toBeGreaterThan(40)
  })

  it('names each stop with the number the tour gives its screenshot', () => {
    const wrong = named.filter(({ slug, shot }) => !stops.includes(slug) || shotOf(slug) !== shot)
    expect(
      wrong.map(({ file, shot, slug }) => `${file}: ${shot}, tour has ${stops.includes(slug) ? shotOf(slug) : 'none'}`)
    ).toEqual([])
  })

  it('names every stop in a feature file', () => {
    const slugs = new Set(named.map(({ slug }) => slug))
    expect(stops.filter((slug) => !slugs.has(slug))).toEqual([])
  })
})
