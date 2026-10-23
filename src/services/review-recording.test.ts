import { describe, expect, it, vi } from 'vitest';
import type { ReviewInput, ReviewLog, Snapshot, StorageService } from '../shared/types';
import { recordWorkspaceReview, SavedReviewNeedsReloadError } from './review-recording';

const input: ReviewInput = { flashcardId: 'card', sessionId: 'session', rating: 3, schedule: true };
const log: ReviewLog = { id: 'review', flashcardId: input.flashcardId, sessionId: input.sessionId, rating: input.rating, reviewedAt: '2026-10-21T12:00:00.000Z' };
const snapshot: Snapshot = { subjects: [], notes: [], flashcards: [], reviewLogs: [log], settings: { theme: 'light' } };

function stub() {
  const methods = { recordReview: vi.fn<StorageService['recordReview']>(), getSnapshot: vi.fn<StorageService['getSnapshot']>() };
  return { ...methods, storage: methods as unknown as StorageService };
}

describe('registro da revisão e atualização do workspace', () => {
  it('aguarda a resposta durável antes de ler o snapshot e devolve ambos juntos', async () => {
    const { storage, recordReview, getSnapshot } = stub();
    let finishSave!: (value: ReviewLog) => void;
    let finishRead!: (value: Snapshot) => void;
    recordReview.mockReturnValue(new Promise(resolve => { finishSave = resolve; }));
    getSnapshot.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
    const pending = recordWorkspaceReview(storage, input);
    expect(recordReview).toHaveBeenCalledWith(input);
    expect(getSnapshot).not.toHaveBeenCalled();
    finishSave(log);
    await Promise.resolve();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    finishRead(snapshot);
    expect(await pending).toEqual({ log, snapshot });
  });

  it('distingue resposta já salva de falha ao reler a agenda e conserva o log durável', async () => {
    const { storage, recordReview, getSnapshot } = stub();
    recordReview.mockResolvedValue(log);
    getSnapshot.mockRejectedValue(new Error('Falha sintética ao ler a agenda.'));
    const error = await recordWorkspaceReview(storage, input).then(() => null, cause => cause);
    expect(error).toBeInstanceOf(SavedReviewNeedsReloadError);
    expect(error.log).toEqual(log);
    expect(error.message).toContain('Sua resposta foi salva');
    expect(error.message).toContain('Recarregue');
    expect(recordReview).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
  });

  it('não consulta a agenda nem afirma sucesso quando a gravação da resposta falha', async () => {
    const { storage, recordReview, getSnapshot } = stub();
    const failure = new Error('Não foi possível gravar os dados locais.');
    recordReview.mockRejectedValue(failure);
    await expect(recordWorkspaceReview(storage, input)).rejects.toBe(failure);
    expect(getSnapshot).not.toHaveBeenCalled();
  });

  it.each([undefined, false])('prática livre com schedule=%s mantém o caminho existente sem ler o snapshot', async schedule => {
    const { storage, recordReview, getSnapshot } = stub();
    recordReview.mockResolvedValue(log);
    expect(await recordWorkspaceReview(storage, { ...input, schedule })).toEqual({ log });
    expect(getSnapshot).not.toHaveBeenCalled();
  });
});
