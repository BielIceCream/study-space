import { RECOVERY_RETENTION } from './recovery';
import type { RecoveryMetadata, RecoveryRecord } from './recovery';

export interface PersistenceAdapter {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  saveRecovery(record: RecoveryRecord): Promise<void>;
  loadRecovery(id: string): Promise<RecoveryRecord | null>;
  listRecovery(): Promise<RecoveryMetadata[]>;
  pruneRecovery(keepId: string): Promise<void>;
  close?(): Promise<void>;
}

/** Test adapter that models shared, durable bytes and serializes independent clients. */
export class MemoryPersistence implements PersistenceAdapter {
  private bytes: Uint8Array | null;
  private queue: Promise<unknown> = Promise.resolve();
  failNextSave = false;
  failNextRecoverySave = false;
  private recovery = new Map<string, RecoveryRecord>();

  constructor(initial: Uint8Array | null = null) {
    this.bytes = initial?.slice() ?? null;
  }

  async load(): Promise<Uint8Array | null> {
    return this.bytes?.slice() ?? null;
  }

  async save(bytes: Uint8Array): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('Não foi possível gravar os dados locais.');
    }
    this.bytes = bytes.slice();
  }

  async saveRecovery(record: RecoveryRecord): Promise<void> {
    if (this.failNextRecoverySave) {
      this.failNextRecoverySave = false;
      throw new Error('Não foi possível gravar a cópia de recuperação. Verifique o espaço disponível.');
    }
    if (this.recovery.has(record.metadata.id)) throw new Error('Uma cópia com esse identificador já existe.');
    this.recovery.set(record.metadata.id, { metadata: { ...record.metadata }, bytes: record.bytes.slice() });
  }

  async loadRecovery(id: string): Promise<RecoveryRecord | null> {
    const record = this.recovery.get(id);
    return record ? { metadata: { ...record.metadata }, bytes: record.bytes.slice() } : null;
  }

  async listRecovery(): Promise<RecoveryMetadata[]> {
    return Array.from(this.recovery.values(), record => ({ ...record.metadata }));
  }

  async pruneRecovery(keepId: string): Promise<void> {
    if (!this.recovery.has(keepId)) throw new Error('A cópia a preservar não existe.');
    const others = [...this.recovery.values()].filter(record => record.metadata.id !== keepId)
      .sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt) || b.metadata.id.localeCompare(a.metadata.id));
    for (const record of others.slice(RECOVERY_RETENTION - 1)) this.recovery.delete(record.metadata.id);
  }

  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
