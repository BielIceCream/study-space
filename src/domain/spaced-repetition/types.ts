/** Versioned, local review state. A stage is a scheduling aid, never a mastery score. */
export interface ReviewSchedule {
  flashcardId: string;
  algorithmVersion: 1;
  stage: number;
  repetitions: number;
  lapses: number;
  firstReviewId: string;
  introducedAt: string;
  lastReviewId: string;
  lastReviewedAt: string;
  dueAt: string;
}
