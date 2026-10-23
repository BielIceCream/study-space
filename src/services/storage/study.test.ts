import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_CATALOG, defaultConfig } from '../../domain/study/demo';
import { startDiagnostic, answerDiagnostic } from '../../domain/study/engine';
import type { StudyTrack } from '../../domain/study/types';
import type { StorageService } from '../../shared/types';
import { createBackupArchive, readBackupArchive } from '../backup-archive';
import { readBackupFile } from '../backup-files';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const time = '2026-10-19T12:00:00.000Z';
const stores: StorageService[] = [];
async function open(persistence = new MemoryPersistence()) {
  const store = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now: () => time });
  stores.push(store); return store;
}
const input = () => ({ catalog: structuredClone(DEMO_CATALOG), config: defaultConfig(), diagnostics: [] });
const update = (track: StudyTrack) => ({ id: track.id, expectedRevision: track.revision, catalog: track.catalog, config: track.config, diagnostics: track.diagnostics });
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); });

describe('trilhas e diagnóstico persistidos', () => {
  it('mantém configuração, respostas e vínculos ao reabrir e restaurar o arquivo v4', async () => {
    const persistence = new MemoryPersistence(); const store = await open(persistence);
    const subject = await store.createSubject({ name: 'Minha matemática', accent: 'blue' });
    const note = await store.createNote({ subjectId: subject.id, title: 'Frações' });
    const data = input(); data.config.bindings = [{ unitId: data.catalog.units[0].id, subjectId: subject.id, noteIds: [note.id] }];
    let track = await store.saveStudyTrack(data);
    const attempt = startDiagnostic(track, new Date(time), 'attempt-1');
    track = await store.saveStudyTrack({ ...update(track), diagnostics: [attempt] });
    const answered = answerDiagnostic(track, attempt.id, attempt.questionIds[0], null, new Date(time));
    track = await store.saveStudyTrack({ ...update(track), diagnostics: [answered] });
    const expected = await store.getSnapshot();
    expect(await (await open(new MemoryPersistence(await persistence.load()))).getSnapshot()).toEqual(expected);
    await expect(store.exportBackup()).rejects.toThrow('.studyspace');
    const blob = await store.exportBackupArchive();
    const archive = await readBackupFile(new File([blob], 'sem-extensao')) as Awaited<ReturnType<typeof readBackupArchive>>;
    expect(archive.manifest.version).toBe(4);
    const restored = await open(); await restored.restoreBackupArchive(archive);
    expect(await restored.getSnapshot()).toEqual(expected);
    expect((await restored.getSnapshot()).notes).toHaveLength(1);
    const downgrade = { ...archive.manifest, version: 3 as const };
    await expect(createBackupArchive(downgrade, archive.readMaterial)).rejects.toThrow('v4');
    const bytes = new Uint8Array(await blob.arrayBuffer()); bytes[18] = 51;
    await expect(readBackupArchive(new Blob([bytes]))).rejects.toThrow('versão');
  });

  it('protege edição concorrente, resposta já salva e publicação que falha', async () => {
    const persistence = new MemoryPersistence(); const a = await open(persistence); const b = await open(persistence);
    let track = await a.saveStudyTrack(input());
    const stale = update(track);
    track = await a.saveStudyTrack({ ...update(track), config: { ...track.config, name: 'Plano editado' } });
    await expect(b.saveStudyTrack(stale)).rejects.toThrow('outra janela');
    persistence.failNextSave = true;
    await expect(a.saveStudyTrack({ ...update(track), config: { ...track.config, name: 'Não publicar' } })).rejects.toThrow();
    expect((await a.getSnapshot()).studyTracks).toEqual([track]);
    const attempt = startDiagnostic(track, new Date(time), 'attempt');
    track = await a.saveStudyTrack({ ...update(track), diagnostics: [attempt] });
    track = await a.saveStudyTrack({ ...update(track), diagnostics: [answerDiagnostic(track, attempt.id, attempt.questionIds[0], 0, new Date(time))] });
    const tampered = structuredClone(track.diagnostics); tampered[0].answers[0].choiceIndex = 1;
    await expect(a.saveStudyTrack({ ...update(track), diagnostics: tampered })).rejects.toThrow();
    expect((await a.getSnapshot()).studyTracks).toEqual([track]);
  });

  it('recusa catálogo cíclico, vínculo ausente e restauração sobre biblioteca apenas com trilha', async () => {
    const store = await open(); const invalid = input();
    invalid.catalog.units[0].prerequisites.push(invalid.catalog.units[0].id);
    await expect(store.saveStudyTrack(invalid)).rejects.toThrow();
    const missing = input(); missing.config.bindings = [{ unitId: missing.catalog.units[0].id, subjectId: 'ausente', noteIds: [] }];
    await expect(store.saveStudyTrack(missing)).rejects.toThrow();
    expect((await store.getSnapshot()).studyTracks).toBeUndefined();
    const empty = await open(); const backup = await readBackupArchive(await empty.exportBackupArchive());
    await store.saveStudyTrack(input());
    await expect(store.restoreBackupArchive(backup)).rejects.toThrow('biblioteca vazia');
  });

  it('migra schema 2 com cópia exata e preserva dados se a publicação do schema atual falha', async () => {
    const persistence = new MemoryPersistence(); const store = await open(persistence);
    await store.createSubject({ name: 'Biblioteca anterior', accent: 'green' });
    const expected = await store.getSnapshot();
    const SQL = await sql; const db = new SQL.Database((await persistence.load())!);
    db.run('DROP TABLE error_entries; DROP TABLE review_schedules; DROP TABLE study_planners; DROP TABLE study_tracks; PRAGMA user_version=2');
    const before = db.export(); db.close(); await persistence.save(before);
    persistence.failNextSave = true;
    await expect(open(persistence)).rejects.toThrow();
    expect(await persistence.load()).toEqual(before);
    const copies = await persistence.listRecovery(); expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ schemaVersion: 2, targetSchemaVersion: 6 });
    expect((await persistence.loadRecovery(copies[0].id))?.bytes).toEqual(before);
    const upgraded = await open(persistence); expect(await upgraded.getSnapshot()).toEqual(expected);
    expect(await persistence.listRecovery()).toHaveLength(1);
  });
});
