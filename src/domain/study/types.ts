/** Catalog content is shareable; StudyTrack contains private student state. */
export interface StudyCatalog {
  id: string; version: number; title: string; description: string;
  origin: string; license: string; demonstrative: true;
  subjects: { id: string; name: string }[];
  competencies: { id: string; subjectId: string; title: string }[];
  units: { id: string; competencyId: string; title: string; summary: string; prerequisites: string[] }[];
  questions: { id: string; competencyId: string; prompt: string; choices: string[]; correctIndex: number; explanation: string }[];
}
export interface TrackConfig {
  name: string; objective: string; startingYear: 'fundamental' | 'medio-1' | 'medio-2' | 'medio-3' | 'concluido';
  subjectIds: string[]; difficulties: { subjectId: string; level: 'unknown' | 'low' | 'medium' | 'high' }[];
  examDate: string | null; weeklyMinutes: number;
  intensity: 'light' | 'balanced' | 'intensive'; pace: 'gradual' | 'regular' | 'accelerated';
  reviewEveryDays: number; mockEveryWeeks: number;
  bindings: { unitId: string; subjectId: string; noteIds: string[] }[];
}
export interface DiagnosticAttempt {
  id: string; startedAt: string; updatedAt: string;
  status: 'in-progress' | 'completed' | 'skipped';
  questionIds: string[];
  answers: { questionId: string; choiceIndex: number | null; answeredAt: string }[];
}
export interface StudyTrack {
  id: string; revision: number; createdAt: string; updatedAt: string;
  catalog: StudyCatalog; config: TrackConfig; diagnostics: DiagnosticAttempt[];
}
export interface SaveStudyTrackInput {
  id?: string; expectedRevision?: number;
  catalog: StudyCatalog; config: TrackConfig; diagnostics: DiagnosticAttempt[];
}
