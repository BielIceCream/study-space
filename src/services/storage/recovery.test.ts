import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupDocument, StorageService } from '../../shared/types';
import { createBackupArchive, readBackupArchive } from '../backup-archive';
import { DEMO_CATALOG, defaultConfig } from '../../domain/study/demo';
import { startDiagnostic, answerDiagnostic } from '../../domain/study/engine';
import { acceptPreview, buildPreview, completeBlock, defaultPlannerConfig, toggleFixed } from '../../domain/planner/engine';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage, type SQLiteStorageOptions } from './sqlite';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const fixture: BackupDocument = JSON.parse(readFileSync(new URL('../../../tests/fixtures/recovery-parity.json', import.meta.url), 'utf8'));
const stores: StorageService[] = [];
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const failedPlan = [{ version: 7, sql: "UPDATE subjects SET name = 'Candidato que deve ser descartado'; SELECT * FROM migration_fault;" }];
const successfulPlan = [{ version: 7, sql: 'CREATE TABLE mission_three_marker (id INTEGER); PRAGMA user_version = 7;' }];

async function open(persistence = new MemoryPersistence(), migrationPlan?: SQLiteStorageOptions['migrationPlan'], now = () => fixture.exportedAt) {
  const storage = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now, migrationPlan });
  stores.push(storage);
  return storage;
}

async function populated() {
  const persistence = new MemoryPersistence();
  const storage = await open(persistence);
  await storage.restoreBackup(structuredClone(fixture));
  return { persistence, storage, bytes: (await persistence.load())! };
}

async function assertLibrary(storage: StorageService) {
  expect(await storage.getSnapshot()).toEqual(fixture.data);
  const exported = await storage.exportBackup();
  expect(exported.materials).toEqual(fixture.materials);
  for (const metadata of fixture.data.documents!) {
    const document = await storage.getDocument(metadata.id);
    const payload = fixture.materials!.documents.find(item => item.documentId === metadata.id)!;
    expect(document).toEqual({ ...metadata, dataBase64: payload.dataBase64, pages: payload.pages });
  }
  for (const asset of fixture.materials!.assets) expect(await storage.getAsset(asset.sha256)).toEqual(asset);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map(store => store.close()));
});

describe('recuperação antes de migrações', () => {
  it('não cria cópias para banco novo nem para a versão já atual', async () => {
    const { persistence, storage } = await populated();
    expect(await persistence.listRecovery()).toEqual([]);
    expect(await storage.listRecoveryCopies()).toEqual([]);
    await assertLibrary(await open(persistence));
    expect(await persistence.listRecovery()).toEqual([]);
  });

  it('preserva o SQLite exato anterior a uma migração SQL que falha após alterar o candidato', async () => {
    const { persistence, bytes } = await populated();
    await expect(open(persistence, failedPlan)).rejects.toThrow();
    expect(await persistence.load()).toEqual(bytes);
    const copies = await persistence.listRecovery();
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ format: 'studyspace-recovery', version: 1, schemaVersion: 6, targetSchemaVersion: 7, reason: 'before-migration', createdAt: fixture.exportedAt, byteLength: bytes.byteLength, sha256: hash(bytes) });
    const saved = await persistence.loadRecovery(copies[0].id);
    expect(saved?.bytes).toEqual(bytes);
    expect(saved?.metadata).toEqual(copies[0]);
    await assertLibrary(await open(persistence));
  });

  it('recusa migrar quando falta espaço para salvar a cópia de recuperação', async () => {
    const { persistence, bytes } = await populated();
    const save = vi.spyOn(persistence, 'save');
    persistence.failNextRecoverySave = true;
    await expect(open(persistence, successfulPlan)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(await persistence.load()).toEqual(bytes);
    expect(await persistence.listRecovery()).toEqual([]);
    await assertLibrary(await open(persistence));
  });

  it('relê a cópia durável e bloqueia a migração quando os bytes gravados estão corrompidos', async () => {
    const { bytes } = await populated();
    class CorruptReadback extends MemoryPersistence {
      override async loadRecovery(id: string) {
        const copy = await super.loadRecovery(id);
        if (copy) copy.bytes[copy.bytes.length - 1] ^= 1;
        return copy;
      }
    }
    const persistence = new CorruptReadback(bytes);
    const save = vi.spyOn(persistence, 'save');
    await expect(open(persistence, successfulPlan)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(await persistence.load()).toEqual(bytes);
  });

  it('mantém a cópia e os bytes originais se a publicação final falha', async () => {
    const { persistence, bytes } = await populated();
    persistence.failNextSave = true;
    await expect(open(persistence, successfulPlan)).rejects.toThrow();
    expect(await persistence.load()).toEqual(bytes);
    const copies = await persistence.listRecovery();
    expect(copies).toHaveLength(1);
    expect((await persistence.loadRecovery(copies[0].id))?.bytes).toEqual(bytes);
    await assertLibrary(await open(persistence));
  });

  it('serializa duas aberturas e cria uma só cópia antes da mesma atualização', async () => {
    const { persistence } = await populated();
    const saveCopy = vi.spyOn(persistence, 'saveRecovery');
    const clients = await Promise.all([open(persistence, successfulPlan), open(persistence, successfulPlan)]);
    expect(saveCopy).toHaveBeenCalledTimes(1);
    expect(await persistence.listRecovery()).toHaveLength(1);
    for (const client of clients) await assertLibrary(client);
    const SQL = await sql;
    const actual = new SQL.Database((await persistence.load())!);
    try { expect(actual.exec('PRAGMA user_version')[0].values[0][0]).toBe(7); }
    finally { actual.close(); }
  });

  it('exporta a cópia em pacote atual e restaura em destino vazio com materiais e hashes intactos', async () => {
    const { persistence, storage } = await populated();
    await expect(open(persistence, failedPlan)).rejects.toThrow();
    const [copy] = await storage.listRecoveryCopies();
    const archive = await readBackupArchive(await storage.exportRecoveryCopy(copy.id));
    const target = await open();
    await target.restoreBackupArchive(archive);
    await assertLibrary(target);
    const restored = await target.getDocument('parity-document');
    expect(hash(Buffer.from(restored.dataBase64, 'base64'))).toBe(fixture.data.documents![0].sha256);
    expect(hash(Buffer.from((await target.getAsset(fixture.materials!.assets[0].sha256)).dataBase64, 'base64'))).toBe(fixture.materials!.assets[0].sha256);
  });

  it('recusa exportar uma cópia adulterada sem alterar a biblioteca', async () => {
    const { persistence, storage, bytes } = await populated();
    await expect(open(persistence, failedPlan)).rejects.toThrow();
    const [copy] = await storage.listRecoveryCopies();
    const load = persistence.loadRecovery.bind(persistence);
    vi.spyOn(persistence, 'loadRecovery').mockImplementation(async id => {
      const result = await load(id);
      if (result) result.bytes[result.bytes.length - 1] ^= 1;
      return result;
    });
    await expect(storage.exportRecoveryCopy(copy.id)).rejects.toThrow();
    expect(await persistence.load()).toEqual(bytes);
    await assertLibrary(storage);
  });

  it('rejeita banco futuro sem sobrescrevê-lo nem criar cópia enganosa', async () => {
    const { bytes } = await populated();
    const SQL = await sql;
    const db = new SQL.Database(bytes);
    db.run('PRAGMA user_version = 99');
    const future = db.export();
    db.close();
    const persistence = new MemoryPersistence(future);
    await expect(open(persistence)).rejects.toThrow('versão mais nova');
    expect(await persistence.load()).toEqual(future);
    expect(await persistence.listRecovery()).toEqual([]);
  });

  it('retém até três cópias verificadas após migrações sucessivas', async () => {
    const { persistence } = await populated();
    const plan: { version: number; sql: string }[] = [];
    for (let version = 7; version <= 10; version++) {
      plan.push({ version, sql: `CREATE TABLE mission_three_${version} (id INTEGER); PRAGMA user_version = ${version};` });
      const client = await open(persistence, [...plan]);
      await client.close();
    }
    const copies = await persistence.listRecovery();
    expect(copies).toHaveLength(3);
    expect(copies.map(copy => copy.schemaVersion).sort()).toEqual([7, 8, 9]);
    for (const copy of copies) {
      const saved = await persistence.loadRecovery(copy.id);
      expect(hash(saved!.bytes)).toBe(copy.sha256);
    }
  });
});

describe('ponte real navegador → Rust → navegador', () => {
  it.skipIf(process.env.STUDYSPACE_PARITY_STAGE !== 'produce')('produz o checkpoint SQLite real após falha SQL para o processo nativo', async () => {
    const input = process.env.STUDYSPACE_PARITY_INPUT;
    if (!input) throw new Error('STUDYSPACE_PARITY_INPUT é obrigatório na fase produce.');
    const { persistence, storage } = await populated();
    const config = defaultConfig();
    config.bindings = [{ unitId: DEMO_CATALOG.units[0].id, subjectId: fixture.data.subjects[0].id, noteIds: [fixture.data.notes[0].id] }];
    let track = await storage.saveStudyTrack({ catalog: DEMO_CATALOG, config, diagnostics: [] });
    const attempt = startDiagnostic(track, new Date(fixture.exportedAt), 'parity-attempt');
    track = await storage.saveStudyTrack({ id: track.id, expectedRevision: track.revision, catalog: track.catalog, config: track.config, diagnostics: [attempt] });
    const answered = answerDiagnostic(track, attempt.id, attempt.questionIds[0], null, new Date(fixture.exportedAt));
    await storage.saveStudyTrack({ id: track.id, expectedRevision: track.revision, catalog: track.catalog, config: track.config, diagnostics: [answered] });
    const plannerConfig = defaultPlannerConfig(track);
    plannerConfig.days = [{weekday:6,startMinute:780,minutes:120}];
    const clock = {date:'2026-10-18',minute:720,iso:fixture.exportedAt};
    const preview = buildPreview(track,undefined,plannerConfig,'2026-10-12',clock);
    expect(preview.week.blocks.length).toBeGreaterThan(1);
    let planner = await storage.saveStudyPlanner(acceptPreview(track.id,undefined,plannerConfig,preview));
    planner = await storage.saveStudyPlanner(completeBlock(planner,planner.weeks[0].blocks[0].id,fixture.exportedAt));
    planner = await storage.saveStudyPlanner(toggleFixed(planner,planner.weeks[0].blocks[1].id));
    const next = buildPreview(track,planner,plannerConfig,'2026-10-19',clock);
    await storage.saveStudyPlanner(acceptPreview(track.id,planner,plannerConfig,next));
    const card = fixture.data.flashcards[0];
    await storage.recordReview({ flashcardId: card.id, sessionId: 'parity-spaced-first', rating: 1, schedule: true });
    const nextReviewTime = new Date(Date.parse(fixture.exportedAt) + 10 * 60_000).toISOString();
    const reviewClient = await open(persistence, undefined, () => nextReviewTime);
    const review = await reviewClient.recordReview({ flashcardId: card.id, sessionId: 'parity-spaced-second', rating: 3, schedule: true });
    await reviewClient.saveErrorEntry({
      subjectId: card.subjectId, originLabel: 'Resposta do flashcard', question: 'Minha observação após a revisão.', correction: '', nextAction: '', status: 'open',
      source: { kind: 'flashcard', flashcardId: card.id, reviewLogId: review.id },
    });
    const diagnosticEntry = await reviewClient.saveErrorEntry({
      subjectId: fixture.data.subjects[0].id, originLabel: 'Diagnóstico inicial', question: 'Preciso retomar a questão.', correction: '', nextAction: '', status: 'open',
      source: { kind: 'diagnostic', trackId: track.id, attemptId: attempt.id, questionId: attempt.questionIds[0] },
    });
    await reviewClient.saveErrorEntry({
      id: diagnosticEntry.id, expectedRevision: diagnosticEntry.revision, subjectId: diagnosticEntry.subjectId,
      originLabel: diagnosticEntry.originLabel, question: diagnosticEntry.question, correction: 'Registrei o procedimento correto.', nextAction: 'Revisar a unidade relacionada.', status: 'resolved', source: diagnosticEntry.source,
      practice: { id: 'parity-error-practice', description: 'Refiz o exemplo e conferi a correção.' },
    });
    const expected = { ...fixture, data: await storage.getSnapshot() };
    const bytes = (await persistence.load())!;
    await expect(open(persistence, failedPlan)).rejects.toThrow();
    const [metadata] = await persistence.listRecovery();
    const copy = await persistence.loadRecovery(metadata.id);
    expect(copy!.bytes).toEqual(bytes);
    expect(hash(copy!.bytes)).toBe(metadata.sha256);
    await mkdir(dirname(input), { recursive: true });
    await writeFile(input, copy!.bytes);
    await writeFile(`${input}.metadata.json`, JSON.stringify(metadata, null, 2));
    await writeFile(`${input}.expected.json`, JSON.stringify(expected, null, 2));
  });

  it.skipIf(process.env.STUDYSPACE_PARITY_STAGE !== 'consume')('restaura a saída realmente produzida pelo Rust e compara entidades, páginas, imagens e originais', async () => {
    const output = process.env.STUDYSPACE_PARITY_OUTPUT;
    if (!output) throw new Error('STUDYSPACE_PARITY_OUTPUT é obrigatório na fase consume.');
    const nativeExport = JSON.parse(await readFile(output, 'utf8'));
    const expected = JSON.parse(await readFile(`${process.env.STUDYSPACE_PARITY_INPUT}.expected.json`, 'utf8'));
    expect(nativeExport.manifest.version).toBe(7);
    expect(nativeExport.manifest.data).toEqual(expected.data);
    const persistence = new MemoryPersistence();
    const restored = await open(persistence);
    const archive = await readBackupArchive(await createBackupArchive(nativeExport.manifest, async index => new Uint8Array(Buffer.from(nativeExport.materials[index], 'base64'))));
    await restored.restoreBackupArchive(archive);
    expect(await restored.getSnapshot()).toEqual(expected.data);
    expect(await (await open(new MemoryPersistence(await persistence.load()))).getSnapshot()).toEqual(expected.data);
    for (const doc of fixture.data.documents!) expect((await restored.getDocument(doc.id)).dataBase64).toBe(fixture.materials!.documents.find(item => item.documentId === doc.id)!.dataBase64);
    for (const asset of fixture.materials!.assets) expect(await restored.getAsset(asset.sha256)).toEqual(asset);
  });
});
