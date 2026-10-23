import { describe, expect, it } from 'vitest';
import type { Flashcard, ReviewLog } from '../../shared/types';
import { advanceSchedule } from './engine';
import type { ReviewSchedule } from './types';
import { buildReviewQueue, reviewClock, type ReviewClock } from './queue';

const clock: ReviewClock = { now: '2026-10-21T15:00:00.000Z', dayStart: '2026-10-21T03:00:00.000Z', dayEnd: '2026-10-22T03:00:00.000Z' };
const card = (id: string, subjectId = 'biology', createdAt = '2026-10-01T12:00:00.000Z'): Flashcard => ({
  id, subjectId, noteId: null, front: `Pergunta ${id}`, back: `Resposta ${id}`, createdAt, updatedAt: createdAt,
});
const log = (id: string, reviewedAt: string, rating: ReviewLog['rating'] = 3): ReviewLog => ({
  id: `${id}-review`, flashcardId: id, sessionId: `${id}-session`, rating, reviewedAt,
});
const scheduled = (id: string, reviewedAt: string): ReviewSchedule => advanceSchedule(undefined, log(id, reviewedAt));

describe('fila local de revisão espaçada', () => {
  it('prioriza atrasados e vencimentos por instante UTC, com desempate estável antes dos novos', () => {
    const cards = [card('new-z'), card('due-b'), card('late'), card('future'), card('new-a'), card('due-a')];
    const schedules = [
      scheduled('due-b', '2026-10-20T12:00:00.000Z'), scheduled('late', '2026-10-18T12:00:00.000Z'),
      scheduled('future', '2026-10-21T12:00:00.000Z'), scheduled('due-a', '2026-10-20T12:00:00.000Z'),
    ];
    const before = structuredClone({ cards, schedules, clock });
    const result = buildReviewQueue(cards, schedules, clock, { newCardLimit: 3 });
    expect(result.cards.map(item => item.id)).toEqual(['late', 'due-a', 'due-b', 'new-a', 'new-z']);
    expect(result).toMatchObject({ overdue: 1, dueToday: 2, newAvailable: 2, newSelected: 2, introducedToday: 1, remainingNew: 2, nextDueAt: '2026-10-22T12:00:00.000Z' });
    expect(buildReviewQueue([...cards].reverse(), [...schedules].reverse(), clock, { newCardLimit: 3 })).toEqual(result);
    expect({ cards, schedules, clock }).toEqual(before);
  });

  it('conta a admissão de todas as matérias e não reinicia a cota ao trocar o filtro', () => {
    const cards = [card('introduced', 'math'), card('new', 'biology'), card('math-new', 'math')];
    const schedules = [scheduled('introduced', '2026-10-21T04:00:00.000Z')];
    const biology = buildReviewQueue(cards, schedules, clock, { subjectId: 'biology', newCardLimit: 1 });
    expect(biology).toMatchObject({ cards: [], newAvailable: 1, newSelected: 0, introducedToday: 1, remainingNew: 0, nextDueAt: null });
    expect(buildReviewQueue(cards, schedules, clock, { subjectId: 'math', newCardLimit: 1 }).cards).toEqual([]);
    expect(schedules).toHaveLength(1);
  });

  it('não inscreve cartões antigos/importados antes da primeira resposta e seleciona os mais antigos', () => {
    const cards = [card('latest', 'biology', '2026-10-20T12:00:00.000Z'), card('older-b'), card('older-a')];
    const result = buildReviewQueue(cards, [], clock, { newCardLimit: 1 });
    expect(result.cards.map(item => item.id)).toEqual(['older-a']);
    expect(result).toMatchObject({ newAvailable: 3, newSelected: 1, introducedToday: 0, remainingNew: 1 });
    expect(buildReviewQueue(cards, [], clock, { newCardLimit: 0 }).cards).toEqual([]);
  });

  it('aplica o limite da sessão depois dos vencidos sem consumir cota por seleção', () => {
    const cards = [card('a'), card('b'), card('new')];
    const schedules = [scheduled('a', '2026-10-18T12:00:00.000Z'), scheduled('b', '2026-10-19T12:00:00.000Z')];
    const result = buildReviewQueue(cards, schedules, clock, { newCardLimit: 10, limit: 1 });
    expect(result.cards.map(item => item.id)).toEqual(['a']);
    expect(result).toMatchObject({ overdue: 2, newAvailable: 1, newSelected: 0, remainingNew: 10 });
    expect(buildReviewQueue(cards, schedules, clock, { newCardLimit: 10, limit: 0 })).toMatchObject({ cards: [], overdue: 2, newAvailable: 1 });
  });

  it('inclui o vencimento no instante exato, distingue atraso e mantém futuros fora da sessão', () => {
    const cards = [card('now'), card('midnight'), card('prior'), card('future')];
    const schedules = [
      scheduled('now', '2026-10-20T15:00:00.000Z'), scheduled('midnight', '2026-10-20T03:00:00.000Z'),
      scheduled('prior', '2026-10-20T02:59:59.999Z'), scheduled('future', '2026-10-20T15:00:00.001Z'),
    ];
    const result = buildReviewQueue(cards, schedules, clock, { newCardLimit: 0 });
    expect(result.cards.map(item => item.id)).toEqual(['prior', 'midnight', 'now']);
    expect(result).toMatchObject({ overdue: 1, dueToday: 2, nextDueAt: '2026-10-21T15:00:00.001Z' });
  });

  it('usa o dia civil local de 23 horas, incluindo início e excluindo a próxima meia-noite', () => {
    const spring: ReviewClock = { now: '2026-03-09T03:59:59.999Z', dayStart: '2026-03-08T05:00:00.000Z', dayEnd: '2026-03-09T04:00:00.000Z' };
    const cards = [card('before'), card('start'), card('end')];
    const schedules = [scheduled('before', '2026-03-08T04:59:59.999Z'), scheduled('start', '2026-03-08T05:00:00.000Z'), scheduled('end', '2026-03-09T04:00:00.000Z')];
    const result = buildReviewQueue(cards, schedules, spring, { newCardLimit: 3 });
    expect(result).toMatchObject({ introducedToday: 1, remainingNew: 2 });
    const nextDay: ReviewClock = { now: spring.dayEnd, dayStart: spring.dayEnd, dayEnd: '2026-03-10T04:00:00.000Z' };
    expect(buildReviewQueue(cards, schedules, nextDay, { newCardLimit: 3 }).introducedToday).toBe(1);
  });

  it('conserva a cota após uma retomada no mesmo dia e não confunde avaliações com cartões novos', () => {
    const first = log('retry', '2026-10-21T04:00:00.000Z', 1);
    const entered = advanceSchedule(undefined, first);
    const second = { ...log('retry', entered.dueAt, 3), id: 'second-review', sessionId: 'second-session' };
    const continued = advanceSchedule(entered, second);
    expect(continued.repetitions).toBe(2);
    expect(buildReviewQueue([card('retry'), card('new')], [continued], clock, { newCardLimit: 1 })).toMatchObject({ cards: [], introducedToday: 1, remainingNew: 0, newAvailable: 1 });
  });

  it('retorna fila vazia e ausência de próxima revisão quando não há cartões', () => {
    expect(buildReviewQueue([], [], clock, { newCardLimit: 10 })).toEqual({ cards: [], overdue: 0, dueToday: 0, newAvailable: 0, newSelected: 0, introducedToday: 0, remainingNew: 10, nextDueAt: null });
  });

  it('captura os limites do dia local sem alterar o relógio recebido', () => {
    const date = new Date(2026, 9, 21, 12, 34, 56, 789);
    const before = date.getTime();
    const result = reviewClock(date);
    expect(result.now).toBe(date.toISOString());
    const start = new Date(result.dayStart);
    const end = new Date(result.dayEnd);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2026, 9, 21, 0, 0]);
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes()]).toEqual([2026, 9, 22, 0, 0]);
    expect(date.getTime()).toBe(before);
    expect(() => reviewClock(new Date(NaN))).toThrow('inválido');
  });

  it('recusa cotas, tamanhos de sessão e limites de dia inválidos', () => {
    for (const newCardLimit of [-1, 51, 1.5, NaN]) expect(() => buildReviewQueue([], [], clock, { newCardLimit })).toThrow('limite de novos');
    for (const limit of [-1, 201, 1.5, NaN]) expect(() => buildReviewQueue([], [], clock, { newCardLimit: 10, limit })).toThrow('limite inteiro');
    for (const invalid of [
      { ...clock, now: clock.dayEnd }, { ...clock, now: '2026-10-21T02:59:59.999Z' },
      { ...clock, dayEnd: clock.dayStart }, { ...clock, now: '2026-10-21T15:00:00Z' },
      { ...clock, dayStart: '2026-02-30T00:00:00.000Z' },
    ]) expect(() => buildReviewQueue([], [], invalid, { newCardLimit: 10 })).toThrow();
  });
});
