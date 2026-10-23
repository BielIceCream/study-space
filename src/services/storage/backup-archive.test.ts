import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import initialMigration from '../../../db/migrations/001_initial.sql?raw';
import materialsMigration from '../../../db/migrations/002_materials.sql?raw';
import type { StorageService } from '../../shared/types';
import { ARCHIVE_HEADER_BYTES, ARCHIVE_MAGIC, readBackupArchive, validateArchiveManifest } from '../backup-archive';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const stores: StorageService[] = [];
const time = '2026-10-18T12:00:00.000Z';
const MiB = 1024 * 1024;
const magic = ARCHIVE_MAGIC;
const headerBytes = ARCHIVE_HEADER_BYTES;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNT0AAAAASUVORK5CYII=', 'base64');
const imageHash = hash(png);
const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ação e memória 🧠.' }] }] };

async function open(persistence = new MemoryPersistence()) {
  const store = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now: () => time });
  stores.push(store);
  return store;
}

/** Real schema, synthetic bytes only; avoid creating a second, inflated Base64 library. */
async function seededPersistence(documentBytes: number) {
  const SQL = await sql;
  const db = new SQL.Database();
  const documents: { id: string; sha256: string; byteLength: number }[] = [];
  try {
    db.exec(initialMigration);
    db.exec(materialsMigration);
    db.run('INSERT INTO subjects VALUES (?,?,?,?,?)', ['subject', 'Biologia 🧠', 'green', time, time]);
    for (let index = 0; index < 2; index++) {
      const id = `document-${index}`;
      const noteId = `note-${index}`;
      const bytes = new Uint8Array(documentBytes).fill(65 + index);
      const sha256 = hash(bytes);
      documents.push({ id, sha256, byteLength: bytes.byteLength });
      db.run('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?)', [noteId, 'subject', `Material ${index} — ação`, JSON.stringify(body), 'Ação e memória 🧠.', 3, time, time]);
      db.run('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, 'subject', noteId, `${id}.txt`, 'txt', 'text/plain', sha256, 1, JSON.stringify([{ page: 1, text: 'Revisão sintética.' }]), bytes, time]);
    }
    db.run('INSERT INTO flashcards VALUES (?,?,?,?,?,?,?)', ['card', 'subject', 'note-0', 'Função da membrana? 🧠', 'Regular a passagem.', time, time]);
    db.run('INSERT INTO review_logs VALUES (?,?,?,?,?)', ['review', 'card', 'session', 3, time]);
    db.run('INSERT INTO material_assets VALUES (?,?,?,?)', [imageHash, 'diagrama.png', 'image/png', png]);
    db.run('INSERT INTO card_metadata VALUES (?,?,?)', ['card', JSON.stringify(['biologia', 'revisão']), JSON.stringify([{ assetHash: imageHash, side: 'front', alt: 'Diagrama sintético' }])]);
    db.run("UPDATE settings SET value='dark' WHERE key='theme'");
    return { persistence: new MemoryPersistence(db.export()), documents };
  } finally { db.close(); }
}

function memoryReport(phase: string, archiveBytes?: number) {
  if (process.env.STUDYSPACE_BACKUP_MEMORY_REPORT !== '1') return;
  const memory = process.memoryUsage();
  console.info(JSON.stringify({ backupMemory: phase, archiveBytes, rssMiB: Math.round(memory.rss / MiB), heapUsedMiB: Math.round(memory.heapUsed / MiB), externalMiB: Math.round(memory.external / MiB), processPeakRssMiB: Math.round(process.resourceUsage().maxRSS / 1024) }));
}

async function rawArchive(manifest: unknown, materials: BlobPart[] = []) {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, bytes.byteLength, true);
  return new Blob([magic, length, createHash('sha256').update(bytes).digest(), bytes, ...materials]);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map(store => store.close()));
});

describe('backup binário em SQLite real', () => {
  it('restaura e reabre materiais acumulados acima de 50 MiB com notas, revisão, imagem e Unicode intactos', async () => {
    memoryReport('baseline');
    const seeded = await seededPersistence(28 * MiB);
    const source = await open(seeded.persistence);
    const before = await source.getSnapshot();
    memoryReport('source-ready');
    const file = await source.exportBackupArchive();
    expect(file.size).toBeGreaterThan(50 * MiB);
    expect(file.size).toBeLessThan(57 * MiB);
    memoryReport('exported', file.size);
    const fullRead = vi.spyOn(file, 'arrayBuffer').mockRejectedValue(new Error('Não ler o pacote completo na memória.'));
    const textRead = vi.spyOn(file, 'text').mockRejectedValue(new Error('Não converter o pacote completo em texto.'));
    const sliceRead = vi.spyOn(file, 'slice');
    const archive = await readBackupArchive(file);
    expect(archive.manifest.version).toBe(3);
    expect(archive.manifest.data).toEqual(before);
    expect(JSON.stringify(archive.manifest)).not.toContain('dataBase64');
    const persistence = new MemoryPersistence();
    const target = await open(persistence);
    await target.restoreBackupArchive(archive);
    expect(await target.getSnapshot()).toEqual(before);
    memoryReport('restored', file.size);
    await target.close();
    const reopened = await open(new MemoryPersistence(await persistence.load()));
    expect(await reopened.getSnapshot()).toEqual(before);
    for (const expected of seeded.documents) {
      const document = await reopened.getDocument(expected.id);
      const bytes = Buffer.from(document.dataBase64, 'base64');
      expect(bytes.byteLength).toBe(expected.byteLength);
      expect(hash(bytes)).toBe(expected.sha256);
      expect(document.pages).toEqual([{ page: 1, text: 'Revisão sintética.' }]);
    }
    expect(Buffer.from((await reopened.getAsset(imageHash)).dataBase64, 'base64')).toEqual(png);
    expect(fullRead).not.toHaveBeenCalled();
    expect(textRead).not.toHaveBeenCalled();
    expect(sliceRead.mock.calls.every(([start = 0, end = file.size]) => end - start <= 32 * MiB)).toBe(true);
    memoryReport('reopened-and-verified', file.size);
  }, 90_000);

  it('mantém os bytes duráveis intactos após corrupção, truncamento, versão futura e falha de gravação', async () => {
    const seeded = await seededPersistence(128);
    const source = await open(seeded.persistence);
    const file = await source.exportBackupArchive();
    const targetPersistence = new MemoryPersistence();
    const target = await open(targetPersistence);
    const before = await target.getSnapshot();
    const durableHash = hash((await targetPersistence.load())!);
    const assertIntact = async () => {
      expect(hash((await targetPersistence.load())!)).toBe(durableHash);
      expect(await target.getSnapshot()).toEqual(before);
    };
    // The hash and lengths must be checked before publishing any restored rows.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const manifestLength = new DataView(bytes.buffer).getUint32(magic.byteLength, true);
    for (const index of [headerBytes + 5, headerBytes + manifestLength + 1, bytes.length - 1]) {
      const changed = bytes.slice(); changed[index] ^= 1;
      await expect((async () => target.restoreBackupArchive(await readBackupArchive(new Blob([changed]))))()).rejects.toThrow();
      await assertIntact();
    }
    for (const size of [0, magic.byteLength - 1, headerBytes - 1, headerBytes + manifestLength - 1, file.size - 1]) {
      await expect((async () => target.restoreBackupArchive(await readBackupArchive(file.slice(0, size))))()).rejects.toThrow();
      await assertIntact();
    }
    const archive = await readBackupArchive(file);
    const future = { ...archive.manifest, version: 99 };
    await expect(readBackupArchive(await rawArchive(future))).rejects.toThrow();
    await assertIntact();
    const wrongMime = structuredClone(archive.manifest);
    wrongMime.materials.assets[0].mimeType = 'image/jpeg';
    const materials = await Promise.all([
      archive.readMaterial(0), archive.readMaterial(1), archive.readMaterial(2),
    ]);
    // A correct checksum cannot make PNG bytes a valid JPEG. Both candidate rows
    // and durable storage must roll back after the last material is rejected.
    await expect(target.restoreBackupArchive(await readBackupArchive(await rawArchive(wrongMime, materials as BlobPart[])))).rejects.toThrow('formato da imagem');
    await assertIntact();
    targetPersistence.failNextSave = true;
    await expect(target.restoreBackupArchive(archive)).rejects.toThrow('gravar');
    await assertIntact();
    const reopened = await open(new MemoryPersistence(await targetPersistence.load()));
    expect(await reopened.getSnapshot()).toEqual(before);
    await target.restoreBackupArchive(await readBackupArchive(file));
    expect(await target.getSnapshot()).toEqual(await source.getSnapshot());
    await expect(target.restoreBackupArchive(archive)).rejects.toThrow('biblioteca vazia');
  });

  it('mantém um retrato consistente enquanto outro cliente tenta gravar durante a exportação', async () => {
    const seeded = await seededPersistence(128);
    const source = await open(seeded.persistence);
    const writer = await open(seeded.persistence);
    const before = await source.getSnapshot();
    const saved = vi.spyOn(seeded.persistence, 'save');
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let materialStarted!: () => void;
    let releaseMaterial!: () => void;
    const started = new Promise<void>(resolve => { materialStarted = resolve; });
    const released = new Promise<void>(resolve => { releaseMaterial = resolve; });
    let digestCalls = 0;
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      if (++digestCalls === 2) {
        materialStarted();
        await released;
      }
      return digest(algorithm, data);
    });
    const exporting = source.exportBackupArchive();
    await started;
    const writing = writer.updateSubject('subject', { name: 'Biologia depois da exportação', accent: 'blue' });
    try {
      await Promise.resolve();
      await Promise.resolve();
      expect(saved).not.toHaveBeenCalled();
    } finally { releaseMaterial(); }
    const file = await exporting;
    await writing;
    const archive = await readBackupArchive(file);
    expect(archive.manifest.data).toEqual(before);
    expect(saved).toHaveBeenCalledOnce();
    expect((await source.getSnapshot()).subjects[0].name).toBe('Biologia depois da exportação');
    for (let index = 0; index < seeded.documents.length; index++) {
      expect(hash(await archive.readMaterial(index))).toBe(seeded.documents[index].sha256);
    }
  });

  it('recusa excesso de tamanho, manifesto, limites individuais e referências inconsistentes', async () => {
    const seeded = await seededPersistence(128);
    const source = await open(seeded.persistence);
    const file = await source.exportBackupArchive();
    const original = await readBackupArchive(file);
    // A Blob-shaped object makes it possible to prove the early size guard without allocating 256 MiB.
    let attemptedRead = false;
    const oversized = { size: 256 * MiB + 1, slice() { attemptedRead = true; throw new Error('não deveria ler'); } } as unknown as Blob;
    await expect(readBackupArchive(oversized)).rejects.toThrow();
    expect(attemptedRead).toBe(false);
    const excessiveLength = new Uint8Array(4);
    new DataView(excessiveLength.buffer).setUint32(0, 50 * MiB + 1, true);
    await expect(readBackupArchive(new Blob([magic, excessiveLength, new Uint8Array(32)]))).rejects.toThrow();
    const invalidManifests = [
      { ...original.manifest, unknownField: true },
      { ...original.manifest, materials: { ...original.manifest.materials, documents: original.manifest.materials.documents.map((document, index) => index === 0 ? { ...document, byteLength: 32 * MiB + 1 } : document) } },
      { ...original.manifest, materials: { ...original.manifest.materials, assets: original.manifest.materials.assets.map(asset => ({ ...asset, byteLength: 8 * MiB + 1 })) } },
      { ...original.manifest, materials: { ...original.manifest.materials, documents: original.manifest.materials.documents.map((document, index) => index === 0 ? { ...document, documentId: 'ausente' } : document) } },
      { ...original.manifest, materials: { ...original.manifest.materials, assets: [] } },
      { ...original.manifest, materials: { ...original.manifest.materials, documents: [original.manifest.materials.documents[0], original.manifest.materials.documents[0]] } },
    ];
    for (const manifest of invalidManifests) {
      expect(() => validateArchiveManifest(manifest)).toThrow();
      await expect(readBackupArchive(await rawArchive(manifest))).rejects.toThrow();
    }
    const excessiveTotal = structuredClone(original.manifest);
    excessiveTotal.data.documents = Array.from({ length: 8 }, (_, index) => ({
      ...original.manifest.data.documents![0], id: `large-${index}`, sha256: index.toString(16).padStart(64, '0'),
    }));
    excessiveTotal.materials.documents = excessiveTotal.data.documents.map(document => ({
      documentId: document.id, byteLength: 32 * MiB, pages: [{ page: 1, text: 'Revisão sintética.' }],
    }));
    // Eight valid document lengths fit 256 MiB; the manifest/header/images also count.
    expect(() => validateArchiveManifest(excessiveTotal)).toThrow('256 MiB');
    await expect(readBackupArchive(new Blob([file, new Uint8Array([0])]))).rejects.toThrow();
  });
});
