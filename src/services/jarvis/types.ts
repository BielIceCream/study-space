/** JARVIS session data. No API key or raw document bytes belong in this contract. */
export interface JarvisModel { id: string; displayName: string }
export interface JarvisExcerpt { documentId: string; title: string; page: number; text: string }
export interface JarvisStudyContext {
  subjects: { id: string; name: string }[];
  activeSubject?: { id: string; name: string };
  activeNote?: { id: string; subjectId: string; title: string; excerpt?: string };
  activeCard?: { id: string; subjectId: string; front?: string; back?: string };
  documents: { id: string; subjectId: string; title: string; pageCount?: number }[];
  page?: number;
  excerpts: JarvisExcerpt[];
  contentShared: boolean;
}
export type JarvisAction =
  | { name: 'open_flashcards'; args: { subjectId: string } }
  | { name: 'start_review'; args: { subjectId?: string } }
  | { name: 'read_active_card'; args: Record<string, never> }
  | { name: 'study_feedback'; args: { cardId: string; answer: string } }
  | { name: 'propose_flashcards'; args: { subjectId: string; cards: { front: string; back: string }[] } };
export interface JarvisReference { documentId: string; title: string; page: number; excerpt: string }
export type JarvisStatus = 'success' | 'offline' | 'not_configured' | 'cancelled' | 'error';
export interface JarvisResponse {
  text: string;
  conversationId: string;
  references: JarvisReference[];
  actions: JarvisAction[];
  status: JarvisStatus;
}
export interface JarvisRequestOptions { model?: string; provider?: string; tools?: boolean; signal?: AbortSignal; timeoutMs?: number }
export interface JarvisTranscriptionInput {
  audioBase64: string; mimeType: string; durationMs: number; language?: string; model: string; provider?: string; requestId?: string;
}
export interface JarvisHistoryTurn { role: 'user' | 'model'; text: string }
export interface JarvisConnectionResult { ok: boolean; model: string; message: string }
