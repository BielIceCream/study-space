import type { Rating, ReviewLog } from '../../shared/types';
import type { ReviewSchedule } from './types';

// StudySpace's own conservative ladder, not an implementation of SM-2 or FSRS.
export const SCHEDULE_ALGORITHM_VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;
const STAGE_DAYS = [1, 3, 7, 14, 30, 60] as const;
const MAX_REVIEWS = 1_000_000;
const SCHEDULE_KEYS = ['flashcardId', 'algorithmVersion', 'stage', 'repetitions', 'lapses', 'firstReviewId', 'introducedAt', 'lastReviewId', 'lastReviewedAt', 'dueAt'];

function invalid(message: string): never { throw new Error(message); }
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid('A agenda de revisão precisa ser um objeto válido.');
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(result, key))) invalid('A agenda de revisão contém campos ausentes ou desconhecidos.');
  return result;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || value.includes('\0')) invalid('O identificador da revisão é inválido.');
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid('Os contadores da agenda de revisão estão fora do limite.');
  return value;
}
function utc(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) invalid('A data da revisão precisa ser válida, em UTC com milissegundos.');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) invalid('A data da revisão precisa ser válida, em UTC com milissegundos.');
  return value;
}

/** Validate a persisted state without reading clocks or changing the supplied object. */
export function validateSchedule(value: unknown): ReviewSchedule {
  const data = object(value, SCHEDULE_KEYS);
  if (data.algorithmVersion !== SCHEDULE_ALGORITHM_VERSION) invalid('A agenda de revisão usa uma versão de algoritmo não suportada.');
  const result: ReviewSchedule = {
    flashcardId: id(data.flashcardId), algorithmVersion: SCHEDULE_ALGORITHM_VERSION,
    stage: integer(data.stage, 0, 6), repetitions: integer(data.repetitions, 1, MAX_REVIEWS),
    lapses: integer(data.lapses, 0, MAX_REVIEWS), firstReviewId: id(data.firstReviewId), introducedAt: utc(data.introducedAt), lastReviewId: id(data.lastReviewId),
    lastReviewedAt: utc(data.lastReviewedAt), dueAt: utc(data.dueAt),
  };
  if (result.lapses > result.repetitions || result.stage > result.repetitions * 2
    || (result.stage > 0 && result.lapses === result.repetitions)) invalid('Os contadores da agenda de revisão são inconsistentes.');
  if (result.dueAt <= result.lastReviewedAt) invalid('O próximo vencimento precisa ser posterior à revisão.');
  if (result.repetitions === 1
    ? result.introducedAt !== result.lastReviewedAt || result.firstReviewId !== result.lastReviewId
    : result.introducedAt >= result.lastReviewedAt || result.firstReviewId === result.lastReviewId) invalid('A entrada do cartão na agenda é inconsistente com as revisões.');
  return result;
}

function interval(stage: number, rating: Rating): number {
  if (rating === 1) {
    if (stage !== 0) invalid('Uma resposta Errei precisa retomar o estágio inicial.');
    return 10 * 60 * 1000;
  }
  if (rating === 2) return stage === 0 ? 60 * 60 * 1000 : Math.max(1, Math.floor(STAGE_DAYS[stage - 1] / 2)) * DAY;
  if (stage < (rating === 4 ? 2 : 1)) invalid('O estágio da agenda não corresponde à última avaliação.');
  return STAGE_DAYS[stage - 1] * DAY;
}

function dueAt(reviewedAt: string, stage: number, rating: Rating): string {
  const time = Date.parse(reviewedAt) + interval(stage, rating);
  if (!Number.isFinite(time) || time > Date.parse('9999-12-31T23:59:59.999Z')) invalid('O próximo vencimento ultrapassa o limite de datas da agenda.');
  return utc(new Date(time).toISOString());
}

/** The storage transaction handles session/card idempotency before invoking this function. */
export function advanceSchedule(previous: ReviewSchedule | undefined, review: ReviewLog): ReviewSchedule {
  id(review.id); id(review.flashcardId); id(review.sessionId); utc(review.reviewedAt);
  integer(review.rating, 1, 4);
  const current = previous === undefined ? undefined : validateSchedule(previous);
  if (current && current.flashcardId !== review.flashcardId) invalid('A agenda de revisão pertence a outro cartão.');
  if (current && current.lastReviewId === review.id) invalid('Esta revisão já foi aplicada à agenda.');
  if (current && review.reviewedAt < current.dueAt) invalid('A próxima revisão espaçada ainda não venceu. Use a prática livre para revisar antes.');
  const oldStage = current?.stage ?? 0;
  const stage = review.rating === 1 ? 0 : review.rating === 2 ? oldStage : Math.min(6, oldStage + (review.rating === 4 ? 2 : 1));
  return validateSchedule({
    flashcardId: review.flashcardId, algorithmVersion: SCHEDULE_ALGORITHM_VERSION, stage,
    repetitions: (current?.repetitions ?? 0) + 1,
    lapses: (current?.lapses ?? 0) + (review.rating === 1 ? 1 : 0),
    firstReviewId: current?.firstReviewId ?? review.id, introducedAt: current?.introducedAt ?? review.reviewedAt,
    lastReviewId: review.id, lastReviewedAt: review.reviewedAt,
    dueAt: dueAt(review.reviewedAt, stage, review.rating),
  });
}

/** Linear validation of snapshot links; old/free reviews are never replayed into a schedule. */
export function validateScheduleLinks(schedules: ReviewSchedule[], reviews: ReviewLog[], cardIds: Set<string>): void {
  if (schedules.length > 200_000 || reviews.length > MAX_REVIEWS) invalid('A agenda excede o limite de cartões ou revisões.');
  if (!schedules.length) return;
  const byId = new Map<string, ReviewLog>();
  const counts = new Map<string, number>();
  for (const review of reviews) {
    if (byId.has(review.id)) invalid('Há identificadores duplicados no histórico de revisões.');
    byId.set(review.id, review);
    counts.set(review.flashcardId, (counts.get(review.flashcardId) ?? 0) + 1);
  }
  const seen = new Set<string>();
  for (const value of schedules) {
    const state = validateSchedule(value);
    if (seen.has(state.flashcardId)) invalid('Há agendas duplicadas para o mesmo cartão.');
    seen.add(state.flashcardId);
    const review = byId.get(state.lastReviewId);
    const first = byId.get(state.firstReviewId);
    if (!cardIds.has(state.flashcardId) || !review || review.flashcardId !== state.flashcardId
      || review.reviewedAt !== state.lastReviewedAt) invalid('A agenda de revisão contém vínculos inconsistentes com o cartão ou histórico.');
    if (!first || first.flashcardId !== state.flashcardId || first.reviewedAt !== state.introducedAt) invalid('A entrada na agenda contém vínculos inconsistentes com o cartão ou histórico.');
    integer(review.rating, 1, 4);
    if (state.repetitions > (counts.get(state.flashcardId) ?? 0)) invalid('A agenda contém mais repetições do que o histórico do cartão.');
    if (state.dueAt !== dueAt(state.lastReviewedAt, state.stage, review.rating)) invalid('O vencimento da agenda não corresponde às regras da última avaliação.');
    if (review.rating === 1 && state.lapses < 1) invalid('A resposta Errei precisa constar no contador de retomadas.');
  }
}
