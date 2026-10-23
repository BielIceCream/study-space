import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { StorageService } from '../../shared/types';
import { IndexedDbPersistence } from './indexeddb';
import { createSQLiteStorage, exportRecoveryArchive } from './sqlite';
import { listRecoveryMetadata } from './recovery';
import type { RecoveryMetadata } from './recovery';
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

export async function listBrowserRecoveryCopies(): Promise<RecoveryMetadata[]> {
  const persistence = new IndexedDbPersistence();
  try { return await persistence.exclusive(() => listRecoveryMetadata(persistence)); }
  finally { await persistence.close(); }
}

export async function exportBrowserRecoveryCopy(id: string): Promise<Blob> {
  const persistence = new IndexedDbPersistence();
  try { return await exportRecoveryArchive(persistence, () => initSqlJs({ locateFile: () => wasmUrl }), id); }
  finally { await persistence.close(); }
}
