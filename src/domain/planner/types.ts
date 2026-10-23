/** Civil dates/times are local study slots, not UTC instants. */
export interface PlannerConfig {
  days: { weekday: number; startMinute: number; minutes: number }[];
  blockMinutes: number; breakMinutes: number; mockMinutes: number;
  unitEstimates: { unitId: string; minutes: number }[];
}
export interface PlannerBlock {
  id: string; unitId: string | null;
  kind: 'learn' | 'practice' | 'review' | 'mock';
  date: string; startMinute: number; minutes: number; breakMinutes: number;
  status: 'pending' | 'completed'; fixed: boolean;
  completedAt: string | null; reason: string;
}
export interface PlannerWeek {
  weekStart: string; planId: string; generatedAt: string;
  rulesVersion: 1; budgetMinutes: number; config: PlannerConfig;
  blocks: PlannerBlock[];
}
export interface StudyPlanner {
  trackId: string; revision: number; createdAt: string; updatedAt: string;
  config: PlannerConfig; weeks: PlannerWeek[];
  /** Unscheduled work; date/time retain origin for explanation only. */
  backlog: PlannerBlock[];
  undo: { previousWeeks: PlannerWeek[]; previousBacklog: PlannerBlock[]; acceptedPlanId: string } | null;
}
export interface SaveStudyPlannerInput {
  trackId: string; expectedRevision?: number;
  config: PlannerConfig; weeks: PlannerWeek[]; backlog: PlannerBlock[];
  undo: StudyPlanner['undo'];
}
export interface PlannerPreview {
  week: PlannerWeek; otherWeeks: PlannerWeek[]; backlog: PlannerBlock[];
  unallocatedMinutes: number; warnings: string[];
  movedCount: number; canAccept: boolean;
}
export interface PlannerClock { date: string; minute: number; iso: string }
