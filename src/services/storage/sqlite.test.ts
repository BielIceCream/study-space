import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { EMPTY_DOCUMENT } from '../../shared/types';
import type { BackupDocument, RichDocument, StorageService } from '../../shared/types';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const stores: StorageService[] = [];
const TIME = '2026-10-13T12:00:00.000Z';

async function open(persistence = new MemoryPersistence(), now = () => TIME) {
  const storage = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now });
  stores.push(storage);
  return storage;
}

const document = (text: string): RichDocument => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

async function populate(storage: StorageService) {
  const subject = await storage.createSubject({ name: "Biologia'); DROP TABLE subjects;--", accent: 'green' });
  const initial = await storage.createNote({ subjectId: subject.id, title: 'Membrana celular' });
  const note = await storage.saveNote({ id: initial.id, expectedRevision: initial.revision, title: initial.title, bodyJson: document('A membrana é seletivamente permeável.'), plainText: 'A membrana é seletivamente permeável.' });
  const card = await storage.createFlashcard({ subjectId: subject.id, noteId: note.id, front: 'Qual a função da membrana?', back: 'Regular a passagem de substâncias.' });
  const review = await storage.recordReview({ flashcardId: card.id, sessionId: 'sessao-1', rating: 3 });
  await storage.setTheme('dark');
  return { subject, note, card, review };
}

afterEach(async () => { await Promise.all(stores.splice(0).map((store) => store.close())); });

describe('armazenamento SQLite real', () => {
  it('mantém a vertical completa ao fechar e reabrir os bytes do SQLite', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const values = await populate(storage);
    const original = await storage.getSnapshot();
    await storage.close();
    const durableBytes = await persistence.load();
    expect(durableBytes?.length).toBeGreaterThan(0);
    const reopened = await open(new MemoryPersistence(durableBytes));
    expect(await reopened.getSnapshot()).toEqual(original);
    expect(original.notes[0]).toEqual(values.note);
    expect(original.reviewLogs).toEqual([values.review]);
    expect(original.settings.theme).toBe('dark');
    // The name includes SQL syntax; parameterized writes preserve it as plain text.
    expect(original.subjects[0].name).toContain('DROP TABLE');
  });

  it('aplica migração em banco populado sem substituir notas nem preferências', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    await populate(storage);
    const before = await storage.getSnapshot();
    await storage.close();
    const SQL = await sql;
    const previous = new SQL.Database((await persistence.load())!);
    previous.run('PRAGMA user_version = 0');
    await persistence.save(previous.export());
    previous.close();
    const migrated = await open(persistence);
    expect(await migrated.getSnapshot()).toEqual(before);
    const inspected = new SQL.Database((await persistence.load())!);
    expect(inspected.exec('PRAGMA user_version')[0].values[0][0]).toBe(6);
    inspected.close();
  });

  it('rejeita versão futura sem modificar os bytes', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    await populate(storage);
    await storage.close();
    const SQL = await sql;
    const future = new SQL.Database((await persistence.load())!);
    future.run('PRAGMA user_version = 7');
    await persistence.save(future.export());
    future.close();
    const before = await persistence.load();
    await expect(open(persistence)).rejects.toThrow('versão mais nova');
    expect(await persistence.load()).toEqual(before);
  });

  it('aplica chaves estrangeiras e impede vincular cartão a nota de outra matéria', async () => {
    const storage = await open();
    const first = await storage.createSubject({ name: 'Biologia', accent: 'green' });
    const second = await storage.createSubject({ name: 'Química', accent: 'peach' });
    const note = await storage.createNote({ subjectId: first.id, title: 'Membranas' });
    await expect(storage.createNote({ subjectId: 'materia-inexistente', title: 'Nota' })).rejects.toThrow('não existe');
    await expect(storage.createFlashcard({ subjectId: second.id, noteId: note.id, front: 'Frente', back: 'Verso' })).rejects.toThrow('outra matéria');
    await expect(storage.recordReview({ flashcardId: 'cartao-inexistente', sessionId: 's1', rating: 3 })).rejects.toThrow('não existe');
    expect((await storage.getSnapshot()).flashcards).toHaveLength(0);
  });

  it('faz o SQLite impor datas, JSON, revisão e o vínculo composto', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const { subject, note } = await populate(storage);
    const SQL = await sql;
    const db = new SQL.Database((await persistence.load())!);
    db.run('PRAGMA foreign_keys = ON');
    expect(() => db.run('UPDATE subjects SET created_at = ? WHERE id = ?', ['2026-02-30T12:00:00.000Z', subject.id])).toThrow();
    expect(() => db.run('UPDATE notes SET revision = ? WHERE id = ?', [0, note.id])).toThrow();
    expect(() => db.run('UPDATE notes SET body_json = ? WHERE id = ?', ['{"type":"paragraph"}', note.id])).toThrow();
    expect(() => db.run('UPDATE flashcards SET subject_id = ?', ['ausente'])).toThrow();
    db.close();
    expect((await storage.getSnapshot()).notes[0].revision).toBe(2);
  });

  it('protege autossalvamento antigo mesmo entre duas conexões concorrentes', async () => {
    const persistence = new MemoryPersistence();
    const left = await open(persistence);
    const right = await open(persistence);
    const subject = await left.createSubject({ name: 'Física', accent: 'blue' });
    const note = await left.createNote({ subjectId: subject.id, title: 'Energia' });
    const input = { id: note.id, expectedRevision: 1, title: note.title, bodyJson: document('Versão mais recente'), plainText: 'Versão mais recente' };
    const results = await Promise.allSettled([
      left.saveNote(input),
      right.saveNote({ ...input, bodyJson: document('Versão antiga'), plainText: 'Versão antiga' }),
    ]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    if (results[1].status === 'rejected') expect(String(results[1].reason)).toContain('outra janela');
    expect((await right.getSnapshot()).notes[0]).toMatchObject({ revision: 2, plainText: 'Versão mais recente' });
  });

  it('serializa clientes independentes sem perder gravações concorrentes', async () => {
    const persistence = new MemoryPersistence();
    const first = await open(persistence);
    const second = await open(persistence);
    await Promise.all([
      first.createSubject({ name: 'Matéria A', accent: 'blue' }),
      second.createSubject({ name: 'Matéria B', accent: 'green' }),
    ]);
    expect((await first.getSnapshot()).subjects.map((subject) => subject.name).sort()).toEqual(['Matéria A', 'Matéria B']);
    expect((await second.getSnapshot()).subjects).toHaveLength(2);
  });

  it('torna o clique duplo de revisão idempotente e conserva a primeira resposta', async () => {
    const persistence = new MemoryPersistence();
    const first = await open(persistence);
    const second = await open(persistence);
    const { card } = await populate(first);
    const [one, two] = await Promise.all([
      first.recordReview({ flashcardId: card.id, sessionId: 'sessao-2', rating: 4 }),
      second.recordReview({ flashcardId: card.id, sessionId: 'sessao-2', rating: 1 }),
    ]);
    expect(two).toEqual(one);
    expect(one.rating).toBe(4);
    expect((await first.getSnapshot()).reviewLogs.filter((review) => review.sessionId === 'sessao-2')).toEqual([one]);
  });

  it('não publica nota nem revisão quando a persistência falha e permite nova tentativa', async () => {
    const persistence = new MemoryPersistence();
    const storage = await open(persistence);
    const { note, card } = await populate(storage);
    const before = await persistence.load();
    persistence.failNextSave = true;
    await expect(storage.saveNote({ id: note.id, expectedRevision: note.revision, title: note.title, bodyJson: document('Não gravado'), plainText: 'Não gravado' })).rejects.toThrow('gravar');
    expect(await persistence.load()).toEqual(before);
    expect((await storage.getSnapshot()).notes[0]).toEqual(note);
    persistence.failNextSave = true;
    await expect(storage.recordReview({ flashcardId: card.id, sessionId: 'tentativa', rating: 2 })).rejects.toThrow('gravar');
    expect((await storage.getSnapshot()).reviewLogs).toHaveLength(1);
    const retry = await storage.recordReview({ flashcardId: card.id, sessionId: 'tentativa', rating: 2 });
    expect((await storage.getSnapshot()).reviewLogs.filter((review) => review.sessionId === 'tentativa')).toEqual([retry]);
    const reopened = await open(new MemoryPersistence(await persistence.load()));
    expect((await reopened.getSnapshot()).notes[0]).toEqual(note);
    expect((await reopened.getSnapshot()).reviewLogs).toHaveLength(2);
  });

  it('preserva ordem das datas quando o relógio local recua', async () => {
    let time = TIME;
    const storage = await open(new MemoryPersistence(), () => time);
    const subject = await storage.createSubject({ name: 'História', accent: 'rose' });
    time = '2026-10-12T12:00:00.000Z';
    const updated = await storage.updateSubject(subject.id, { name: 'História geral', accent: 'rose' });
    expect(updated.updatedAt).toBe(subject.createdAt);
    expect((await storage.getSnapshot()).subjects[0]).toEqual(updated);
  });

  it('exporta/restaura vínculos e tema com falha atômica e recusa biblioteca populada', async () => {
    const source = await open();
    await populate(source);
    const backup = await source.exportBackup();
    const persistence = new MemoryPersistence();
    const target = await open(persistence);
    persistence.failNextSave = true;
    await expect(target.restoreBackup(backup)).rejects.toThrow('gravar');
    expect(await target.getSnapshot()).toEqual({ subjects: [], notes: [], flashcards: [], reviewLogs: [], settings: { theme: 'light' }, documents: [], cardMetadata: [] });
    await target.restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(await target.getSnapshot()).toEqual(backup.data);
    const durable = await open(new MemoryPersistence(await persistence.load()));
    expect(await durable.getSnapshot()).toEqual(backup.data);
    await expect(target.restoreBackup(backup)).rejects.toThrow('biblioteca vazia');
    expect(await target.getSnapshot()).toEqual(backup.data);
  });

  it('rejeita backups malformados sem gravações parciais', async () => {
    const source = await open();
    await populate(source);
    const original = await source.exportBackup();
    const target = await open();
    const corruptions: ((backup: BackupDocument) => unknown)[] = [
      (backup) => ({ ...backup, version: 99 }),
      (backup) => ({ ...backup, unknownField: true }),
      (backup) => ({ ...backup, exportedAt: '2026-02-30T12:00:00.000Z' }),
      (backup) => { backup.data.notes[0].subjectId = 'ausente'; return backup; },
      (backup) => { backup.data.notes[0].revision = 0; return backup; },
      (backup) => { backup.data.notes[0].bodyJson = { type: 'paragraph' }; return backup; },
      (backup) => { backup.data.flashcards[0].noteId = 'ausente'; return backup; },
      (backup) => { backup.data.reviewLogs.push({ ...backup.data.reviewLogs[0], id: 'duplicate' }); return backup; },
      (backup) => { backup.data.subjects[0].updatedAt = '2025-01-01T00:00:00.000Z'; return backup; },
      (backup) => { backup.data.settings = { theme: 'blue' as never }; return backup; },
    ];
    for (const corrupt of corruptions) {
      await expect(target.restoreBackup(corrupt(structuredClone(original)))).rejects.toThrow();
      expect((await target.getSnapshot()).subjects).toHaveLength(0);
    }
  });

  it('rejeita JSON circular e impede operações depois de fechar', async () => {
    const storage = await open();
    const subject = await storage.createSubject({ name: 'Matemática', accent: 'lavender' });
    const note = await storage.createNote({ subjectId: subject.id, title: 'Limites' });
    const circular: RichDocument = { type: 'doc', content: [] };
    circular.content!.push(circular);
    await expect(storage.saveNote({ id: note.id, expectedRevision: 1, title: note.title, bodyJson: circular, plainText: '' })).rejects.toThrow('circulares');
    expect((await storage.getSnapshot()).notes[0].bodyJson).toEqual(EMPTY_DOCUMENT);
    await storage.close();
    await expect(storage.getSnapshot()).rejects.toThrow('fechado');
  });

  it('rejeita NUL e JSON profundo sem alterar a nota existente', async () => {
    const storage = await open();
    const subject = await storage.createSubject({ name: 'Português', accent: 'lavender' });
    const note = await storage.createNote({ subjectId: subject.id, title: 'Gramática' });
    await expect(storage.updateSubject(subject.id, { name: 'Nome\0oculto', accent: 'blue' })).rejects.toThrow('caractere inválido');
    const input = { id: note.id, expectedRevision: 1, title: note.title, bodyJson: document('Texto\0inválido'), plainText: '' };
    await expect(storage.saveNote(input)).rejects.toThrow('caractere inválido');
    const deep: RichDocument = { type: 'doc', content: [] };
    let cursor = deep;
    for (let index = 0; index < 70; index += 1) {
      const child: RichDocument = { type: 'paragraph', content: [] };
      cursor.content!.push(child); cursor = child;
    }
    await expect(storage.saveNote({ ...input, bodyJson: deep })).rejects.toThrow('complexidade');
    expect((await storage.getSnapshot()).notes[0]).toEqual(note);
  });
});
