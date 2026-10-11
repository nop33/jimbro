import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vite-plus/test'

const root = path.resolve(import.meta.dirname, '..')

const sourceFiles = (dir: string): Array<string> =>
  readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts'))
    .map((file) => path.join(dir, file))

const appAndWorkerFiles = [...sourceFiles('src'), ...sourceFiles('worker/src')]

describe('architecture', () => {
  it('imports every symbol from the module that declares it', () => {
    const reExport = /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g
    const found = appAndWorkerFiles.flatMap((file) =>
      [...readFileSync(path.join(root, file), 'utf8').matchAll(reExport)].map(
        ([, from]) =>
          `${file} re-exports from '${from}'. Import from '${from}' where it is used and delete the re-export.`
      )
    )
    expect(found).toEqual([])
  })

  it('builds HTML only from fixed markup', () => {
    // innerHTML parses what it gets, so an exercise name typed, imported or synced in runs as markup. df6d559 fixed
    // that in the toast and the gymtime error page, and missed the program exercise picker.
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
    const found = sourceFiles('src').flatMap((file) => {
      const source = ts.createSourceFile(file, readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest)
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
        const parsesMarkup =
          ts.isCallExpression(node) && markupIndex !== undefined && !isFixed(node.arguments[markupIndex])
        if (assignsMarkup || parsesMarkup)
          sinks.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`)
        ts.forEachChild(node, visit)
      }
      visit(source)
      return sinks.map(
        (sink) =>
          `${sink} builds HTML from a value. Create the elements and set their textContent, or use new Option() for a select.`
      )
    })
    expect(found).toEqual([])
  })

  it('leaves the outbox and meta stores to src/sync', () => {
    // The schema creates them. Everything else reaches them through src/sync, so the rules for an entry's seq and
    // inflight stamp live next to the push and pull that depend on them.
    const schema = ['src/db/constants.ts', 'src/db/migrations.ts'].map((file) => path.normalize(file))
    const syncStore = /OBJECT_STORES\.(?:OUTBOX|META)\b|['"](?:outbox|meta)['"]/
    const found = sourceFiles('src')
      .filter((file) => !file.startsWith(path.join('src', 'sync')) && !schema.includes(file))
      .filter((file) => syncStore.test(readFileSync(path.join(root, file), 'utf8')))
      .map(
        (file) =>
          `${file} reads or writes the outbox or meta store. Use storage.writeRows to queue a row, and the src/sync modules for the rest.`
      )
    expect(found).toEqual([])
  })

  it('leaves page notices to pageChannel, custom events to EventEmitter, and opens no BroadcastChannel', () => {
    // A notice sent or heard as a bare jimbro: window event skips announce and onPageNotice, and its listener gets no
    // typed notice. A custom event between modules, like the exercise-clicked event that ExerciseList's callback
    // replaced, reaches its listeners untyped. A BroadcastChannel carried notices to other tabs until each user ran
    // the app in one tab on one device. An open channel also cost every Back a full reload, because the back/forward
    // cache evicts a page whose channel gets a message.
    const channelFile = path.normalize('src/sync/pageChannel.ts')
    const emitterFile = path.normalize('src/eventEmitter.ts')
    const pageNotice = /(?:EventListener|Event)\s*(?:<.*?>)?\(\s*['"`]jimbro:/
    const customEvent = /new\s+(?:window\.)?CustomEvent\s*(?:<.*?>)?\((?!\s*['"`]jimbro:)/
    const broadcastChannel = /\bBroadcastChannel\b/
    const files = sourceFiles('src')
    const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
    const found = [
      ...files
        .filter((file) => file !== channelFile && pageNotice.test(read(file)))
        .map(
          (file) =>
            `${file} sends or hears a notice outside pageChannel. Use announce and onPageNotice from src/sync/pageChannel.ts, which keep the notices typed in one place.`
        ),
      ...files
        .filter((file) => file !== emitterFile && customEvent.test(read(file)))
        .map(
          (file) =>
            `${file} creates a CustomEvent, which its listeners must cast to read. Give the other module a typed callback, or use EventEmitter from src/eventEmitter.ts.`
        ),
      ...files
        .filter((file) => broadcastChannel.test(read(file)))
        .map(
          (file) =>
            `${file} uses a BroadcastChannel. The app runs in one tab, so notices stay in the page: use announce and onPageNotice from src/sync/pageChannel.ts.`
        )
    ]
    expect(found).toEqual([])
  })

  it('opens a readwrite transaction only in writeRows and src/sync', () => {
    // A row put in any other transaction never reaches the outbox, so it never syncs. The Storage writers that
    // 51fa002 deleted did that.
    const writeRowsFile = path.normalize('src/db/storage.ts')
    const found = sourceFiles('src')
      .filter((file) => !file.startsWith(path.join('src', 'sync')))
      .flatMap((file) => {
        const opened = readFileSync(path.join(root, file), 'utf8').match(/['"]readwrite['"]/g)?.length ?? 0
        const allowed = file === writeRowsFile ? 1 : 0
        return opened > allowed
          ? [
              `${file} opens ${opened} readwrite transactions where ${allowed} is allowed. Write rows with storage.writeRows, and keep the sync's own transactions in src/sync.`
            ]
          : []
      })
    expect(found).toEqual([])
  })

  it('waits in specs for what the app shows or stores, never for a fixed time', () => {
    // A sleep long enough on one machine is too short on a slower one, and a forced click skips the checks that wait
    // until the element can take it. f814248 added a sleep and 7b4170e a forced click to quiet flaky gymtime tests,
    // and 0b3f181 and bc7c33a took such sleeps and clicks out again.
    const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
    const testFiles = sourceFiles('tests')
    const specs = testFiles.filter((file) => file.endsWith('.spec.ts'))
    const helpers = specs.flatMap((spec) =>
      [...read(spec).matchAll(/from\s+['"](\.{1,2}\/[^'"]+?)(?:\.ts)?['"]/g)].map(([, from]) =>
        path.join(path.dirname(spec), `${from}.ts`)
      )
    )
    const waitInstead =
      'Wait for what the app shows or stores instead, with expect, expect.poll or page.waitForFunction.'
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
    const found = testFiles
      .filter((file) => specs.includes(file) || helpers.includes(file))
      .flatMap((file) => {
        const source = read(file)
        return mistakes.flatMap(({ pattern, message }) =>
          [...source.matchAll(pattern)].map(
            ({ index }) => `${file}:${source.slice(0, index).split('\n').length} ${message}`
          )
        )
      })
    expect(found).toEqual([])
  })

  it('takes calendar dates from local time, never from toISOString', () => {
    // toISOString() is UTC, so away from UTC its date is a day off for part of every day. f9d3364 fixed the
    // workout form's default date for that.
    const utcDay =
      /toISOString\(\)\s*\.\s*(?:split\(\s*['"]T['"]|slice\(\s*0\s*,\s*10\s*\)|substr(?:ing)?\(\s*0\s*,\s*10\s*\))/
    const found = sourceFiles('src')
      .filter((file) => utcDay.test(readFileSync(path.join(root, file), 'utf8')))
      .map(
        (file) =>
          `${file} takes a date from toISOString(), which is UTC. Use getSimpleDate from src/dateUtils.ts for today, and parseSimpleDate to read a stored date.`
      )
    expect(found).toEqual([])
  })
})
