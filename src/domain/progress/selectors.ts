import type { ErrorEntry } from '../error-notebook/types';
import type { CompetencyEvidence } from '../study/engine';
import { assessCompetencies } from '../study/engine';
import type { StudyTrack } from '../study/types';
import type { ReviewSchedule } from '../spaced-repetition/types';
import type { Flashcard, ReviewLog, Snapshot, Subject } from '../../shared/types';

export type ProgressPeriod = 'week' | 'all';
export interface ProgressWindow { period: ProgressPeriod; startsAt: string | null; endsAt: string }
interface BoundTrack { track: StudyTrack; competencyIds: Set<string> }
export interface ProgressIndex {
  subjects: Map<string, Subject>;
  cards: Map<string, Flashcard[]>;
  reviews: Map<string, ReviewLog[]>;
  schedules: Map<string, ReviewSchedule[]>;
  errors: Map<string, ErrorEntry[]>;
  diagnostics: Map<string, BoundTrack[]>;
}
export interface SubjectDiagnosticProgress {
  trackId: string; trackName: string; answersInPeriod: number; distinctQuestionsInPeriod: number;
  unknownAnswersInPeriod: number;
  competencies: (CompetencyEvidence & { title: string })[];
}
export interface SubjectProgressSummary {
  subject: Subject | null; window: ProgressWindow;
  reviews: { answers: number; sessions: number; distinctCards: number; ratings: Record<1 | 2 | 3 | 4, number> };
  cards: { total: number; scheduled: number; unscheduled: number; due: number; upcoming: number };
  errors: { open: number; resolved: number; createdInPeriod: number; practicesInPeriod: number };
  diagnostics: SubjectDiagnosticProgress[];
  hasPeriodActivity: boolean;
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const current = map.get(key);
  if (current) current.push(value); else map.set(key, [value]);
}

/** Build once per validated snapshot. Opening a summary never writes or replays reviews. */
export function createProgressIndex(data: Snapshot): ProgressIndex {
  const index: ProgressIndex = {
    subjects: new Map(data.subjects.map(subject => [subject.id, subject])),
    cards: new Map(), reviews: new Map(), schedules: new Map(), errors: new Map(), diagnostics: new Map(),
  };
  const cardSubjects = new Map<string, string>();
  for (const card of data.flashcards) {
    cardSubjects.set(card.id, card.subjectId);
    append(index.cards, card.subjectId, card);
  }
  for (const review of data.reviewLogs) {
    const subjectId = cardSubjects.get(review.flashcardId);
    if (subjectId !== undefined) append(index.reviews, subjectId, review);
  }
  for (const schedule of data.reviewSchedules ?? []) {
    const subjectId = cardSubjects.get(schedule.flashcardId);
    if (subjectId !== undefined) append(index.schedules, subjectId, schedule);
  }
  for (const entry of data.errorEntries ?? []) append(index.errors, entry.subjectId, entry);
  for (const track of data.studyTracks ?? []) {
    const units = new Map(track.catalog.units.map(unit => [unit.id, unit]));
    const competenciesBySubject = new Map<string, Set<string>>();
    for (const binding of track.config.bindings) {
      const unit = units.get(binding.unitId);
      if (!unit || !index.subjects.has(binding.subjectId)) continue;
      const bound = competenciesBySubject.get(binding.subjectId) ?? new Set<string>();
      bound.add(unit.competencyId);
      competenciesBySubject.set(binding.subjectId, bound);
    }
    for (const [subjectId, competencyIds] of competenciesBySubject) append(index.diagnostics, subjectId, { track, competencyIds });
  }
  return index;
}

/** Seven local calendar days, including today; future activity never belongs to the window. */
export function progressWindow(period: ProgressPeriod, reference: Date): ProgressWindow {
  if (!Number.isFinite(reference.getTime())) throw new Error('A data de referência do resumo é inválida.');
  const start = new Date(reference.getTime());
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  return { period, startsAt: period === 'week' ? start.toISOString() : null, endsAt: reference.toISOString() };
}
const within = (date: string, window: ProgressWindow) => (window.startsAt === null || date >= window.startsAt) && date <= window.endsAt;

function diagnosticProgress(binding: BoundTrack, window: ProgressWindow, reference: Date): SubjectDiagnosticProgress {
  const { track, competencyIds } = binding;
  const questions = new Map(track.catalog.questions.map(question => [question.id, question]));
  // Reuse the same competency rules as the track, with an explicit clock and no future answers.
  const observedTrack: StudyTrack = {
    ...track,
    diagnostics: track.diagnostics.map(attempt => ({ ...attempt, answers: attempt.answers.filter(answer => answer.answeredAt <= window.endsAt) })),
  };
  const evidence = new Map(assessCompetencies(observedTrack, reference).map(item => [item.competencyId, item]));
  let answersInPeriod = 0;
  let unknownAnswersInPeriod = 0;
  const distinct = new Set<string>();
  for (const attempt of track.diagnostics) for (const answer of attempt.answers) {
    const question = questions.get(answer.questionId);
    if (!question || !competencyIds.has(question.competencyId) || !within(answer.answeredAt, window)) continue;
    answersInPeriod++;
    distinct.add(answer.questionId);
    if (answer.choiceIndex === null) unknownAnswersInPeriod++;
  }
  return {
    trackId: track.id, trackName: track.config.name, answersInPeriod,
    distinctQuestionsInPeriod: distinct.size, unknownAnswersInPeriod,
    competencies: track.catalog.competencies.filter(competency => competencyIds.has(competency.id)).map(competency => ({
      ...evidence.get(competency.id)!, title: competency.title,
    })),
  };
}

/** Activity uses the chosen window; error status and SRS due dates describe the current snapshot. */
export function selectSubjectProgress(index: ProgressIndex, subjectId: string, period: ProgressPeriod, reference: Date): SubjectProgressSummary {
  const window = progressWindow(period, reference);
  const sessions = new Set<string>();
  const reviewedCards = new Set<string>();
  const ratings: Record<1 | 2 | 3 | 4, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let answers = 0;
  for (const review of index.reviews.get(subjectId) ?? []) {
    if (!within(review.reviewedAt, window)) continue;
    answers++;
    sessions.add(review.sessionId);
    reviewedCards.add(review.flashcardId);
    ratings[review.rating]++;
  }
  const cards = index.cards.get(subjectId) ?? [];
  const schedules = index.schedules.get(subjectId) ?? [];
  const due = schedules.filter(schedule => schedule.dueAt <= window.endsAt).length;
  const errors = { open: 0, resolved: 0, createdInPeriod: 0, practicesInPeriod: 0 };
  for (const entry of index.errors.get(subjectId) ?? []) {
    errors[entry.status]++;
    if (within(entry.createdAt, window)) errors.createdInPeriod++;
    for (const practice of entry.practices) if (within(practice.createdAt, window)) errors.practicesInPeriod++;
  }
  const diagnostics = (index.diagnostics.get(subjectId) ?? []).map(binding => diagnosticProgress(binding, window, reference));
  return {
    subject: index.subjects.get(subjectId) ?? null, window,
    reviews: { answers, sessions: sessions.size, distinctCards: reviewedCards.size, ratings },
    cards: { total: cards.length, scheduled: schedules.length, unscheduled: cards.length - schedules.length, due, upcoming: schedules.length - due },
    errors, diagnostics,
    hasPeriodActivity: answers > 0 || errors.createdInPeriod > 0 || errors.practicesInPeriod > 0 || diagnostics.some(item => item.answersInPeriod > 0),
  };
}
