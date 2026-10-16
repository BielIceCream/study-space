import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { StorageService } from '../../shared/types';
import { IndexedDbPersistence } from './indexeddb';
import { createSQLiteStorage } from './sqlite';
import { storageError } from './validation';

export async function createBrowserStorage(): Promise<StorageService> {
  if (typeof indexedDB === 'undefined') throw new Error('Este navegador não oferece armazenamento local. Abra o StudySpace no aplicativo Windows.');
  const persistence = new IndexedDbPersistence();
  try {
    return await createSQLiteStorage({ persistence, initializeSqlite: () => initSqlJs({ locateFile: () => wasmUrl }) });
  } catch (error) {
    await persistence.close().catch(() => undefined);
    throw storageError(error);
  }
}
