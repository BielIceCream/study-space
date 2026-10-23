import type { Flashcard } from '../../shared/types';
import type { ReviewSchedule } from './types';

export type ReviewMode = 'free' | 'spaced';

/** UTC instants delimiting the user's local civil day, which need not last 24h. */
export interface ReviewClock { now: string; dayStart: string; dayEnd: string }
export interface ReviewQueueOptions { subjectId?: string; newCardLimit: number; limit?: number }
export interface ReviewQueue {
  cards: Flashcard[];
  overdue: number;
  dueToday: number;
  newAvailable: number;
  newSelected: number;
  introducedToday: number;
  /** Daily capacity before the selected cards are actually answered; selection reserves nothing. */
  remainingNew: number;
  nextDueAt: string | null;
}

function utc(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('O relógio da revisão precisa conter datas UTC válidas com milissegundos.');
  }
}

function validateClock(clock: ReviewClock): void {
  utc(clock.now); utc(clock.dayStart); utc(clock.dayEnd);
  if (clock.dayStart > clock.now || clock.now >= clock.dayEnd) {
    throw new Error('O instante da revisão precisa pertencer ao dia local informado.');
  }
}

/** Read the clock once. Setting each boundary separately handles midnight DST changes too. */
export function reviewClock(date: Date = new Date()): ReviewClock {
  if (!Number.isFinite(date.getTime())) throw new Error('O relógio da revisão é inválido.');
  const start = new Date(date.getTime());
  start.setHours(0, 0, 0, 0);
  const end = new Date(date.getTime());
  end.setDate(end.getDate() + 1);
  end.setHours(0, 0, 0, 0);
  const clock = { now: date.toISOString(), dayStart: start.toISOString(), dayEnd: end.toISOString() };
  validateClock(clock);
  return clock;
}

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Select from validated snapshot entities. No enrollment, clock reads, writes or history replay. */
export function buildReviewQueue(cards: Flashcard[], schedules: ReviewSchedule[], clock: ReviewClock, options: ReviewQueueOptions): ReviewQueue {
  validateClock(clock);
  const limit = options.limit ?? 200;
  if (!Number.isInteger(options.newCardLimit) || options.newCardLimit < 0 || options.newCardLimit > 50) {
    throw new Error('O limite de novos cartões precisa ser um inteiro entre 0 e 50.');
  }
  if (!Number.isInteger(limit) || limit < 0 || limit > 200) {
    throw new Error('A sessão de revisão precisa ter um limite inteiro entre 0 e 200 cartões.');
  }
  const byCard = new Map<string, ReviewSchedule>();
  let introducedToday = 0;
  for (const schedule of schedules) {
    byCard.set(schedule.flashcardId, schedule);
    // Global across subjects; changing the subject never resets today's admission count.
    if (schedule.introducedAt >= clock.dayStart && schedule.introducedAt < clock.dayEnd) introducedToday++;
  }
  const due: { card: Flashcard; dueAt: string }[] = [];
  const fresh: Flashcard[] = [];
  let overdue = 0;
  let dueToday = 0;
  let nextDueAt: string | null = null;
  for (const card of cards) {
    if (options.subjectId !== undefined && card.subjectId !== options.subjectId) continue;
    const schedule = byCard.get(card.id);
    if (!schedule) { fresh.push(card); continue; }
    if (schedule.dueAt > clock.now) {
      if (nextDueAt === null || schedule.dueAt < nextDueAt) nextDueAt = schedule.dueAt;
      continue;
    }
    due.push({ card, dueAt: schedule.dueAt });
    if (schedule.dueAt < clock.dayStart) overdue++;
    else dueToday++;
  }
  due.sort((left, right) => compare(left.dueAt, right.dueAt) || compare(left.card.id, right.card.id));
  fresh.sort((left, right) => compare(left.createdAt, right.createdAt) || compare(left.id, right.id));
  const remainingNew = Math.max(0, options.newCardLimit - introducedToday);
  const dueSelected = due.slice(0, limit).map(item => item.card);
  const newSelected = Math.min(fresh.length, remainingNew, limit - dueSelected.length);
  return {
    cards: [...dueSelected, ...fresh.slice(0, newSelected)], overdue, dueToday,
    newAvailable: fresh.length, newSelected, introducedToday, remainingNew, nextDueAt,
  };
}
