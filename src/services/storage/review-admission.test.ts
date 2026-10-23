import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReviewAdmission, StorageService } from '../../shared/types';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const TIME = '2026-10-21T12:00:00.000Z';
const admission: ReviewAdmission = { newCardLimit: 1, dayStart: '2026-10-21T03:00:00.000Z', dayEnd: '2026-10-22T03:00:00.000Z' };
const stores: StorageService[] = [];

async function open(persistence = new MemoryPersistence(), now = () => TIME) {
  const storage = await createSQLiteStorage({ persistence, initializeSqlite: () => sql, now });
  stores.push(storage);
  return storage;
}

async function seed(storage: StorageService, name = 'Biologia') {
  const subject = await storage.createSubject({ name, accent: 'green' });
  return storage.createFlashcard({ subjectId: subject.id, noteId: null, front: `Pergunta de ${name}`, back: 'Resposta' });
}

afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); });

describe('admissão diária transacional de novos cartões', () => {
  it('reconfere a cota entre duas janelas concorrentes sem publicar log para o cartão recusado', async () => {
    const persistence = new MemoryPersistence();
    const first = await open(persistence);
    const second = await open(persistence);
    const a = await seed(first);
    const b = await seed(first, 'Matemática');
    const results = await Promise.allSettled([
      first.recordReview({ flashcardId: a.id, sessionId: 'window-a', rating: 3, schedule: true, admission }),
      second.recordReview({ flashcardId: b.id, sessionId: 'window-b', rating: 3, schedule: true, admission }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    const snapshot = await second.getSnapshot();
    expect(snapshot.reviewLogs).toHaveLength(1);
    expect(snapshot.reviewSchedules).toHaveLength(1);
    const winner = results.find(result => result.status === 'fulfilled');
    if (winner?.status !== 'fulfilled') throw new Error('Uma avaliação precisa ter sido gravada.');
    expect(snapshot.reviewLogs).toEqual([winner.value]);
    expect(snapshot.reviewSchedules![0].lastReviewId).toBe(winner.value.id);
    expect(await (await open(new MemoryPersistence(await persistence.load()))).getSnapshot()).toEqual(snapshot);
  });

  it('mantém a cota global ao mudar de matéria e ignora respostas de prática livre', async () => {
    const storage = await open();
    const biology = await seed(storage);
    const mathematics = await seed(storage, 'Matemática');
    const free = await storage.recordReview({ flashcardId: mathematics.id, sessionId: 'free', rating: 4 });
    await storage.recordReview({ flashcardId: biology.id, sessionId: 'biology', rating: 3, schedule: true, admission });
    const before = await storage.getSnapshot();
    await expect(storage.recordReview({ flashcardId: mathematics.id, sessionId: 'mathematics', rating: 3, schedule: true, admission })).rejects.toThrow('limite de novos');
    const after = await storage.getSnapshot();
    expect(after).toEqual(before);
    expect(after.reviewLogs).toContainEqual(free);
    expect(after.reviewSchedules).toHaveLength(1);
    expect(after.reviewSchedules![0].flashcardId).toBe(biology.id);
  });

  it('cota zero impede admissão nova, mas permite avaliar cartão já devido sem readmiti-lo', async () => {
    let time = TIME;
    const storage = await open(new MemoryPersistence(), () => time);
    const entered = await seed(storage);
    const fresh = await seed(storage, 'História');
    const first = await storage.recordReview({ flashcardId: entered.id, sessionId: 'first', rating: 1, schedule: true, admission });
    time = '2026-10-21T12:10:00.000Z';
    const zero = { ...admission, newCardLimit: 0 };
    await storage.recordReview({ flashcardId: entered.id, sessionId: 'due', rating: 3, schedule: true, admission: zero });
    const before = await storage.getSnapshot();
    expect(before.reviewSchedules![0]).toMatchObject({ repetitions: 2, firstReviewId: first.id, introducedAt: TIME });
    await expect(storage.recordReview({ flashcardId: fresh.id, sessionId: 'fresh', rating: 3, schedule: true, admission: zero })).rejects.toThrow('limite de novos');
    expect(await storage.getSnapshot()).toEqual(before);
  });

  it('repetir uma sessão antiga conserva a primeira resposta antes de reconferir dia e cota', async () => {
    let time = TIME;
    const storage = await open(new MemoryPersistence(), () => time);
    const card = await seed(storage);
    const input = { flashcardId: card.id, sessionId: 'original', rating: 3 as const, schedule: true, admission };
    const first = await storage.recordReview(input);
    time = '2026-10-22T12:00:00.000Z';
    const nextDay = { newCardLimit: 0, dayStart: '2026-10-22T03:00:00.000Z', dayEnd: '2026-10-23T03:00:00.000Z' };
    await storage.recordReview({ ...input, sessionId: 'next-day', rating: 3, admission: nextDay });
    const before = await storage.getSnapshot();
    expect(await storage.recordReview({ ...input, rating: 1, admission: { ...admission, newCardLimit: 0 } })).toEqual(first);
    expect(await storage.getSnapshot()).toEqual(before);
  });

  it('falha no save durável não consome cota e a próxima janela consegue admitir uma única vez', async () => {
    const persistence = new MemoryPersistence();
    const first = await open(persistence);
    const second = await open(persistence);
    const a = await seed(first);
    const b = await seed(first, 'Geografia');
    const before = await first.getSnapshot();
    const bytes = await persistence.load();
    persistence.failNextSave = true;
    await expect(first.recordReview({ flashcardId: a.id, sessionId: 'failed', rating: 3, schedule: true, admission })).rejects.toThrow('gravar');
    expect(await persistence.load()).toEqual(bytes);
    expect(await second.getSnapshot()).toEqual(before);
    const winner = await second.recordReview({ flashcardId: b.id, sessionId: 'accepted', rating: 3, schedule: true, admission });
    await expect(first.recordReview({ flashcardId: a.id, sessionId: 'failed', rating: 3, schedule: true, admission })).rejects.toThrow('limite de novos');
    const snapshot = await first.getSnapshot();
    expect(snapshot.reviewLogs).toEqual([winner]);
    expect(snapshot.reviewSchedules).toHaveLength(1);
  });

  it.each([
    { name: '23 horas', dayStart: '2026-03-08T05:00:00.000Z', dayEnd: '2026-03-09T04:00:00.000Z', nextEnd: '2026-03-10T04:00:00.000Z' },
    { name: '25 horas', dayStart: '2026-11-01T04:00:00.000Z', dayEnd: '2026-11-02T05:00:00.000Z', nextEnd: '2026-11-03T05:00:00.000Z' },
  ])('inclui início e exclui fim em dia civil de $name', async ({ dayStart, dayEnd, nextEnd }) => {
    let time = new Date(Date.parse(dayStart) - 1).toISOString();
    const storage = await open(new MemoryPersistence(), () => time);
    const previous = await seed(storage);
    const current = await seed(storage, 'Física');
    const next = await seed(storage, 'Química');
    await storage.recordReview({ flashcardId: previous.id, sessionId: 'previous-day', rating: 3, schedule: true });
    time = dayStart;
    const window = { newCardLimit: 1, dayStart, dayEnd };
    const accepted = await storage.recordReview({ flashcardId: current.id, sessionId: 'day-start', rating: 3, schedule: true, admission: window });
    expect((await storage.getSnapshot()).reviewSchedules?.find(state => state.flashcardId === current.id)?.introducedAt).toBe(dayStart);
    time = new Date(Date.parse(dayEnd) - 1).toISOString();
    await expect(storage.recordReview({ flashcardId: next.id, sessionId: 'day-last-ms', rating: 3, schedule: true, admission: window })).rejects.toThrow('limite de novos');
    time = dayEnd;
    const before = await storage.getSnapshot();
    await expect(storage.recordReview({ flashcardId: next.id, sessionId: 'expired-window', rating: 3, schedule: true, admission: window })).rejects.toThrow('dia da revisão mudou');
    expect(await storage.getSnapshot()).toEqual(before);
    const newDay = await storage.recordReview({ flashcardId: next.id, sessionId: 'new-day', rating: 3, schedule: true, admission: { newCardLimit: 1, dayStart: dayEnd, dayEnd: nextEnd } });
    const snapshot = await storage.getSnapshot();
    expect(snapshot.reviewLogs).toHaveLength(3);
    expect(snapshot.reviewLogs).toContainEqual(accepted);
    expect(snapshot.reviewLogs).toContainEqual(newDay);
    expect(snapshot.reviewSchedules).toHaveLength(3);
  });

  it('recusa admissão em modo livre, cota inválida e janela inválida sem gravação parcial', async () => {
    const storage = await open();
    const card = await seed(storage);
    const before = await storage.getSnapshot();
    const base = { flashcardId: card.id, sessionId: 'invalid', rating: 3 as const, schedule: true, admission };
    const invalid = [
      { ...base, schedule: false }, { ...base, schedule: undefined },
      ...[-1, 51, 1.5].map(newCardLimit => ({ ...base, admission: { ...admission, newCardLimit } })),
      { ...base, admission: { ...admission, dayEnd: admission.dayStart } },
      { ...base, admission: { ...admission, dayEnd: '2026-10-21T02:59:59.999Z' } },
      { ...base, admission: { ...admission, dayEnd: '2026-10-23T03:00:00.001Z' } },
      { ...base, admission: { ...admission, dayStart: '2026-02-30T03:00:00.000Z' } },
    ];
    for (const input of invalid) await expect(storage.recordReview(input)).rejects.toThrow();
    expect(await storage.getSnapshot()).toEqual(before);
  });
});
