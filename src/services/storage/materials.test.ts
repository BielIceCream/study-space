import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import initialMigration from '../../../db/migrations/001_initial.sql?raw';
import type { BackupDocument, StorageService } from '../../shared/types';
import type { ImportBatchInput, ImportedAsset } from '../import/types';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const stores: StorageService[] = [];
const time = '2026-10-13T12:00:00.000Z';
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fonte preservada.' }] }] };

async function open(persistence = new MemoryPersistence()) {
  const store = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now: () => time });
  stores.push(store); return store;
}
async function batch(subjectId: string): Promise<ImportBatchInput> {
  const bytes = await readFile(new URL('../import/fixtures/studyspace.pdf', import.meta.url));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNT0AAAAASUVORK5CYII=', 'base64');
  const asset: ImportedAsset = { sha256: hash(png), fileName: 'diagram.png', mimeType: 'image/png', dataBase64: png.toString('base64') };
  return { subjectId, sourceName: 'studyspace.pdf', format: 'pdf', warnings: [],
    notes: [{ title: 'Material original', plainText: 'Fonte preservada.', bodyJson: body }],
    flashcards: [{ front: 'Função da membrana?', back: 'Regular a passagem.', noteIndex: 0, tags: ['biologia'], images: [{ assetHash: asset.sha256, side: 'front', alt: 'Diagrama' }] }],
    documents: [{ noteIndex: 0, fileName: 'studyspace.pdf', kind: 'pdf', mimeType: 'application/pdf', sha256: hash(bytes), dataBase64: bytes.toString('base64'), pages: [{ page: 1, text: 'membrane' }, { page: 2, text: 'transport' }] }], assets: [asset] };
}
async function seed(store: StorageService) {
  const subject = await store.createSubject({ name: 'Biologia', accent: 'green' });
  const input = await batch(subject.id); const result = await store.importBatch(input);
  return { subject, input, result };
}
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); });

describe('materiais em SQLite real', () => {
  it('preserva PDF original, páginas, tags e imagem ao fechar e reabrir, sem bytes no snapshot', async () => {
    const persistence = new MemoryPersistence(); const store = await open(persistence);
    const { input, result } = await seed(store); const before = await store.getSnapshot();
    expect(before.documents?.[0]).not.toHaveProperty('dataBase64');
    expect(before.documents?.[0]).not.toHaveProperty('pages');
    await store.close(); const reopened = await open(new MemoryPersistence(await persistence.load()));
    expect(await reopened.getSnapshot()).toEqual(before);
    expect(await reopened.getDocument(result.documentIds[0])).toMatchObject({ dataBase64: input.documents[0].dataBase64, pages: input.documents[0].pages });
    expect(await reopened.getAsset(input.assets[0].sha256)).toEqual(input.assets[0]);
    expect(before.cardMetadata?.[0]).toMatchObject({ flashcardId: result.flashcardIds[0], tags: ['biologia'], images: input.flashcards[0].images });
    expect(before.flashcards[0].noteId).toBe(result.noteIds[0]);
  });

  it('deduplica o mesmo arquivo e cartões normalizados dentro da matéria, conservando outras matérias', async () => {
    const store = await open(); const { input } = await seed(store);
    const repeated = await store.importBatch({ ...input, flashcards: [{ ...input.flashcards[0], front: '  FUNÇÃO   DA MEMBRANA? ', back: ' REGULAR A PASSAGEM. ' }] });
    expect(repeated).toEqual({ noteIds: [], flashcardIds: [], documentIds: [], skippedDuplicates: 2 });
    const other = await store.createSubject({ name: 'Outra', accent: 'blue' });
    const imported = await store.importBatch({ ...input, subjectId: other.id });
    expect(imported.documentIds).toHaveLength(1); expect(imported.flashcardIds).toHaveLength(1);
    const snapshot = await store.getSnapshot(); expect(snapshot.notes).toHaveLength(2); expect(snapshot.documents).toHaveLength(2);
  });

  it('conserva cartões de texto igual quando a imagem de estudo é diferente', async () => {
    const store = await open(); const { input } = await seed(store);
    const bytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
    const asset = { ...input.assets[0], fileName: 'other-diagram.gif', mimeType: 'image/gif', sha256: hash(bytes), dataBase64: bytes.toString('base64') };
    const result = await store.importBatch({ ...input, notes: [], documents: [], assets: [asset], flashcards: [{ ...input.flashcards[0], noteIndex: undefined, images: [{ assetHash: asset.sha256, side: 'front' }] }] });
    expect(result.flashcardIds).toHaveLength(1); expect(result.skippedDuplicates).toBe(0);
    expect((await store.getSnapshot()).cardMetadata).toHaveLength(2);
  });

  it('rejeita hash incorreto mesmo em documento repetido e mantém os bytes duráveis intactos', async () => {
    const persistence = new MemoryPersistence(); const store = await open(persistence); const { input } = await seed(store);
    const before = await persistence.load();
    const changed = { ...input, documents: [{ ...input.documents[0], dataBase64: Buffer.from('bytes adulterados').toString('base64') }] };
    await expect(store.importBatch(changed)).rejects.toThrow('integridade');
    expect(await persistence.load()).toEqual(before);
  });

  it('faz rollback completo quando documento, imagem ou referência do lote é inválido', async () => {
    const persistence = new MemoryPersistence(); const store = await open(persistence);
    const subject = await store.createSubject({ name: 'Biologia', accent: 'green' }); const valid = await batch(subject.id);
    const before = await persistence.load();
    const invalid: ImportBatchInput[] = [
      { ...valid, documents: [{ ...valid.documents[0], sha256: '0'.repeat(64) }] },
      { ...valid, assets: [{ ...valid.assets[0], sha256: '0'.repeat(64) }] },
      { ...valid, assets: [] },
      { ...valid, flashcards: [{ ...valid.flashcards[0], noteIndex: 4 }] },
      { ...valid, documents: [{ ...valid.documents[0], pages: [{ page: 1, text: 'a' }, { page: 1, text: 'b' }] }] },
    ];
    for (const candidate of invalid) {
      await expect(store.importBatch(candidate)).rejects.toThrow();
      expect(await persistence.load()).toEqual(before); expect((await store.getSnapshot()).notes).toEqual([]);
    }
    expect((await store.importBatch(valid)).documentIds).toHaveLength(1);
  });

  it('não publica lote quando o disco falha e permite nova tentativa ao reabrir', async () => {
    const persistence = new MemoryPersistence(); const store = await open(persistence);
    const subject = await store.createSubject({ name: 'Biologia', accent: 'green' }); const input = await batch(subject.id);
    const before = await persistence.load(); persistence.failNextSave = true;
    await expect(store.importBatch(input)).rejects.toThrow('gravar'); expect(await persistence.load()).toEqual(before);
    const reopened = await open(new MemoryPersistence(await persistence.load()));
    expect((await reopened.getSnapshot()).documents).toEqual([]);
    expect((await reopened.importBatch(input)).documentIds).toHaveLength(1);
  });

  it('migra banco v1 real preservando corpo, revisão, datas e tema das notas existentes', async () => {
    const SQL = await sql; const db = new SQL.Database(); db.exec(initialMigration);
    db.run('INSERT INTO subjects VALUES (?,?,?,?,?)', ['legacy-subject', 'Legado', 'blue', time, time]);
    db.run('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?)', ['legacy-note', 'legacy-subject', 'Nota anterior', JSON.stringify(body), 'Fonte preservada.', 7, time, time]);
    db.run("UPDATE settings SET value='dark' WHERE key='theme'");
    const persistence = new MemoryPersistence(db.export()); db.close(); const store = await open(persistence);
    const snapshot = await store.getSnapshot();
    expect(snapshot.notes[0]).toMatchObject({ id: 'legacy-note', bodyJson: body, revision: 7, createdAt: time, updatedAt: time, plainText: 'Fonte preservada.' });
    expect(snapshot.settings.theme).toBe('dark'); expect(snapshot.documents).toEqual([]);
    const inspected = new SQL.Database((await persistence.load())!); expect(inspected.exec('PRAGMA user_version')[0].values[0][0]).toBe(2); inspected.close();
    expect((await store.importBatch(await batch('legacy-subject'))).documentIds).toHaveLength(1);
    expect((await store.getSnapshot()).notes.find(n => n.id === 'legacy-note')?.revision).toBe(7);
  });

  it('backup v2 restaura originais e rollback de corrupção não altera destino; aceita backup v1', async () => {
    const source = await open(); const { input, result } = await seed(source); const backup = await source.exportBackup();
    expect(backup.version).toBe(2); const persistence = new MemoryPersistence(); const target = await open(persistence); const before = await persistence.load();
    const corrupt = structuredClone(backup); corrupt.materials!.documents[0].dataBase64 = Buffer.from('modificado').toString('base64');
    await expect(target.restoreBackup(corrupt)).rejects.toThrow('integridade'); expect(await persistence.load()).toEqual(before);
    persistence.failNextSave = true; await expect(target.restoreBackup(backup)).rejects.toThrow('gravar'); expect(await persistence.load()).toEqual(before);
    await target.restoreBackup(JSON.parse(JSON.stringify(backup))); const reopened = await open(new MemoryPersistence(await persistence.load()));
    expect(await reopened.getSnapshot()).toEqual(backup.data);
    expect((await reopened.getDocument(result.documentIds[0])).dataBase64).toBe(input.documents[0].dataBase64);
    expect(await reopened.getAsset(input.assets[0].sha256)).toEqual(input.assets[0]);
    const legacy = structuredClone(backup) as BackupDocument; legacy.version = 1; delete legacy.materials; delete legacy.data.documents; delete legacy.data.cardMetadata;
    const empty = await open(); await empty.restoreBackup(legacy);
    expect((await empty.getSnapshot()).notes).toEqual(legacy.data.notes); expect((await empty.getSnapshot()).documents).toEqual([]);
  });
});
