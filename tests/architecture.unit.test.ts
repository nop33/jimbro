import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vite-plus/test'

const root = path.resolve(import.meta.dirname, '..')

const sourceFiles = (dir: string): Array<string> =>
  readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map((file) => path.join(dir, file))

const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

// Each rule is a detector from a file's path and source to its mistakes, so the tests can show it catching a known
// mistake before trusting its silence on the repo.
type Detector = (file: string, source: string) => Array<string>

const scan = (files: Array<string>, detector: Detector) => files.flatMap((file) => detector(file, read(file)))

const lineOf = (source: string, index: number) => source.slice(0, index).split('\n').length

const reExports: Detector = (file, source) => {
  const reExport = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g
  return [...source.matchAll(reExport)].map(
    ([, from]) => `${file} re-exports from '${from}'. Import from '${from}' where it is used and delete the re-export.`
  )
}

// innerHTML parses what it gets, so an exercise name typed, imported or synced in runs as markup. df6d559 fixed
// that in the toast and the gymtime error page, and missed the program exercise picker.
const markupFromValues: Detector = (file, text) => {
  const unwrap = (node: ts.Expression): ts.Expression =>
    ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node
  const isFixed = (node: ts.Expression | undefined): boolean => {
    const inner = node && unwrap(node)
    return (
      inner !== undefined &&
      (ts.isStringLiteralLike(inner) ||
        (ts.isConditionalExpression(inner) && isFixed(inner.whenTrue) && isFixed(inner.whenFalse)))
    )
  }
  const isMarkupProperty = (node: ts.Expression) => {
    const target = unwrap(node)
    const name = ts.isPropertyAccessExpression(target)
      ? target.name.text
      : ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression)
        ? target.argumentExpression.text
        : undefined
    return name === 'innerHTML' || name === 'outerHTML'
  }
  // = and the logical assignments store their right side as it is. += and the rest add to the markup already there.
  const storesRightSide = [
    ts.SyntaxKind.EqualsToken,
    ts.SyntaxKind.BarBarEqualsToken,
    ts.SyntaxKind.AmpersandAmpersandEqualsToken,
    ts.SyntaxKind.QuestionQuestionEqualsToken
  ]
  // The argument that each of these methods parses as markup.
  const markupArgument = new Map([
    ['insertAdjacentHTML', 1],
    ['setHTMLUnsafe', 0],
    ['createContextualFragment', 0],
    ['parseFromString', 0]
  ])
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest)
  const sinks: Array<string> = []
  const visit = (node: ts.Node) => {
    const assignsMarkup =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      isMarkupProperty(node.left) &&
      !(storesRightSide.includes(node.operatorToken.kind) && isFixed(node.right))
    const markupIndex =
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        ? markupArgument.get(node.expression.name.text)
        : undefined
    const parsesMarkup = ts.isCallExpression(node) && markupIndex !== undefined && !isFixed(node.arguments[markupIndex])
    if (assignsMarkup || parsesMarkup)
      sinks.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sinks.map(
    (sink) =>
      `${sink} builds HTML from a value. Create the elements and set their textContent, or use new Option() for a select.`
  )
}

// The schema creates the outbox and meta stores. Everything else reaches them through src/sync, so the rules for an
// entry's seq and inflight stamp live next to the push and pull that depend on them.
const syncStoresOutsideSync: Detector = (file, source) => {
  const schema = ['src/db/constants.ts', 'src/db/migrations.ts'].map((one) => path.normalize(one))
  const syncStore = /OBJECT_STORES\.(?:OUTBOX|META)\b|['"](?:outbox|meta)['"]/
  return !file.startsWith(path.join('src', 'sync')) && !schema.includes(file) && syncStore.test(source)
    ? [
        `${file} reads or writes the outbox or meta store. Use storage.writeRows to queue a row, and the src/sync modules for the rest.`
      ]
    : []
}

// A notice sent or heard as a bare jimbro: window event skips announce and onPageNotice, and its listener gets no
// typed notice. A custom event between modules, like the exercise-clicked event that ExerciseList's callback
// replaced, reaches its listeners untyped. A BroadcastChannel carried notices to other tabs until each user ran the
// app in one tab on one device. An open channel also cost every Back a full reload, because the back/forward cache
// evicts a page whose channel gets a message.
const untypedEvents: Detector = (file, source) => {
  const channelFile = path.normalize('src/sync/pageChannel.ts')
  const emitterFile = path.normalize('src/eventEmitter.ts')
  const pageNotice = /(?:EventListener|Event)\s*(?:<.*?>)?\(\s*['"`]jimbro:/
  const customEvent = /new\s+(?:window\.)?CustomEvent\s*(?:<.*?>)?\((?!\s*['"`]jimbro:)/
  const broadcastChannel = /\bBroadcastChannel\b/
  return [
    ...(file !== channelFile && pageNotice.test(source)
      ? [
          `${file} sends or hears a notice outside pageChannel. Use announce and onPageNotice from src/sync/pageChannel.ts, which keep the notices typed in one place.`
        ]
      : []),
    ...(file !== emitterFile && customEvent.test(source)
      ? [
          `${file} creates a CustomEvent, which its listeners must cast to read. Give the other module a typed callback, or use EventEmitter from src/eventEmitter.ts.`
        ]
      : []),
    ...(broadcastChannel.test(source)
      ? [
          `${file} uses a BroadcastChannel. The app runs in one tab, so notices stay in the page: use announce and onPageNotice from src/sync/pageChannel.ts.`
        ]
      : [])
  ]
}

// A row put in any other transaction never reaches the outbox, so it never syncs. The Storage writers that 51fa002
// deleted did that.
const readwriteOutsideWriteRows: Detector = (file, source) => {
  if (file.startsWith(path.join('src', 'sync'))) return []
  const opened = source.match(/['"]readwrite['"]/g)?.length ?? 0
  const allowed = file === path.normalize('src/db/storage.ts') ? 1 : 0
  return opened > allowed
    ? [
        `${file} opens ${opened} readwrite transactions where ${allowed} is allowed. Write rows with storage.writeRows, and keep the sync's own transactions in src/sync.`
      ]
    : []
}

// A sleep long enough on one machine is too short on a slower one, and a forced click skips the checks that wait
// until the element can take it. f814248 added a sleep and 7b4170e a forced click to quiet flaky gymtime tests, and
// 0b3f181 and bc7c33a took such sleeps and clicks out again.
const fixedWaits: Detector = (file, source) => {
  const waitInstead = 'Wait for what the app shows or stores instead, with expect, expect.poll or page.waitForFunction.'
  const mistakes = [
    { pattern: /\.waitForTimeout\(/g, message: `waits a fixed time. ${waitInstead}` },
    // setTimeout(resolve, 0) only yields to the event loop, so it is no fixed wait.
    { pattern: /\bsetTimeout\(\s*(?:\w+|\(\)\s*=>\s*\w+\(\))\s*,(?!\s*0\s*\))/g, message: `sleeps. ${waitInstead}` },
    {
      pattern:
        /\.(?:check|clear|click|dblclick|dragTo|fill|hover|selectOption|selectText|setChecked|tap|uncheck)\([^)]*\bforce:\s*true/g,
      message: `forces an action past Playwright's checks. Wait for what the app shows, such as expect(button).toBeEnabled(), and act without force.`
    }
  ]
  return mistakes.flatMap(({ pattern, message }) =>
    [...source.matchAll(pattern)].map(({ index }) => `${file}:${lineOf(source, index)} ${message}`)
  )
}

// The WebKit projects take the Navigation API away through the test in tests/fixtures.ts, since Playwright's WebKit
// can't follow the router. A spec on Playwright's own test would keep it, and its taps would hang in WebKit.
const specsWithoutFixtures: Detector = (file, source) =>
  [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@playwright\/test['"]/g)]
    .filter(([, names]) => names.split(',').some((name) => name.trim() === 'test'))
    .map(
      ({ index }) =>
        `${file}:${lineOf(source, index)} imports test from @playwright/test. Import it from ./fixtures, which sets up the page for each project.`
    )

// toISOString() is UTC, so away from UTC its date is a day off for part of every day. f9d3364 fixed the workout
// form's default date for that.
const utcCalendarDates: Detector = (file, source) => {
  const utcDay =
    /toISOString\(\)\s*\.\s*(?:split\(\s*['"]T['"]|slice\(\s*0\s*,\s*10\s*\)|substr(?:ing)?\(\s*0\s*,\s*10\s*\))/
  return utcDay.test(source)
    ? [
        `${file} takes a date from toISOString(), which is UTC. Use getSimpleDate from src/dateUtils.ts for today, and parseSimpleDate to read a stored date.`
      ]
    : []
}

// The router shows each page in the same document, so a page draws itself only when the router mounts it, and stops
// what it wired when the next page replaces it. A page module that ran at load drew once and never again, and a
// listener on the document kept running on every page after it.
const pagesDir = path.join('src', 'pages')
const isPageEntry = (file: string) =>
  path.dirname(path.dirname(file)) === pagesDir && path.basename(file) === 'index.ts'
const parse = (file: string, text: string) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
const at = (file: string, source: ts.SourceFile, node: ts.Node) =>
  `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`

const pageEntries: Detector = (file, text) => {
  if (!isPageEntry(file)) return []
  const source = parse(file, text)
  const exportsMount = source.statements.some(
    (statement) =>
      ((ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'mount'
        )) ||
        (ts.isFunctionDeclaration(statement) && statement.name?.text === 'mount')) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  )
  const runsAtLoad = source.statements.filter((statement) => ts.isExpressionStatement(statement))
  return [
    ...(exportsMount
      ? []
      : [`${file} exports no mount. Export mount(signal), which the router calls to show the page.`]),
    ...runsAtLoad.map(
      (statement) =>
        `${at(file, source, statement)} runs when the module loads. Move it into mount, which runs each time the page shows.`
    )
  ]
}

// Each visit brings new elements, so an element looked up when the module loaded is the first visit's. And a page's
// state belongs to one visit: state at module level, or in a static field, outlives it.
const pageStateAtLoad: Detector = (file, text) => {
  if (!file.startsWith(pagesDir + path.sep)) return []
  const source = parse(file, text)
  const mistakes: Array<string> = []
  const touchesDom = (node: ts.Node): boolean =>
    (ts.isIdentifier(node) && (node.text === 'document' || node.text === 'window')) ||
    (!ts.isFunctionLike(node) && !ts.isClassLike(node) && ts.forEachChild(node, touchesDom) === true)
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement) && !(statement.declarationList.flags & ts.NodeFlags.Const))
      mistakes.push(
        `${at(file, source, statement)} keeps state at module level, which outlives the page. Keep it in an instance that mount creates.`
      )
    if (
      !ts.isFunctionLike(statement) &&
      !ts.isClassLike(statement) &&
      !ts.isImportDeclaration(statement) &&
      touchesDom(statement)
    )
      mistakes.push(
        `${at(file, source, statement)} reads the document when the module loads. Read it in mount, or in a constructor that mount calls.`
      )
    if (ts.isClassDeclaration(statement))
      for (const member of statement.members)
        if (
          ts.isPropertyDeclaration(member) &&
          ts.getModifiers(member)?.some(({ kind }) => kind === ts.SyntaxKind.StaticKeyword)
        )
          mistakes.push(
            `${at(file, source, member)} is a static field, which outlives the page. Make it an instance field of a component mount creates.`
          )
  }
  return mistakes
}

// A listener on the document or the window outlives the elements of the page that added it.
const pageListenersWithoutSignal: Detector = (file, text) => {
  if (!file.startsWith(pagesDir + path.sep)) return []
  const source = parse(file, text)
  const mistakes: Array<string> = []
  const passesSignal = (options: ts.Expression | undefined) =>
    options !== undefined &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some(
      (property) => property.name && ts.isIdentifier(property.name) && property.name.text === 'signal'
    )
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'addEventListener' &&
      ts.isIdentifier(node.expression.expression) &&
      ['document', 'window'].includes(node.expression.expression.text) &&
      !passesSignal(node.arguments[2])
    )
      mistakes.push(
        `${at(file, source, node)} listens on the ${node.expression.expression.text} without a signal. Pass { signal } from mount, so the listener stops when the page goes.`
      )
    ts.forEachChild(node, visit)
  }
  visit(source)
  return mistakes
}

// The specs and the helpers they import, which the fixed-wait rule covers.
const specsAndHelpers = () => {
  const testFiles = sourceFiles('tests')
  const specs = testFiles.filter((file) => file.endsWith('.spec.ts'))
  const helpers = specs.flatMap((spec) =>
    [...read(spec).matchAll(/from\s+['"](\.{1,2}\/[^'"]+?)(?:\.ts)?['"]/g)].map(([, from]) =>
      path.join(path.dirname(spec), `${from}.ts`)
    )
  )
  return testFiles.filter((file) => specs.includes(file) || helpers.includes(file))
}

const page = path.join('src', 'pages', 'example.ts')

const rules: Array<{
  rule: string
  detector: Detector
  files: () => Array<string>
  file: string
  bad: string
  flags: number
  flagged: RegExp
  good: string
}> = [
  {
    rule: 'imports every symbol from the module that declares it',
    detector: reExports,
    files: () => [...sourceFiles('src'), ...sourceFiles('worker/src')],
    file: page,
    bad: "export { weekOf } from './weeks'\nexport type { Row } from './types'",
    flags: 2,
    flagged: /re-exports from '\.\/weeks'[\s\S]*re-exports from '\.\/types'/,
    good: "import { weekOf } from './weeks'\nexport { weekOf }"
  },
  {
    rule: 'builds HTML only from fixed markup',
    detector: markupFromValues,
    files: () => sourceFiles('src'),
    file: page,
    bad: "el.innerHTML = 'x'\nel.innerHTML = name\nel.insertAdjacentHTML('beforeend', `<b>${name}</b>`)",
    flags: 2,
    flagged: new RegExp(`^${page}:2 builds HTML[\\s\\S]*${page}:3 builds HTML`),
    good: "el.innerHTML = ''\nel.outerHTML = open ? '<b></b>' : '<i></i>'\nel.textContent = name"
  },
  {
    rule: 'leaves the outbox and meta stores to src/sync',
    detector: syncStoresOutsideSync,
    files: () => sourceFiles('src'),
    file: page,
    bad: "db.transaction('outbox')",
    flags: 1,
    flagged: /reads or writes the outbox or meta store/,
    good: "db.transaction('workoutSessions')"
  },
  {
    rule: 'leaves page notices to pageChannel, custom events to EventEmitter, and opens no BroadcastChannel',
    detector: untypedEvents,
    files: () => sourceFiles('src'),
    file: page,
    bad: "addEventListener('jimbro:rows-written', f)\nnew CustomEvent('picked')\nnew BroadcastChannel('x')",
    flags: 3,
    flagged: /outside pageChannel[\s\S]*creates a CustomEvent[\s\S]*uses a BroadcastChannel/,
    good: "onPageNotice(f)\naddEventListener('click', f)"
  },
  {
    rule: 'opens a readwrite transaction only in writeRows and src/sync',
    detector: readwriteOutsideWriteRows,
    files: () => sourceFiles('src'),
    file: path.normalize('src/db/storage.ts'),
    bad: 'db.transaction(stores, \'readwrite\')\ndb.transaction(stores, "readwrite")',
    flags: 1,
    flagged: /opens 2 readwrite transactions where 1 is allowed/,
    good: "db.transaction(stores, 'readwrite')\ndb.transaction(stores, 'readonly')"
  },
  {
    rule: 'waits in specs for what the app shows or stores, never for a fixed time',
    detector: fixedWaits,
    files: specsAndHelpers,
    file: 'tests/example.spec.ts',
    bad: 'await page.waitForTimeout(500)\nawait new Promise((r) => setTimeout(r, 200))\nawait button.click({ force: true })',
    flags: 3,
    flagged:
      /^tests\/example\.spec\.ts:1 waits a fixed time[\s\S]*tests\/example\.spec\.ts:2 sleeps[\s\S]*tests\/example\.spec\.ts:3 forces an action/,
    good: 'await new Promise((r) => setTimeout(r, 0))\nawait expect(button).toBeEnabled()\nawait button.click()'
  },
  {
    rule: 'takes test in specs from tests/fixtures.ts',
    detector: specsWithoutFixtures,
    files: () => sourceFiles('tests').filter((file) => file.endsWith('.spec.ts')),
    file: 'tests/example.spec.ts',
    bad: "import { test, expect } from '@playwright/test'",
    flags: 1,
    flagged: /^tests\/example\.spec\.ts:1 imports test from @playwright\/test/,
    good: "import { expect, type Page } from '@playwright/test'\nimport { test } from './fixtures'"
  },
  {
    rule: 'gives every page an entry that exports mount and runs nothing when it loads',
    detector: pageEntries,
    files: () => sourceFiles('src/pages'),
    file: path.join('src', 'pages', 'example', 'index.ts'),
    bad: "import { store } from '../../db/store'\nawait store.load()\nrender()",
    flags: 3,
    flagged: /exports no mount[\s\S]*:2 runs when the module loads[\s\S]*:3 runs when the module loads/,
    good: "import { store } from '../../db/store'\nexport const mount = async (signal: AbortSignal) => {\n  await store.load()\n}"
  },
  {
    rule: 'keeps no page state or element lookups at module level',
    detector: pageStateAtLoad,
    files: () => sourceFiles('src/pages'),
    file: page,
    bad: "let open = 0\nconst grid = document.querySelector('#grid')\nclass List {\n  private static items = []\n}",
    flags: 3,
    flagged: /:1 keeps state at module level[\s\S]*:2 reads the document[\s\S]*:4 is a static field/,
    good: "const LABELS = ['a']\nconst find = () => document.querySelector('#grid')\nclass List {\n  private grid = document.querySelector('#grid')\n  static of() {}\n}"
  },
  {
    rule: 'stops page listeners on the document and window with the page',
    detector: pageListenersWithoutSignal,
    files: () => sourceFiles('src/pages'),
    file: page,
    bad: "document.addEventListener('scroll', f)\nwindow.addEventListener('resize', f, { passive: true })",
    flags: 2,
    flagged: /:1 listens on the document without a signal[\s\S]*:2 listens on the window without a signal/,
    good: "document.addEventListener('scroll', f, { passive: true, signal })\nbutton.addEventListener('click', f)"
  },
  {
    rule: 'takes calendar dates from local time, never from toISOString',
    detector: utcCalendarDates,
    files: () => sourceFiles('src'),
    file: page,
    bad: 'const day = new Date().toISOString().slice(0, 10)',
    flags: 1,
    flagged: /takes a date from toISOString\(\)/,
    good: 'const updatedAt = new Date().toISOString()'
  }
]

describe('architecture', () => {
  describe.each(rules)('$rule', ({ detector, files, file, bad, flags, flagged, good }) => {
    it('flags each known mistake', () => {
      const found = detector(file, bad)
      expect(found).toHaveLength(flags)
      expect(found.join('\n')).toMatch(flagged)
    })

    it('passes the right way to write it', () => {
      expect(detector(file, good)).toEqual([])
    })

    it('holds across the repo', () => {
      expect(scan(files(), detector)).toEqual([])
    })
  })
})
