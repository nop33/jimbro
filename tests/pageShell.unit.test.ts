import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

const root = path.resolve(import.meta.dirname, '..')

// Each page and the nav link it marks as current. Settings and gymtime are reached from other pages and mark none.
const PAGES: Record<string, string | null> = {
  'index.html': '/',
  'workouts/index.html': '/workouts/',
  'exercises/index.html': '/exercises/',
  'programs/index.html': '/programs/',
  'stats/index.html': '/stats/',
  'settings/index.html': null,
  'gymtime/index.html': null
}

const navOf = (file: string) => {
  const html = readFileSync(path.join(root, file), 'utf8')
  const nav = /<nav class="bottom-nav[\s\S]*?<\/nav>/.exec(html)?.[0]
  if (!nav) throw new Error(`${file} has no bottom nav`)
  // The formatter wraps an attribute onto its own line when the link has more of them.
  return nav.replaceAll(/\s+/g, ' ')
}

describe('page shell', () => {
  // The bottom nav is static HTML, so it is on screen in the first frame and stays still through a view transition.
  // Each page carries its own copy, and this keeps the copies the same.
  it('gives every page the same bottom nav, marking only its own link as current', () => {
    const withoutCurrent = (nav: string) =>
      nav.replaceAll(' aria-current="page"', '').replaceAll(/h-full( text-neutral-400)? hover/g, 'h-full hover')
    const navs = Object.keys(PAGES).map(navOf)
    for (const nav of navs) expect(withoutCurrent(nav)).toBe(withoutCurrent(navs[0]))

    for (const [file, current] of Object.entries(PAGES)) {
      const marked = [...navOf(file).matchAll(/href="([^"]+)" aria-current="page"/g)].map(([, href]) => href)
      expect(marked, file).toEqual(current ? [current] : [])
    }
  })
})
