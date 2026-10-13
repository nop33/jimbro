import { ROW_TABLES, type Row, type RowTable } from '../db/types'
import { rowsEqual } from './rows'

export type BootstrapAction = 'keepServer' | 'pushLocal' | 'same'

export const rowKey = (row: Row) => `${row.table}:${row.row.id}`

const isRowTable = (value: string): value is RowTable => (ROW_TABLES as readonly string[]).includes(value)

export const splitRowKey = (key: string): { table: RowTable; id: string } | undefined => {
  const index = key.indexOf(':')
  if (index <= 0) return undefined
  const table = key.slice(0, index)
  if (!isRowTable(table)) return undefined
  return { table, id: key.slice(index + 1) }
}

export const planBootstrap = (local: readonly Row[], pulled: readonly Row[]): Map<string, BootstrapAction> => {
  const pulledByKey = new Map<string, Row>()
  for (const row of pulled) pulledByKey.set(rowKey(row), row)

  const actions = new Map<string, BootstrapAction>()
  const localKeys = new Set<string>()

  for (const row of local) {
    const key = rowKey(row)
    localKeys.add(key)
    const remote = pulledByKey.get(key)
    if (!remote) {
      actions.set(key, 'pushLocal')
      continue
    }
    actions.set(key, rowsEqual(row.row, remote.row) ? 'same' : 'keepServer')
  }

  for (const row of pulled) {
    const key = rowKey(row)
    if (!localKeys.has(key)) actions.set(key, 'keepServer')
  }

  return actions
}

// Whether a first sync with these pulled rows would replace any local row: a row both sides have that differs, where
// the account's copy wins. Rows only on one side are kept, so they replace nothing.
export const replacesLocalRows = (local: readonly Row[], pulled: readonly Row[]) => {
  const actions = planBootstrap(local, pulled)
  return local.some((row) => actions.get(rowKey(row)) === 'keepServer')
}
