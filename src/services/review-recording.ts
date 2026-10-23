import type { ReviewInput, ReviewLog, Snapshot, StorageService } from '../shared/types';

/** A durable answer must never be presented as an unsaved answer when refreshing fails. */
export class SavedReviewNeedsReloadError extends Error {
  constructor(readonly log: ReviewLog) {
    super('Sua resposta foi salva. Recarregue a agenda para continuar com os vencimentos atualizados.');
    this.name = 'SavedReviewNeedsReloadError';
  }
}

export async function recordWorkspaceReview(storage: StorageService, input: ReviewInput): Promise<{ log: ReviewLog; snapshot?: Snapshot }> {
  const log = await storage.recordReview(input);
  if (!input.schedule) return { log };
  try { return { log, snapshot: await storage.getSnapshot() }; }
  catch { throw new SavedReviewNeedsReloadError(log); }
}
