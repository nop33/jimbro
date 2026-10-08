import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite-plus'

const root = path.resolve(import.meta.dirname, '..')

// A line holding only `<!-- partial:name -->` becomes partials/name.html, indented like the comment.
const PARTIAL = /^([ \t]*)<!-- partial:([\w-]+) -->$/gm
// A partial's comments explain it to whoever edits it, and would only sit out of place in the page.
const COMMENT_LINES = /^[ \t]*<!--[\s\S]*?-->\n/gm

const readPartial = (name: string) => {
  try {
    return readFileSync(path.join(import.meta.dirname, `${name}.html`), 'utf8')
      .replace(COMMENT_LINES, '')
      .trimEnd()
  } catch {
    throw new Error(`There is no partials/${name}.html`)
  }
}

// The URL a page is served at, such as '/' or '/stats/', from its file under the project root.
export const pagePathOf = (file: string) =>
  `/${path.relative(root, file).split(path.sep).join('/')}`.replace(/index\.html$/, '')

// Fills in a page's partials. The bottom nav marks the link to the page itself as the current one.
export const renderPage = (html: string, pagePath: string) =>
  html.replace(PARTIAL, (_, indent: string, name: string) => {
    let partial = readPartial(name)
    if (name === 'bottom-nav') partial = partial.replace(`href="${pagePath}"`, `$& aria-current="page"`)
    return partial
      .split('\n')
      .map((line) => (line ? indent + line : line))
      .join('\n')
  })

// Runs before Vite reads the page, so the dev server and the build both see plain HTML, and the scripts and
// stylesheet a partial links to are bundled like the page's own.
export const partials = (): Plugin => ({
  name: 'jimbro:partials',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, { filename }) => renderPage(html, pagePathOf(filename))
  },
  configureServer(server) {
    server.watcher.on('change', (file) => {
      if (file.startsWith(import.meta.dirname) && file.endsWith('.html')) server.ws.send({ type: 'full-reload' })
    })
  }
})
