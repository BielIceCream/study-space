export interface PersistenceAdapter {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  close?(): Promise<void>;
}

/** Test adapter that models shared, durable bytes and serializes independent clients. */
export class MemoryPersistence implements PersistenceAdapter {
  private bytes: Uint8Array | null;
  private queue: Promise<unknown> = Promise.resolve();
  failNextSave = false;

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

  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
