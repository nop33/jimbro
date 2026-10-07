import { DatabaseConnection } from './connection'
import {
  writeRows as writeRowsImpl,
  getMeta as getMetaImpl,
  readFirstSyncSnapshot as readFirstSyncSnapshotImpl,
  commitFirstSync as commitFirstSyncImpl,
  commitPullPage as commitPullPageImpl
} from './write'
import type { Row } from './types'
import type { BootstrapAction } from '../sync/bootstrap'

export class Storage {
  private dbConnection = new DatabaseConnection()

  async connection(): Promise<IDBDatabase> {
    return this.dbConnection.getDatabase()
  }

  async writeRows(writes: Array<Row>): Promise<void> {
    return writeRowsImpl(this.dbConnection, writes)
  }

  async getMeta(name: 'cursor' | 'seq' | 'bootstrapped'): Promise<number> {
    return getMetaImpl(this.dbConnection, name)
  }

  async readFirstSyncSnapshot(): Promise<{ seq: number; rows: Row[] }> {
    return readFirstSyncSnapshotImpl(this.dbConnection)
  }

  async commitFirstSync(input: {
    seqAtStart: number
    cursor: number
    actions: Map<string, BootstrapAction>
    pulledByKey: Map<string, Row>
  }): Promise<void> {
    return commitFirstSyncImpl(this.dbConnection, input)
  }

  async commitPullPage(page: Array<Row & { rev: number }>, cursor: number): Promise<Row[]> {
    return commitPullPageImpl(this.dbConnection, page, cursor)
  }

  async get<T>(storeName: string, key: string | number): Promise<T | undefined> {
    return this.dbConnection.get<T>(storeName, key)
  }

  async getAllByIndex<T>(storeName: string, indexName: string, key: string | number): Promise<Array<T>> {
    return this.dbConnection.getAllByIndex<T>(storeName, indexName, key)
  }

  async getFirstByPredicate<T>(
    storeName: string,
    indexName: string,
    direction: IDBCursorDirection,
    predicate: (value: T) => boolean
  ): Promise<T | undefined> {
    return this.dbConnection.getFirstByPredicate<T>(storeName, indexName, direction, predicate)
  }

  async getAll<T>(storeName: string): Promise<Array<T>> {
    return this.dbConnection.getAll<T>(storeName)
  }

  async count(storeName: string): Promise<number> {
    return this.dbConnection.count(storeName)
  }

  async deleteDatabase() {
    return this.dbConnection.deleteDatabase()
  }
}

export const storage = new Storage()
