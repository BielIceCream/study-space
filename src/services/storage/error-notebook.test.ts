import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ErrorEntry, SaveErrorEntryInput } from '../../domain/error-notebook/types';
import { DEMO_CATALOG, defaultConfig } from '../../domain/study/demo';
import { answerDiagnostic, startDiagnostic } from '../../domain/study/engine';
import type { StorageService } from '../../shared/types';
import { createBackupArchive, readBackupArchive } from '../backup-archive';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';
import { validateSnapshot } from './validation';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const TIME = '2026-10-22T12:00:00.000Z';
const stores: StorageService[] = [];

async function open(persistence = new MemoryPersistence(), now = () => TIME) {
  const storage = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now });
  stores.push(storage);
  return storage;
}

function input(subjectId: string): SaveErrorEntryInput {
  return { subjectId, originLabel: 'Exercício pessoal', question: 'Onde errei o cálculo?', correction: '', nextAction: '', status: 'open', source: { kind: 'manual' } };
}
function edit(entry: ErrorEntry): SaveErrorEntryInput {
  return { id: entry.id, expectedRevision: entry.revision, subjectId: entry.subjectId, originLabel: entry.originLabel, question: entry.question, correction: entry.correction, nextAction: entry.nextAction, status: entry.status, source: entry.source };
}
async function seed(storage: StorageService) {
  const subject = await storage.createSubject({ name: 'Matemática', accent: 'blue' });
  const note = await storage.createNote({ subjectId: subject.id, title: 'Operações' });
  const card = await storage.createFlashcard({ subjectId: subject.id, noteId: note.id, front: 'Quanto vale 8 + 3 × 4?', back: '20' });
  return { subject, note, card };
}
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); });

describe('caderno de erros no SQLite real', () => {
  it('permite registrar e editar sem declarar domínio nem alterar a agenda do cartão', async () => {
    let time = TIME;
    const storage = await open(new MemoryPersistence(), () => time);
    const { subject, card } = await seed(storage);
    await storage.recordReview({ flashcardId: card.id, sessionId: 'srs', rating: 1, schedule: true });
    const before = await storage.getSnapshot();
    let entry = await storage.saveErrorEntry(input(subject.id));
    expect(entry).toMatchObject({ revision: 1, createdAt: TIME, updatedAt: TIME, resolvedAt: null, practices: [] });
    await expect(storage.saveErrorEntry({ ...edit(entry), status: 'resolved' })).rejects.toThrow();
    await expect(storage.saveErrorEntry({ ...edit(entry), status: 'resolved', correction: 'A multiplicação vem antes.' })).rejects.toThrow();
    time = '2026-10-22T13:00:00.000Z';
    entry = await storage.saveErrorEntry({ ...edit(entry), status: 'resolved', question: 'Respeitar a precedência das operações.', correction: 'Primeiro 3 × 4; depois somar 8.', nextAction: 'Refazer dois exemplos.' });
    expect(entry).toMatchObject({ revision: 2, status: 'resolved', resolvedAt: time });
    time = '2026-10-22T14:00:00.000Z';
    entry = await storage.saveErrorEntry({ ...edit(entry), status: 'open' });
    expect(entry).toMatchObject({ revision: 3, status: 'open', resolvedAt: null });
    expect((await storage.getSnapshot()).reviewSchedules).toEqual(before.reviewSchedules);
    expect((await storage.getSnapshot()).reviewLogs).toEqual(before.reviewLogs);
  });

  it('captura o cartão e a resposta uma vez, preservando o texto ao editar a fonte', async () => {
    const storage = await open();
    const { subject, card } = await seed(storage);
    const review = await storage.recordReview({ flashcardId: card.id, sessionId: 'origem', rating: 1 });
    const entry = await storage.saveErrorEntry({ ...input(subject.id), source: { kind: 'flashcard', flashcardId: card.id, reviewLogId: review.id } });
    expect(entry.sourceSnapshot).toMatchObject({ prompt: card.front, answer: card.back });
    await storage.updateFlashcard({ id: card.id, front: 'Frente revisada', back: 'Verso revisado' });
    const updated = await storage.saveErrorEntry({ ...edit(entry), correction: 'Anotei a precedência.' });
    expect(updated.sourceSnapshot).toEqual(entry.sourceSnapshot);
    expect(validateSnapshot(await storage.getSnapshot()).errorEntries).toEqual([updated]);
    await expect(storage.saveErrorEntry({ ...edit(updated), source: { kind: 'manual' } })).rejects.toThrow();
    const other = await storage.createSubject({ name: 'Outra matéria', accent: 'green' });
    await expect(storage.saveErrorEntry({ ...edit(updated), subjectId: other.id })).rejects.toThrow();
  });

  it('captura somente um trecho da nota e mantém o trecho anterior após autossalvar', async () => {
    const storage = await open();
    const { subject, note } = await seed(storage);
    const text = 'A'.repeat(999) + '😀' + 'B'.repeat(100);
    const savedNote = await storage.saveNote({ id: note.id, expectedRevision: note.revision, title: note.title, plainText: text, bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });
    const entry = await storage.saveErrorEntry({ ...input(subject.id), source: { kind: 'note', noteId: note.id } });
    expect(entry.sourceSnapshot).toEqual({ title: note.title, prompt: 'A'.repeat(999), answer: '' });
    await storage.saveNote({ id: note.id, expectedRevision: savedNote.revision, title: 'Título novo', plainText: 'Conteúdo novo', bodyJson: { type: 'doc', content: [] } });
    const edited = await storage.saveErrorEntry({ ...edit(entry), question: 'Meu resumo do problema.' });
    expect(edited.sourceSnapshot).toEqual(entry.sourceSnapshot);
  });

  it('exige uma tentativa respondida e permite classificar o diagnóstico em matéria escolhida', async () => {
    const storage = await open();
    const { subject } = await seed(storage);
    const config = defaultConfig();
    config.bindings = [{ unitId: DEMO_CATALOG.units[0].id, subjectId: subject.id, noteIds: [] }];
    let track = await storage.saveStudyTrack({ catalog: DEMO_CATALOG, config, diagnostics: [] });
    const attempt = startDiagnostic(track, new Date(TIME), 'erro-diagnostico');
    track = await storage.saveStudyTrack({ id: track.id, expectedRevision: track.revision, catalog: track.catalog, config: track.config, diagnostics: [attempt] });
    const question = track.catalog.questions.find(item => item.id === attempt.questionIds[0])!;
    const source = { kind: 'diagnostic' as const, trackId: track.id, attemptId: attempt.id, questionId: question.id };
    await expect(storage.saveErrorEntry({ ...input(subject.id), source })).rejects.toThrow();
    const answered = answerDiagnostic(track, attempt.id, question.id, (question.correctIndex + 1) % question.choices.length, new Date(TIME));
    await storage.saveStudyTrack({ id: track.id, expectedRevision: track.revision, catalog: track.catalog, config: track.config, diagnostics: [answered] });
    const entry = await storage.saveErrorEntry({ ...input(subject.id), source });
    expect(entry.sourceSnapshot.prompt).toContain(question.prompt);
    expect(entry.sourceSnapshot.answer).toContain(question.explanation);
    const other = await storage.createSubject({ name: 'Física', accent: 'peach' });
    expect((await storage.saveErrorEntry({ ...input(other.id), source })).subjectId).toBe(other.id);
    await expect(storage.saveErrorEntry({ ...input('materia-ausente'), source })).rejects.toThrow();
    await expect(storage.saveErrorEntry({ ...input(subject.id), source: { ...source, questionId: 'ausente' } })).rejects.toThrow();
  });

  it('recusa cartão, avaliação e nota de outra matéria ou com referência ausente', async () => {
    const storage = await open();
    const { subject, card, note } = await seed(storage);
    const other = await storage.createSubject({ name: 'Física', accent: 'peach' });
    const otherCard = await storage.createFlashcard({ subjectId: other.id, noteId: null, front: 'Energia?', back: 'Joule' });
    const review = await storage.recordReview({ flashcardId: otherCard.id, sessionId: 'outra', rating: 1 });
    for (const candidate of [
      { ...input(other.id), source: { kind: 'flashcard' as const, flashcardId: card.id, reviewLogId: null } },
      { ...input(other.id), source: { kind: 'note' as const, noteId: note.id } },
      { ...input(subject.id), source: { kind: 'flashcard' as const, flashcardId: card.id, reviewLogId: review.id } },
      { ...input(subject.id), source: { kind: 'flashcard' as const, flashcardId: card.id, reviewLogId: 'ausente' } },
      { ...input(subject.id), source: { kind: 'note' as const, noteId: 'ausente' } },
    ]) await expect(storage.saveErrorEntry(candidate)).rejects.toThrow();
    expect((await storage.getSnapshot()).errorEntries).toBeUndefined();
  });

  it('protege revisões concorrentes entre conexões e a publicação durável que falha', async () => {
    const persistence = new MemoryPersistence();
    const first = await open(persistence);
    const second = await open(persistence);
    const { subject } = await seed(first);
    const entry = await first.saveErrorEntry(input(subject.id));
    const updated = await first.saveErrorEntry({ ...edit(entry), correction: 'Correção persistida' });
    await expect(second.saveErrorEntry({ ...edit(entry), correction: 'Versão antiga' })).rejects.toThrow('outra janela');
    const before = await persistence.load();
    persistence.failNextSave = true;
    await expect(first.saveErrorEntry({ ...edit(updated), practice: { id: 'nao-publicada', description: 'Refiz o exemplo.' } })).rejects.toThrow();
    expect(await persistence.load()).toEqual(before);
    expect((await second.getSnapshot()).errorEntries).toEqual([updated]);
  });

  it('torna a tentativa de prática idempotente mesmo com revisão antiga após reiniciar', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const { subject } = await seed(storage);
    const entry = await storage.saveErrorEntry(input(subject.id));
    const request = { ...edit(entry), practice: { id: 'pratica-unica', description: 'Refiz o exercício sem consultar.' } };
    const practiced = await storage.saveErrorEntry(request);
    expect(practiced.practices).toEqual([{ ...request.practice, createdAt: TIME }]);
    const edited = await storage.saveErrorEntry({ ...edit(practiced), correction: 'Corrigido depois da prática.' });
    const reopened = await open(new MemoryPersistence(await persistence.load()));
    expect(await reopened.saveErrorEntry(request)).toEqual(edited);
    await expect(reopened.saveErrorEntry({ ...edit(edited), practice: { ...request.practice, description: 'Texto diferente com o mesmo id.' } })).rejects.toThrow();
    expect((await reopened.getSnapshot()).errorEntries).toEqual([edited]);
  });

  it('recusa campos desconhecidos, NUL, estados de resolução e histórico adulterados', async () => {
    const storage = await open();
    const { subject } = await seed(storage);
    const original = await storage.saveErrorEntry(input(subject.id));
    for (const malformed of [
      { ...input(subject.id), question: 'NUL\0oculto' },
      { ...input(subject.id), unexpected: true },
      { ...input(subject.id), sourceSnapshot: { title: 'Injetado', prompt: '', answer: '' } },
      { ...edit(original), practices: [{ id: 'injetado', description: 'Falsa prática', createdAt: TIME }] },
      { ...edit(original), resolvedAt: TIME },
      { ...edit(original), practice: { id: 'NUL\0', description: 'texto' } },
    ]) await expect(storage.saveErrorEntry(malformed as SaveErrorEntryInput)).rejects.toThrow();
    const snapshot = await storage.getSnapshot();
    for (const entry of [
      { ...original, status: 'resolved', resolvedAt: TIME },
      { ...original, revision: 0 },
      { ...original, source: { kind: 'note', noteId: 'ausente' } },
      { ...original, practices: Array.from({ length: 201 }, (_, i) => ({ id: `p-${i}`, description: 'Excesso', createdAt: TIME })) },
    ]) expect(() => validateSnapshot({ ...snapshot, errorEntries: [entry] })).toThrow();
    expect(() => validateSnapshot({ ...snapshot, errorEntries: Array.from({ length: 5001 }, (_, i) => ({ ...original, id: `entry-${i}` })) })).toThrow();
    expect((await storage.getSnapshot()).errorEntries).toEqual([original]);
  });

  it('reabre e restaura o portátil v7 sem aceitar os mesmos registros em formatos antigos', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const { subject, card } = await seed(storage);
    let entry = await storage.saveErrorEntry({ ...input(subject.id), source: { kind: 'flashcard', flashcardId: card.id, reviewLogId: null } });
    entry = await storage.saveErrorEntry({ ...edit(entry), status: 'resolved', correction: 'Multiplicação primeiro.', nextAction: 'Revisar operações.', practice: { id: 'portatil', description: 'Refiz o cálculo.' } });
    const expected = await storage.getSnapshot();
    expect(await (await open(new MemoryPersistence(await persistence.load()))).getSnapshot()).toEqual(expected);
    const archive = await readBackupArchive(await storage.exportBackupArchive());
    expect(archive.manifest.version).toBe(7);
    const target = await open();
    await target.restoreBackupArchive(archive);
    expect(await target.getSnapshot()).toEqual(expected);
    await expect(storage.exportBackup()).rejects.toThrow();
    for (const version of [3, 4, 5, 6] as const) await expect(createBackupArchive({ ...archive.manifest, version }, archive.readMaterial)).rejects.toThrow();
  });

  it('migra v5 com cópia exata, preserva dados se a publicação falha e não inventa erros antigos', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    await seed(storage);
    const expected = await storage.getSnapshot();
    const SQL = await sql;
    const database = new SQL.Database((await persistence.load())!);
    database.run('DROP TABLE error_entries; PRAGMA user_version=5');
    const oldBytes = database.export();
    database.close();
    await persistence.save(oldBytes);
    persistence.failNextSave = true;
    await expect(open(persistence)).rejects.toThrow();
    expect(await persistence.load()).toEqual(oldBytes);
    const [copy] = await persistence.listRecovery();
    expect(copy).toMatchObject({ schemaVersion: 5, targetSchemaVersion: 6 });
    expect((await persistence.loadRecovery(copy.id))!.bytes).toEqual(oldBytes);
    const migrated = await open(persistence);
    expect(await migrated.getSnapshot()).toEqual(expected);
    expect((await migrated.getSnapshot()).errorEntries).toBeUndefined();
    expect(await persistence.listRecovery()).toHaveLength(1);
  });
});
