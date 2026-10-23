import type { ImportedNote, ImportBatchInput } from '../../services/import/types';
import type { PlannerBlock } from '../planner/types';
import type { StudyTrack } from '../study/types';

export interface PracticeContext { trackId: string; blockId: string }
export interface PracticeInput {
  kind: 'weekly' | 'writing';
  subjectId: string;
  trackId?: string;
  date: string;
  minutes: number;
  theme?: string;
  context?: PracticeContext;
}
export interface ResolvedPracticeContext { track: StudyTrack; block: PlannerBlock }
export interface PracticePreview {
  kind: PracticeInput['kind'];
  weekStart: string;
  instructions: string;
  answerKey: string;
  questionIds: string[];
  bankSize: number;
  warnings: string[];
  note: ImportedNote;
  batch: ImportBatchInput;
}
