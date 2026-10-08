import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { pagePathOf, renderPage } from '../partials/plugin'

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

const sourceOf = (file: string) => readFileSync(path.join(root, file), 'utf8')

// The HTML the dev server and the build serve for a page, after the partials plugin filled it in.
const served = (file: string) => renderPage(sourceOf(file), pagePathOf(path.join(root, file)))

describe('page shell', () => {
  it('serves each page at the path its nav link points to', () => {
    expect(Object.keys(PAGES).map((file) => pagePathOf(path.join(root, file)))).toEqual([
      '/',
      '/workouts/',
      '/exercises/',
      '/programs/',
      '/stats/',
      '/settings/',
      '/gymtime/'
    ])
  })

  // The shared head and the bottom nav come from one copy each, so the pages can't drift apart.
  it('fills every page from the shared head and bottom nav', () => {
    for (const file of Object.keys(PAGES)) {
      const source = sourceOf(file)
      expect(source.match(/<!-- partial:head -->/g), file).toHaveLength(1)
      expect(source.match(/<!-- partial:bottom-nav -->/g), file).toHaveLength(1)
      expect(served(file), file).not.toContain('<!-- partial:')
    }
  })

  it('throws on a partial that does not exist', () => {
    expect(() => renderPage('  <!-- partial:nope -->', '/')).toThrow('There is no partials/nope.html')
  })

  // The bottom nav is static HTML, so it is on screen in the first frame and stays still through a view transition.
  it('marks only the page’s own nav link as current', () => {
    for (const [file, current] of Object.entries(PAGES)) {
      const nav = /<nav class="bottom-nav[\s\S]*?<\/nav>/.exec(served(file))?.[0] ?? ''
      const marked = [...nav.matchAll(/href="([^"]+)" aria-current="page"/g)].map(([, href]) => href)
      expect(marked, file).toEqual(current ? [current] : [])
    }
  })

  // Chromium prerenders the other nav pages from these rules. Gymtime stays out of them, since opening it can start
  // a workout.
  it('gives every page speculation rules that prerender only the bottom-nav links', () => {
    for (const file of Object.keys(PAGES)) {
      const json = /<script type="speculationrules">([\s\S]*?)<\/script>/.exec(served(file))?.[1]
      expect(JSON.parse(json ?? 'null'), file).toEqual({
        prerender: [{ where: { selector_matches: '.bottom-nav a:not([aria-current])' }, eagerness: 'immediate' }]
      })
    }
  })

  // The browser paints a page's background before its stylesheet applies, white unless the page says it is dark.
  it('tells the browser every page is dark before its stylesheet loads', () => {
    for (const file of Object.keys(PAGES)) {
      expect(served(file), file).toContain('<meta name="color-scheme" content="dark" />')
    }
  })
})
