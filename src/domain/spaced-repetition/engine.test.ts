import { describe, expect, it } from 'vitest';
import vectors from '../../../tests/fixtures/spaced-repetition-v1.json';
import type { ReviewLog } from '../../shared/types';
import { advanceSchedule, validateSchedule, validateScheduleLinks } from './engine';

const review = (overrides: Partial<ReviewLog> = {}): ReviewLog => ({
  id: 'review', flashcardId: 'card', sessionId: 'session', rating: 3,
  reviewedAt: '2026-10-21T12:00:00.000Z', ...overrides,
});
const initial = () => advanceSchedule(undefined, review());

describe('revisão espaçada local v1', () => {
  it.each(vectors)('$name (vetor compartilhado com Rust)', vector => {
    const previous = vector.previous === null ? undefined : validateSchedule(vector.previous);
    const input = vector.review as ReviewLog;
    const before = structuredClone({ previous, input });
    const result = advanceSchedule(previous, input);
    expect(result).toEqual(vector.expected);
    expect(advanceSchedule(previous, input)).toEqual(result);
    expect({ previous, input }).toEqual(before);
  });

  it('recusa adiantamento, inclusive um milissegundo antes do vencimento', () => {
    const state = initial();
    for (const time of ['2026-10-21T12:00:00.001Z', '2026-10-22T11:59:59.999Z', '2026-10-20T12:00:00.000Z']) {
      expect(() => advanceSchedule(state, review({ id: 'next', reviewedAt: time }))).toThrow('ainda não venceu');
    }
  });

  it('recusa outro cartão ou aplicação duplicada do mesmo identificador', () => {
    const state = initial();
    expect(() => advanceSchedule(state, review({ id: 'next', flashcardId: 'other', reviewedAt: state.dueAt }))).toThrow('outro cartão');
    expect(() => advanceSchedule(state, review({ reviewedAt: state.dueAt }))).toThrow('já foi aplicada');
  });

  it.each(['2026-02-30T12:00:00.000Z', '2026-10-21T12:00:00Z', '2026-10-21T09:00:00.000-03:00', 'invalid'])('recusa data não canônica: %s', reviewedAt => {
    expect(() => advanceSchedule(undefined, review({ reviewedAt }))).toThrow('UTC');
  });

  it('recusa estouro de vencimento e de contadores sem alterar o estado anterior', () => {
    expect(() => advanceSchedule(undefined, review({ reviewedAt: '9999-12-31T12:00:00.000Z' }))).toThrow('limite de datas');
    const state = { ...initial(), repetitions: 1_000_000, firstReviewId: 'first', introducedAt: '2026-01-01T12:00:00.000Z' };
    const before = structuredClone(state);
    expect(() => advanceSchedule(state, review({ id: 'next', reviewedAt: state.dueAt }))).toThrow('limite');
    expect(state).toEqual(before);
  });

  it('recusa versões futuras, campos desconhecidos e contadores inconsistentes', () => {
    const state = initial();
    for (const changed of [
      { ...state, algorithmVersion: 2 }, { ...state, extra: true },
      { ...state, stage: 7 }, { ...state, stage: 3 }, { ...state, repetitions: 0 },
      { ...state, repetitions: 1.5 }, { ...state, lapses: 2 }, { ...state, lapses: 1 },
      { ...state, dueAt: state.lastReviewedAt }, { ...state, lastReviewId: '\0' },
    ]) expect(() => validateSchedule(changed)).toThrow();
  });

  it('mantém durações UTC de 24h através da mudança de horário civil', () => {
    const answer = review({ reviewedAt: '2026-11-01T05:30:00.000Z' });
    const state = advanceSchedule(undefined, answer);
    expect(state.dueAt).toBe('2026-11-02T05:30:00.000Z');
    expect(Date.parse(state.dueAt) - Date.parse(answer.reviewedAt)).toBe(86_400_000);
  });

  it('valida vínculos em snapshot sem transformar avaliações livres em agenda', () => {
    const log = review();
    const freeLog = review({ id: 'free', sessionId: 'free-session', rating: 1, reviewedAt: '2026-10-22T13:00:00.000Z' });
    const state = initial();
    expect(() => validateScheduleLinks([state], [log, freeLog], new Set(['card']))).not.toThrow();
    expect(() => validateScheduleLinks([], [log, freeLog], new Set(['card']))).not.toThrow();
    expect(() => validateScheduleLinks([state, state], [log], new Set(['card']))).toThrow('duplicadas');
    expect(() => validateScheduleLinks([state], [log], new Set())).toThrow('vínculos');
    expect(() => validateScheduleLinks([state], [], new Set(['card']))).toThrow('vínculos');
    expect(() => validateScheduleLinks([{ ...state, lastReviewedAt: '2026-10-21T13:00:00.000Z' }], [log], new Set(['card']))).toThrow();
    const first = review({ id:'first', sessionId:'first-session', reviewedAt:'2026-10-20T12:00:00.000Z' });
    expect(() => validateScheduleLinks([{ ...state, repetitions: 3, firstReviewId:first.id, introducedAt:first.reviewedAt }], [first, log], new Set(['card']))).toThrow('mais repetições');
    expect(() => validateScheduleLinks([{ ...state, dueAt: '2026-10-23T12:00:00.000Z' }], [log], new Set(['card']))).toThrow('vencimento');
  });

  it('recusa estágio e contador de retomadas incompatíveis com a última avaliação', () => {
    const state = initial();
    expect(() => validateScheduleLinks([{ ...state, stage: 0 }], [review()], new Set(['card']))).toThrow('estágio');
    const lapse = advanceSchedule(undefined, review({ rating: 1 }));
    expect(() => validateScheduleLinks([{ ...lapse, lapses: 0 }], [review({ rating: 1 })], new Set(['card']))).toThrow('retomadas');
    expect(() => validateScheduleLinks([state], [review({ rating: 1 })], new Set(['card']))).toThrow('estágio');
  });

  it('conserva a entrada inicial após retomada no mesmo dia, sem perder o vínculo de admissão', () => {
    const first = review({ rating: 1 });
    const entered = advanceSchedule(undefined, first);
    const nextLog = review({ id: 'next', sessionId: 'next-session', reviewedAt: entered.dueAt });
    const next = advanceSchedule(entered, nextLog);
    expect(next).toMatchObject({ repetitions: 2, firstReviewId: first.id, introducedAt: first.reviewedAt });
    expect(() => validateScheduleLinks([next], [first, nextLog], new Set(['card']))).not.toThrow();
    expect(() => validateScheduleLinks([next], [nextLog], new Set(['card']))).toThrow('entrada');
    expect(() => validateSchedule({ ...next, introducedAt: next.lastReviewedAt })).toThrow('entrada');
  });
});
