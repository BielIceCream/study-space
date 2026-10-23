import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { StorageService } from '../../shared/types';
import { createBackupArchive, readBackupArchive } from '../backup-archive';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';
import { validateSnapshot } from './validation';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const TIME = '2026-10-21T12:00:00.000Z';
const stores: StorageService[] = [];

async function open(persistence = new MemoryPersistence(), now = () => TIME) {
  const storage = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now });
  stores.push(storage);
  return storage;
}

async function seed(storage: StorageService) {
  const subject = await storage.createSubject({ name: 'Biologia', accent: 'green' });
  return storage.createFlashcard({ subjectId: subject.id, noteId: null, front: 'Qual a função da membrana?', back: 'Regular a passagem de substâncias.' });
}

async function editDatabase(persistence: MemoryPersistence, statement: string) {
  const SQL = await sql;
  const database = new SQL.Database((await persistence.load())!);
  try {
    database.run(statement);
    await persistence.save(database.export());
  } finally { database.close(); }
}

afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); });

describe('agenda de revisão espaçada no SQLite real', () => {
  it('exige adesão explícita e preserva prática livre, histórico e estado após reabrir', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const card = await seed(storage);
    const free = await storage.recordReview({ flashcardId: card.id, sessionId: 'livre-antiga', rating: 4 });
    expect((await storage.getSnapshot()).reviewSchedules).toBeUndefined();
    const scheduled = await storage.recordReview({ flashcardId: card.id, sessionId: 'espacada', rating: 3, schedule: true });
    const [state] = (await storage.getSnapshot()).reviewSchedules!;
    expect(state).toEqual({ flashcardId: card.id, algorithmVersion: 1, stage: 1, repetitions: 1, lapses: 0, firstReviewId: scheduled.id, introducedAt: TIME, lastReviewId: scheduled.id, lastReviewedAt: TIME, dueAt: '2026-10-22T12:00:00.000Z' });
    await storage.recordReview({ flashcardId: card.id, sessionId: 'livre-nova', rating: 1, schedule: false });
    const snapshot = await storage.getSnapshot();
    expect(snapshot.reviewLogs).toContainEqual(free);
    expect(snapshot.reviewSchedules).toEqual([state]);
    const reopened = await open(new MemoryPersistence(await persistence.load()));
    expect(await reopened.getSnapshot()).toEqual(snapshot);
  });

  it('serializa duas janelas e não avança duas vezes ao receber avaliações concorrentes', async () => {
    const persistence = new MemoryPersistence();
    const first = await open(persistence);
    const second = await open(persistence);
    const card = await seed(first);
    const [one, two] = await Promise.all([
      first.recordReview({ flashcardId: card.id, sessionId: 'duplo', rating: 4, schedule: true }),
      second.recordReview({ flashcardId: card.id, sessionId: 'duplo', rating: 1, schedule: true }),
    ]);
    expect(two).toEqual(one);
    const snapshot = await second.getSnapshot();
    expect(snapshot.reviewLogs).toEqual([one]);
    expect(snapshot.reviewSchedules).toHaveLength(1);
    expect(snapshot.reviewSchedules![0]).toMatchObject({ repetitions: 1, stage: 2, lapses: 0, lastReviewId: one.id, dueAt: '2026-10-24T12:00:00.000Z' });
  });

  it('repetir uma sessão antiga após reinício devolve o log original sem retroceder a agenda', async () => {
    let time = TIME;
    const persistence = new MemoryPersistence();
    const storage = await open(persistence, () => time);
    const card = await seed(storage);
    const first = await storage.recordReview({ flashcardId: card.id, sessionId: 'primeira', rating: 3, schedule: true });
    time = '2026-10-22T12:00:00.000Z';
    await storage.recordReview({ flashcardId: card.id, sessionId: 'segunda', rating: 3, schedule: true });
    const before = await storage.getSnapshot();
    const reopened = await open(new MemoryPersistence(await persistence.load()), () => time);
    expect(await reopened.recordReview({ flashcardId: card.id, sessionId: 'primeira', rating: 1, schedule: true })).toEqual(first);
    expect(await reopened.getSnapshot()).toEqual(before);
    expect(before.reviewSchedules![0]).toMatchObject({ repetitions: 2, stage: 2, firstReviewId: first.id, introducedAt: TIME, dueAt: '2026-10-25T12:00:00.000Z' });
  });

  it('não converte uma resposta livre em espaçada ao reutilizar a mesma sessão e cartão', async () => {
    const storage = await open();
    const card = await seed(storage);
    const first = await storage.recordReview({ flashcardId: card.id, sessionId: 'mesma', rating: 2 });
    expect(await storage.recordReview({ flashcardId: card.id, sessionId: 'mesma', rating: 4, schedule: true })).toEqual(first);
    expect((await storage.getSnapshot()).reviewLogs).toEqual([first]);
    expect((await storage.getSnapshot()).reviewSchedules).toBeUndefined();
  });

  it('não publica log nem agenda quando o save durável falha e permite tentar de novo', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const card = await seed(storage);
    const before = await storage.getSnapshot();
    const bytes = await persistence.load();
    persistence.failNextSave = true;
    const input = { flashcardId: card.id, sessionId: 'falha-save', rating: 3 as const, schedule: true };
    await expect(storage.recordReview(input)).rejects.toThrow('gravar');
    expect(await persistence.load()).toEqual(bytes);
    expect(await storage.getSnapshot()).toEqual(before);
    const log = await storage.recordReview(input);
    expect((await storage.getSnapshot()).reviewLogs).toEqual([log]);
    expect((await storage.getSnapshot()).reviewSchedules![0]).toMatchObject({ repetitions: 1, lastReviewId: log.id });
  });

  it('reverte o log se a gravação do estado falha depois de inserir a resposta', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const card = await seed(storage);
    await editDatabase(persistence, "CREATE TRIGGER fail_schedule BEFORE INSERT ON review_schedules BEGIN SELECT RAISE(ABORT, 'falha entre resposta e agenda'); END;");
    const before = await storage.getSnapshot();
    const bytes = await persistence.load();
    const input = { flashcardId: card.id, sessionId: 'falha-estado', rating: 1 as const, schedule: true };
    await expect(storage.recordReview(input)).rejects.toThrow();
    expect(await persistence.load()).toEqual(bytes);
    expect(await storage.getSnapshot()).toEqual(before);
    await editDatabase(persistence, 'DROP TRIGGER fail_schedule');
    await storage.recordReview(input);
    expect((await storage.getSnapshot()).reviewSchedules![0]).toMatchObject({ repetitions: 1, lapses: 1, stage: 0, dueAt: '2026-10-21T12:10:00.000Z' });
  });

  it('recusa avanço antecipado e relógio regressivo, conservando o estado e o histórico', async () => {
    let time = TIME;
    const storage = await open(new MemoryPersistence(), () => time);
    const card = await seed(storage);
    await storage.recordReview({ flashcardId: card.id, sessionId: 'inicio', rating: 3, schedule: true });
    const before = await storage.getSnapshot();
    time = '2026-10-22T11:59:59.999Z';
    await expect(storage.recordReview({ flashcardId: card.id, sessionId: 'cedo', rating: 4, schedule: true })).rejects.toThrow();
    time = '2026-10-20T12:00:00.000Z';
    await expect(storage.recordReview({ flashcardId: card.id, sessionId: 'relogio', rating: 1, schedule: true })).rejects.toThrow();
    expect(await storage.getSnapshot()).toEqual(before);
    time = '2026-10-22T12:00:00.000Z';
    await storage.recordReview({ flashcardId: card.id, sessionId: 'no-vencimento', rating: 3, schedule: true });
    expect((await storage.getSnapshot()).reviewSchedules![0].repetitions).toBe(2);
  });

  it('migra um banco v4 com cópia exata e não cria agenda para avaliações antigas', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const card = await seed(storage);
    await storage.recordReview({ flashcardId: card.id, sessionId: 'legada', rating: 4 });
    const before = await storage.getSnapshot();
    await editDatabase(persistence, 'DROP TABLE error_entries; DROP TABLE review_schedules; PRAGMA user_version=4;');
    const oldBytes = await persistence.load();
    const migrated = await open(persistence);
    expect(await migrated.getSnapshot()).toEqual(before);
    const [metadata] = await migrated.listRecoveryCopies();
    expect(metadata).toMatchObject({ schemaVersion: 4, targetSchemaVersion: 6 });
    expect((await persistence.loadRecovery(metadata.id))!.bytes).toEqual(oldBytes);
    expect((await migrated.getSnapshot()).reviewSchedules).toBeUndefined();
  });

  it('exporta e restaura agenda, histórico e próxima revisão no portátil v6', async () => {
    const source = await open();
    const card = await seed(source);
    await source.recordReview({ flashcardId: card.id, sessionId: 'portatil', rating: 4, schedule: true });
    const expected = await source.getSnapshot();
    const archive = await readBackupArchive(await source.exportBackupArchive());
    expect(archive.manifest.version).toBe(6);
    const persistence = new MemoryPersistence();
    const target = await open(persistence);
    await target.restoreBackupArchive(archive);
    expect(await target.getSnapshot()).toEqual(expected);
    expect(await (await open(new MemoryPersistence(await persistence.load()))).getSnapshot()).toEqual(expected);
    await expect(source.exportBackup()).rejects.toThrow();
    await expect(createBackupArchive({ ...archive.manifest, version: 5 }, archive.readMaterial)).rejects.toThrow();
  });

  it('rejeita estados duplicados, cartões ausentes e vínculos inválidos com a última resposta', async () => {
    const storage = await open();
    const card = await seed(storage);
    await storage.recordReview({ flashcardId: card.id, sessionId: 'valida', rating: 3, schedule: true });
    const original = await storage.getSnapshot();
    const state = original.reviewSchedules![0];
    for (const reviewSchedules of [
      [state, state],
      [{ ...state, flashcardId: 'cartao-ausente' }],
      [{ ...state, lastReviewId: 'resposta-ausente' }],
      [{ ...state, lastReviewedAt: '2026-10-20T12:00:00.000Z' }],
      [{ ...state, dueAt: '2026-10-20T12:00:00.000Z' }],
    ]) expect(() => validateSnapshot({ ...original, reviewSchedules })).toThrow();
    const target = await open();
    const archive = await readBackupArchive(await storage.exportBackupArchive());
    await expect(target.restoreBackupArchive({ ...archive, manifest: { ...archive.manifest, data: { ...original, reviewSchedules: [{ ...state, lastReviewId: 'ausente' }] } } })).rejects.toThrow();
    expect((await target.getSnapshot()).flashcards).toEqual([]);
  });
});
