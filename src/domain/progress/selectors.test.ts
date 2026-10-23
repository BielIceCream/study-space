import { describe, expect, it } from 'vitest';
import type { ErrorEntry } from '../error-notebook/types';
import { advanceSchedule } from '../spaced-repetition/engine';
import { defaultConfig, DEMO_CATALOG } from '../study/demo';
import type { StudyTrack } from '../study/types';
import type { Flashcard, ReviewLog, Snapshot } from '../../shared/types';
import { createProgressIndex, progressWindow, selectSubjectProgress } from './selectors';

const reference = new Date(2026, 9, 23, 13, 30, 0, 0);
const localDate = (day: number, hour = 12) => new Date(2026, 9, day, hour).toISOString();
const beginning = new Date(2026, 9, 17, 0, 0, 0, 0).toISOString();
const card = (id: string, subjectId = 'math'): Flashcard => ({
  id, subjectId, noteId: null, front: id, back: 'Resposta', createdAt: localDate(1), updatedAt: localDate(1),
});
const review = (id: string, flashcardId: string, sessionId: string, reviewedAt: string, rating: ReviewLog['rating'] = 3): ReviewLog => ({ id, flashcardId, sessionId, reviewedAt, rating });
function error(id: string, subjectId = 'math'): ErrorEntry {
  return {
    id, revision: 1, subjectId, originLabel: 'Exercício', question: 'Onde errei?', correction: '', nextAction: '', status: 'open', source: { kind: 'manual' },
    sourceSnapshot: { title: 'Exercício', prompt: 'Onde errei?', answer: '' }, practices: [], createdAt: localDate(2), updatedAt: localDate(2), resolvedAt: null,
  };
}
function track(): StudyTrack {
  return {
    id: 'track-1', revision: 1, createdAt: localDate(1), updatedAt: localDate(22), catalog: structuredClone(DEMO_CATALOG), config: defaultConfig(),
    diagnostics: [{ id: 'attempt-1', startedAt: localDate(10), updatedAt: localDate(20), status: 'completed', questionIds: ['operacoes-1', 'operacoes-2', 'proporcoes-1', 'informacao-1'], answers: [
      { questionId: 'operacoes-1', choiceIndex: 1, answeredAt: localDate(10) },
      { questionId: 'operacoes-2', choiceIndex: 0, answeredAt: localDate(20) },
      { questionId: 'proporcoes-1', choiceIndex: 1, answeredAt: localDate(20) },
      { questionId: 'informacao-1', choiceIndex: null, answeredAt: localDate(20) },
    ] }],
  };
}
function snapshot(): Snapshot {
  return {
    // Same name is deliberate: names must never create links or transfer activity.
    subjects: ['math', 'other'].map(id => ({ id, name: 'Matemática', accent: 'blue' as const, createdAt: localDate(1), updatedAt: localDate(1) })),
    notes: [], flashcards: [], reviewLogs: [], settings: { theme: 'light' },
  };
}
const summary = (data: Snapshot, period: 'week' | 'all' = 'week') => selectSubjectProgress(createProgressIndex(data), 'math', period, reference);

describe('resumo por matéria sem gravações', () => {
  it('mantém zeros, estados vazios e referência explícita sem fabricar evidência', () => {
    const data = snapshot();
    expect(summary(data)).toMatchObject({
      reviews: { answers: 0, sessions: 0, distinctCards: 0, ratings: { 1: 0, 2: 0, 3: 0, 4: 0 } },
      cards: { total: 0, scheduled: 0, unscheduled: 0, due: 0, upcoming: 0 },
      errors: { open: 0, resolved: 0, createdInPeriod: 0, practicesInPeriod: 0 }, diagnostics: [], hasPeriodActivity: false,
    });
    expect(selectSubjectProgress(createProgressIndex(data), 'missing', 'week', reference).subject).toBeNull();
    expect(() => progressWindow('week', new Date(NaN))).toThrow('referência');
  });

  it('conta respostas, cartões distintos e sessões por matéria sem somar a avaliação causal de um erro', () => {
    const data = snapshot();
    data.flashcards = [card('m1'), card('m2'), card('other-card', 'other')];
    data.reviewLogs = [
      review('causal', 'm1', 'session-1', beginning, 1),
      review('same-session', 'm2', 'session-1', localDate(18), 2),
      review('again', 'm1', 'session-2', localDate(22), 4),
      review('other-subject', 'other-card', 'session-1', localDate(22)),
    ];
    data.errorEntries = [{ ...error('linked-error'), source: { kind: 'flashcard', flashcardId: 'm1', reviewLogId: 'causal' }, createdAt: localDate(18) }];
    expect(summary(data).reviews).toEqual({ answers: 3, sessions: 2, distinctCards: 2, ratings: { 1: 1, 2: 1, 3: 0, 4: 1 } });
    expect(selectSubjectProgress(createProgressIndex(data), 'other', 'week', reference).reviews).toMatchObject({ answers: 1, sessions: 1, distinctCards: 1 });
  });

  it('usa sete dias civis locais, incluindo início e referência, sem incluir datas futuras', () => {
    const data = snapshot();
    data.flashcards = [card('m1')];
    data.reviewLogs = [
      review('before', 'm1', 'old', new Date(Date.parse(beginning) - 1).toISOString()),
      review('start', 'm1', 'first', beginning),
      review('now', 'm1', 'last', reference.toISOString()),
      review('after', 'm1', 'future', new Date(reference.getTime() + 1).toISOString()),
    ];
    const start = new Date(progressWindow('week', reference).startsAt!);
    expect([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes()]).toEqual([2026, 9, 17, 0, 0]);
    expect(summary(data).reviews.answers).toBe(2);
    expect(summary(data, 'all').reviews.answers).toBe(3);
    expect(summary(data).window.endsAt).toBe(reference.toISOString());
    const boundaryYear = progressWindow('week', new Date(2027, 0, 2, 0, 0, 0, 0));
    expect(boundaryYear.startsAt).toBe(new Date(2026, 11, 27, 0, 0, 0, 0).toISOString());
  });

  it('separa status atual, reabertura e práticas do período sem inferir eventos de resolução perdidos', () => {
    const data = snapshot();
    data.errorEntries = [
      { ...error('reopened'), revision: 3, updatedAt: localDate(22), practices: [{ id: 'old-practice', description: 'Antiga', createdAt: localDate(3) }, { id: 'current-practice', description: 'Refiz', createdAt: localDate(20) }] },
      { ...error('resolved'), status: 'resolved', correction: 'Corrigi', nextAction: 'Retomar', resolvedAt: localDate(4), updatedAt: localDate(4) },
      { ...error('new'), createdAt: localDate(21), updatedAt: localDate(21) },
      { ...error('other', 'other'), updatedAt: localDate(20), practices: [{ id: 'unrelated', description: 'Outra', createdAt: localDate(20) }] },
    ];
    expect(summary(data).errors).toEqual({ open: 2, resolved: 1, createdInPeriod: 1, practicesInPeriod: 1 });
    expect(summary(data, 'all').errors).toEqual({ open: 2, resolved: 1, createdInPeriod: 3, practicesInPeriod: 2 });
    data.errorEntries[0].status = 'resolved';
    data.errorEntries[0].resolvedAt = localDate(23);
    expect(summary(data).errors).toMatchObject({ open: 1, resolved: 2, practicesInPeriod: 1 });
  });

  it('mostra vencimentos no instante da referência e não os mistura com atividade no período', () => {
    const data = snapshot();
    data.flashcards = [card('due'), card('later'), card('unscheduled'), card('other', 'other')];
    const initial = (id: string, offset: number) => review(`${id}-first`, id, 'past-1', new Date(reference.getTime() - 17 * 86_400_000 + offset).toISOString(), 4);
    const latest = (id: string, offset: number) => review(`${id}-last`, id, 'past-2', new Date(reference.getTime() - 14 * 86_400_000 + offset).toISOString(), 4);
    data.reviewLogs = [initial('due', 0), latest('due', 0), initial('later', 1), latest('later', 1)];
    data.reviewSchedules = [
      advanceSchedule(advanceSchedule(undefined, data.reviewLogs[0]), data.reviewLogs[1]),
      advanceSchedule(advanceSchedule(undefined, data.reviewLogs[2]), data.reviewLogs[3]),
    ];
    expect(summary(data).cards).toEqual({ total: 3, scheduled: 2, unscheduled: 1, due: 1, upcoming: 1 });
    expect(summary(data, 'all').cards).toEqual(summary(data).cards);
    expect(summary(data).reviews.answers).toBe(0);
    expect(summary(data).hasPeriodActivity).toBe(false);
  });

  it('atribui diagnósticos apenas por vínculo explícito de unidade e evita competência duplicada', () => {
    const data = snapshot();
    const value = track();
    // A second unit of the same competency must not double the sample.
    value.catalog.units.push({ ...value.catalog.units[0], id: 'extra-unit' });
    value.config.bindings = [
      { unitId: 'mat-operacoes', subjectId: 'math', noteIds: [] },
      { unitId: 'extra-unit', subjectId: 'math', noteIds: [] },
      { unitId: 'lin-informacao', subjectId: 'other', noteIds: [] },
    ];
    data.studyTracks = [value];
    const result = summary(data).diagnostics;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ answersInPeriod: 1, distinctQuestionsInPeriod: 1, unknownAnswersInPeriod: 0 });
    expect(result[0].competencies).toHaveLength(1);
    expect(result[0].competencies[0]).toMatchObject({ competencyId: 'operacoes', sampleSize: 2, correctCount: 2, status: 'initial-evidence' });
    const unrelated = selectSubjectProgress(createProgressIndex(data), 'other', 'week', reference).diagnostics[0];
    expect(unrelated.competencies[0]).toMatchObject({ competencyId: 'informacao', sampleSize: 0, status: 'unknown' });
    expect(unrelated).toMatchObject({ answersInPeriod: 1, distinctQuestionsInPeriod: 1, unknownAnswersInPeriod: 1 });
    value.config.bindings = [];
    expect(summary(data).diagnostics).toEqual([]);
  });

  it('reutiliza a última evidência por questão sem transformar respostas repetidas ou futuras em domínio', () => {
    const data = snapshot();
    const value = track();
    value.config.bindings = [{ unitId: 'mat-operacoes', subjectId: 'math', noteIds: [] }];
    value.diagnostics.push(
      { id: 'attempt-2', startedAt: localDate(21), updatedAt: localDate(22), status: 'completed', questionIds: ['operacoes-1'], answers: [{ questionId: 'operacoes-1', choiceIndex: 0, answeredAt: localDate(22) }] },
      { id: 'attempt-3', startedAt: localDate(24), updatedAt: localDate(24), status: 'completed', questionIds: ['operacoes-1'], answers: [{ questionId: 'operacoes-1', choiceIndex: 1, answeredAt: localDate(24) }] },
    );
    value.updatedAt = localDate(24);
    data.studyTracks = [value];
    expect(summary(data).diagnostics[0]).toMatchObject({ answersInPeriod: 2, distinctQuestionsInPeriod: 2 });
    expect(summary(data).diagnostics[0].competencies[0]).toMatchObject({ sampleSize: 2, correctCount: 1, status: 'needs-practice' });
  });

  it('preserva o mesmo resultado após serialização e não modifica o snapshot nem a referência', () => {
    const data = snapshot();
    data.flashcards = [card('m1')];
    data.reviewLogs = [review('r1', 'm1', 's1', localDate(20))];
    data.errorEntries = [error('e1')];
    const value = track();
    value.config.bindings = [{ unitId: 'mat-operacoes', subjectId: 'math', noteIds: [] }];
    data.studyTracks = [value];
    const before = structuredClone(data);
    const timestamp = reference.getTime();
    const first = summary(data);
    expect(summary(JSON.parse(JSON.stringify(data)) as Snapshot)).toEqual(first);
    expect(summary(data)).toEqual(first);
    expect(data).toEqual(before);
    expect(reference.getTime()).toBe(timestamp);
  });
});
