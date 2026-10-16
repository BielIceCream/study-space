import type { PersistenceAdapter } from './persistence';

interface Lease { owner: string; expiresAt: number }
const STORE = 'storage';
const DATABASE_KEY = 'sqlite';
const LEASE_KEY = 'writer';
const LEASE_MS = 30_000;

/** Every SQLite read/write happens inside the same cross-tab exclusive lock. */
export class IndexedDbPersistence implements PersistenceAdapter {
  private database: Promise<IDBDatabase> | null = null;
  private readonly lockName: string;
  private readonly name: string;
  private leaseOwner: string | null = null;
  private leaseLost = false;

  constructor(name = 'studyspace-local-v1') {
    this.name = name;
    this.lockName = `${name}:sqlite`;
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(new Error('Não foi possível abrir o armazenamento local do navegador.'));
      request.onblocked = () => reject(new Error('Feche outras abas do StudySpace para atualizar o armazenamento local.'));
    });
    return this.database;
  }

  private async transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, set: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let result: T;
      let failure: Error | undefined;
      const transaction = db.transaction(STORE, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? new Error('Não foi possível gravar os dados locais. O armazenamento pode estar cheio.'));
      transaction.onerror = () => { /* onabort reports the error after the transaction has rolled back. */ };
      try {
        work(transaction.objectStore(STORE), (value) => { result = value; }, (error) => {
          failure = error;
          transaction.abort();
        });
      } catch (error) {
        failure = error instanceof Error ? error : new Error('Não foi possível acessar os dados locais.');
        transaction.abort();
      }
    });
  }

  async load(): Promise<Uint8Array | null> {
    return this.transaction<Uint8Array | null>('readonly', (store, set, fail) => {
      const request = store.get(DATABASE_KEY);
      request.onsuccess = () => {
        if (request.result === undefined) set(null);
        else if (request.result instanceof ArrayBuffer) set(new Uint8Array(request.result));
        else if (request.result instanceof Uint8Array) set(request.result.slice());
        else fail(new Error('O arquivo do banco local está em um formato inválido.'));
      };
    });
  }

  async save(bytes: Uint8Array): Promise<void> {
    const buffer = bytes.slice().buffer;
    await this.transaction<void>('readwrite', (store, set, fail) => {
      const write = () => { store.put(buffer, DATABASE_KEY); set(undefined); };
      if (this.leaseOwner === null) { write(); return; }
      const owner = this.leaseOwner;
      const request = store.get(LEASE_KEY);
      request.onsuccess = () => {
        const lease = request.result as Lease | undefined;
        // Fencing inside the same IndexedDB transaction prevents a suspended tab from
        // overwriting newer bytes after another tab has acquired the expired lease.
        if (this.leaseLost || lease?.owner !== owner || lease.expiresAt <= Date.now()) {
          fail(new Error('Outra aba assumiu a gravação. Tente salvar novamente.'));
          return;
        }
        write();
      };
    });
  }

  private async claim(owner: string): Promise<boolean> {
    return this.transaction<boolean>('readwrite', (store, set) => {
      const request = store.get(LEASE_KEY);
      request.onsuccess = () => {
        const lease = request.result as Lease | undefined;
        if (lease && lease.owner !== owner && lease.expiresAt > Date.now()) { set(false); return; }
        store.put({ owner, expiresAt: Date.now() + LEASE_MS } satisfies Lease, LEASE_KEY);
        set(true);
      };
    });
  }

  private async renew(owner: string): Promise<void> {
    await this.transaction<void>('readwrite', (store, set) => {
      const request = store.get(LEASE_KEY);
      request.onsuccess = () => {
        const lease = request.result as Lease | undefined;
        if (lease?.owner !== owner || lease.expiresAt <= Date.now()) this.leaseLost = true;
        else store.put({ owner, expiresAt: Date.now() + LEASE_MS } satisfies Lease, LEASE_KEY);
        set(undefined);
      };
    });
  }

  private async release(owner: string): Promise<void> {
    await this.transaction<void>('readwrite', (store, set) => {
      const request = store.get(LEASE_KEY);
      request.onsuccess = () => {
        if ((request.result as Lease | undefined)?.owner === owner) store.delete(LEASE_KEY);
        set(undefined);
      };
    });
  }

  async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return navigator.locks.request(this.lockName, { mode: 'exclusive' }, work);
    }
    const owner = crypto.randomUUID();
    const deadline = Date.now() + 15_000;
    while (!(await this.claim(owner))) {
      if (Date.now() > deadline) throw new Error('Outra aba está salvando os dados. Tente novamente em instantes.');
      await new Promise((resolve) => setTimeout(resolve, 80 + Math.random() * 40));
    }
    this.leaseOwner = owner;
    this.leaseLost = false;
    const heartbeat = setInterval(() => {
      void this.renew(owner).catch(() => { this.leaseLost = true; });
    }, LEASE_MS / 3);
    try {
      const result = await work();
      if (this.leaseLost) throw new Error('Outra aba assumiu a gravação. Tente novamente.');
      return result;
    } finally {
      clearInterval(heartbeat);
      this.leaseOwner = null;
      await this.release(owner).catch(() => undefined);
    }
  }

  async close(): Promise<void> { if (this.database) (await this.database).close(); }
}
