export type ErrorSource = { kind: 'manual' }
  | { kind: 'flashcard'; flashcardId: string; reviewLogId: string | null }
  | { kind: 'note'; noteId: string }
  | { kind: 'diagnostic'; trackId: string; attemptId: string; questionId: string };
export interface ErrorPractice { id: string; description: string; createdAt: string }
export interface ErrorEntry {
  id: string; revision: number; subjectId: string; originLabel: string; question: string;
  correction: string; nextAction: string; status: 'open' | 'resolved'; source: ErrorSource;
  sourceSnapshot: { title: string; prompt: string; answer: string };
  practices: ErrorPractice[]; createdAt: string; updatedAt: string; resolvedAt: string | null;
}
export interface SaveErrorEntryInput {
  id?: string; expectedRevision?: number; subjectId: string; originLabel: string;
  question: string; correction: string; nextAction: string; status: 'open' | 'resolved';
  source: ErrorSource; practice?: { id: string; description: string };
}
/** A suggested draft, never an automatically created diagnosis or saved entry. */
export interface ErrorDraft { subjectId: string; question: string; originLabel: string; source: ErrorSource }
