import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { pagePathOf, renderPage } from '../partials/plugin'

const root = path.resolve(import.meta.dirname, '..')

// Each page and the nav link it marks as current. Stats, a program's page, settings, its own pages and gymtime are reached from other pages, and an
// assistant sends the browser to connect, so they mark none.
const PAGES: Record<string, string | null> = {
  'index.html': '/',
  'workouts/index.html': '/workouts/',
  'exercises/index.html': '/exercises/',
  'programs/index.html': '/programs/',
  'programs/program/index.html': null,
  'stats/index.html': null,
  'settings/index.html': null,
  'settings/backup/index.html': null,
  'settings/assistants/index.html': null,
  'settings/data/index.html': null,
  'gymtime/index.html': null,
  'connect/index.html': null
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
      '/programs/program/',
      '/stats/',
      '/settings/',
      '/settings/backup/',
      '/settings/assistants/',
      '/settings/data/',
      '/gymtime/',
      '/connect/'
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

  // A page in the bottom nav is reached from there, so only the pages outside it have a back button.
  it('gives a back button to the pages outside the bottom nav only', () => {
    for (const [file, current] of Object.entries(PAGES)) {
      expect(sourceOf(file).includes('<!-- partial:back-button -->'), file).toBe(!current)
    }
  })

  // Each page loads its own module in the head, the router mounts it and shows the next pages in place, and keeps the
  // break timer on screen across them. A page's body holds no script, since the router swaps bodies.
  it('gives every page the router, its own module in the head and the break timer', () => {
    for (const [file, current] of Object.entries(PAGES)) {
      const source = sourceOf(file)
      const head = /<head>([\s\S]*?)<\/head>/.exec(source)?.[1] ?? ''
      const body = /<body[\s\S]*?<\/body>/.exec(source)?.[0] ?? ''
      const route = (current ?? `/${path.dirname(file)}/`).replace(/^\/$/, '/home/')
      expect(served(file), file).toContain('<script type="module" src="/src/router.ts"></script>')
      expect(head, file).toContain(`<script type="module" src="/src/pages${route}index.ts"></script>`)
      expect(source, file).toContain('<!-- partial:break-timer -->')
      expect(body.match(/<script/g) ?? [], file).toEqual([])
    }
  })

  // The browser paints a page's background before its stylesheet applies, white unless the page says it is dark.
  it('tells the browser every page is dark before its stylesheet loads', () => {
    for (const file of Object.keys(PAGES)) {
      expect(served(file), file).toContain('<meta name="color-scheme" content="dark" />')
    }
  })

  // Every dialog is a bottom sheet that pulls down to close, but the break timer, which pulls down into its bar, and
  // the history chart, which turns sideways to fill the screen.
  it('makes every dialog a bottom sheet that pulls down to close', () => {
    const notSheets = ['break-countdown-dialog', 'exercise-history-dialog']
    const dialogs = Object.keys(PAGES).flatMap((file) =>
      [...served(file).matchAll(/<dialog\b[^>]*>/g)].map(([tag]) => ({
        file,
        tag,
        id: /\bid="([^"]+)"/.exec(tag)?.[1]
      }))
    )
    const sheetIds = new Set<string>()
    for (const { file, tag, id } of dialogs) {
      if (id && notSheets.includes(id)) continue
      expect(tag, file).toMatch(/\bclass="[^"]*\bdialog-sheet\b/)
      if (id) sheetIds.add(id)
    }
    expect(sheetIds.size).toBeGreaterThan(0)
    // The module that owns each sheet's dialog wires the pull, so each sheet's id sits in a file that calls it.
    const wiring = readdirSync(path.join(root, 'src'), { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .map((file) => sourceOf(path.join('src', file)))
      .filter((source) => source.includes('pullDownToClose(this.'))
    for (const id of sheetIds) {
      expect(
        wiring.some((source) => source.includes(`#${id}'`) || source.includes(`'${id}'`)),
        id
      ).toBe(true)
    }
  })
})
