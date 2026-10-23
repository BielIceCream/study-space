import { z } from 'zod';
import type { StudyTrack } from '../study/types';
import type { PlannerBlock, PlannerWeek, SaveStudyPlannerInput, StudyPlanner } from './types';

const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0 && !value.includes('\0'), 'Texto vazio ou inválido.');
const id = text(400);
const unitId = text(160);
export const civilDateSchema = z.string().refine(value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, 'A data do planner é inválida.');
const utc = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'A data UTC é inválida.');
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const unique = (values: unknown[]) => new Set(values).size === values.length;
const issue = (context: z.RefinementCtx, message: string) => context.addIssue({ code: 'custom', message });
export function addCivilDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
}
export const weekdayFor = (date: string) => (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;

export const configSchema = z.object({
  days: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), minutes: z.number().int().min(1).max(720) }).strict()).min(1).max(7),
  blockMinutes: z.number().int().min(10).max(120), breakMinutes: z.number().int().min(0).max(30), mockMinutes: z.number().int().min(10).max(240),
  unitEstimates: z.array(z.object({ unitId, minutes: z.number().int().min(1).max(1440) }).strict()).max(512),
}).strict().superRefine((config, context) => {
  if (!unique(config.days.map(day => day.weekday)) || config.days.some(day => day.startMinute + day.minutes > 1440)) issue(context, 'Os dias precisam ser únicos e as janelas não podem atravessar a meia-noite.');
  if (!unique(config.unitEstimates.map(item => item.unitId))) issue(context, 'As estimativas de unidade estão repetidas.');
});

export const plannerBlockSchema = z.object({
  id, unitId: unitId.nullable(), kind: z.enum(['learn', 'practice', 'review', 'mock']),
  date: civilDateSchema, startMinute: z.number().int().min(0).max(1439), minutes: z.number().int().min(1).max(240), breakMinutes: z.number().int().min(0).max(30),
  status: z.enum(['pending', 'completed']), fixed: z.boolean(), completedAt: utc.nullable(), reason: text(2000),
}).strict().superRefine((block, context) => {
  if ((block.kind === 'mock') !== (block.unitId === null)) issue(context, 'Somente o simulado manual pode ficar sem unidade.');
  if ((block.status === 'completed') !== (block.completedAt !== null)) issue(context, 'A conclusão do bloco precisa de data, e um bloco pendente não pode estar concluído.');
  if (block.startMinute + block.minutes + block.breakMinutes > 1440) issue(context, 'O bloco e sua pausa não podem atravessar a meia-noite.');
});

export const plannerWeekSchema: z.ZodType<PlannerWeek> = z.object({
  weekStart: civilDateSchema, planId: id, generatedAt: utc, rulesVersion: z.literal(1),
  budgetMinutes: z.number().int().min(30).max(5040), config: configSchema, blocks: z.array(plannerBlockSchema).max(200),
}).strict().superRefine((week, context) => {
  if (weekdayFor(week.weekStart) !== 0) issue(context, 'A semana precisa começar em uma segunda-feira.');
  if (!unique(week.blocks.map(block => block.id))) issue(context, 'A semana contém blocos repetidos.');
  if (week.blocks.reduce((sum, block) => sum + block.minutes + block.breakMinutes, 0) > week.budgetMinutes) issue(context, 'Os blocos e pausas ultrapassam o orçamento semanal.');
  const end = addCivilDays(week.weekStart, 6);
  const byDate = new Map<string, PlannerWeek['blocks']>();
  for (const block of week.blocks) {
    if (block.date < week.weekStart || block.date > end) issue(context, 'O bloco está fora da semana.');
    const window = week.config.days.find(day => day.weekday === weekdayFor(block.date));
    if (block.status === 'pending' && (!window || block.startMinute < window.startMinute || block.startMinute + block.minutes + block.breakMinutes > window.startMinute + window.minutes)) issue(context, 'O bloco pendente não cabe na janela do dia.');
    const list = byDate.get(block.date) ?? []; list.push(block); byDate.set(block.date, list);
  }
  for (const blocks of byDate.values()) {
    blocks.sort((a, b) => a.startMinute - b.startMinute);
    if (blocks.some((block, index) => index > 0 && blocks[index - 1].startMinute + blocks[index - 1].minutes + blocks[index - 1].breakMinutes > block.startMinute)) issue(context, 'Há sobreposição de blocos ou pausas.');
  }
});
const weeksSchema = z.array(plannerWeekSchema).max(520).superRefine((weeks, context) => {
  if (!unique(weeks.map(week => week.weekStart))) issue(context, 'O planner contém semanas repetidas.');
  const blocks = weeks.flatMap(week => week.blocks);
  if (blocks.length > 10000 || !unique(blocks.map(block => block.id))) issue(context, 'O planner excede 10.000 blocos ou contém identificadores repetidos.');
});
const backlogSchema = z.array(plannerBlockSchema).max(10000).superRefine((blocks, context) => {
  if (blocks.some(block => block.status !== 'pending' || block.fixed || block.completedAt !== null)) issue(context, 'Pendências sem horário precisam estar pendentes e desfixadas.');
});
function refineCollection(weeks: PlannerWeek[], backlog: PlannerBlock[], context: z.RefinementCtx) {
  const blocks = [...weeks.flatMap(week => week.blocks), ...backlog];
  if (blocks.length > 10000 || !unique(blocks.map(block => block.id))) issue(context, 'A agenda e as pendências excedem o limite ou contêm o mesmo bloco mais de uma vez.');
}
const undoSchema = z.object({ previousWeeks: weeksSchema, previousBacklog: backlogSchema, acceptedPlanId: id }).strict().nullable();
function refineUndo(data: { weeks: PlannerWeek[]; backlog: PlannerBlock[]; undo: StudyPlanner['undo'] }, context: z.RefinementCtx) {
  refineCollection(data.weeks, data.backlog, context);
  if (!data.undo) return;
  refineCollection(data.undo.previousWeeks, data.undo.previousBacklog, context);
  if (!data.weeks.some(week => week.planId === data.undo!.acceptedPlanId)) issue(context, 'A proposta a desfazer não está no planner atual.');
  const current = new Map(data.weeks.flatMap(week => week.blocks).map(block => [block.id, block]));
  for (const block of data.undo.previousWeeks.flatMap(week => week.blocks)) {
    if ((block.status === 'completed' || block.fixed) && JSON.stringify(current.get(block.id)) !== JSON.stringify(block)) issue(context, 'Desfazer não pode alterar blocos concluídos ou fixos.');
  }
}
export const plannerSchema: z.ZodType<StudyPlanner> = z.object({
  trackId: unitId, revision, createdAt: utc, updatedAt: utc, config: configSchema, weeks: weeksSchema, backlog: backlogSchema, undo: undoSchema,
}).strict().superRefine((planner, context) => {
  refineUndo(planner, context);
  if (planner.createdAt > planner.updatedAt) issue(context, 'A atualização do planner antecede sua criação.');
});
export const savePlannerSchema: z.ZodType<SaveStudyPlannerInput> = z.object({
  trackId: unitId, expectedRevision: revision.optional(), config: configSchema, weeks: weeksSchema, backlog: backlogSchema, undo: undoSchema,
}).strict().superRefine(refineUndo);

export function validatePlannerLinks<T extends Pick<StudyPlanner, 'trackId' | 'config' | 'weeks' | 'backlog' | 'undo'>>(planner: T, snapshot: { studyTracks?: readonly StudyTrack[] }): T {
  const track = snapshot.studyTracks?.find(item => item.id === planner.trackId);
  if (!track) throw new Error('A trilha deste planner não existe.');
  const units = new Set(track.catalog.units.map(unit => unit.id));
  for (const config of [planner.config, ...planner.weeks.map(week => week.config), ...(planner.undo?.previousWeeks.map(week => week.config) ?? [])]) {
    if (config.unitEstimates.some(item => !units.has(item.unitId))) throw new Error('Uma estimativa aponta para uma unidade ausente do catálogo.');
  }
  for (const block of [...[...planner.weeks, ...(planner.undo?.previousWeeks ?? [])].flatMap(week => week.blocks), ...planner.backlog, ...(planner.undo?.previousBacklog ?? [])]) {
    if (block.unitId !== null && !units.has(block.unitId)) throw new Error('Um bloco aponta para uma unidade ausente do catálogo.');
  }
  return planner;
}

export function validatePlannerTransition(current: StudyPlanner, next: StudyPlanner): void {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (current.trackId !== next.trackId || current.createdAt !== next.createdAt || current.updatedAt > next.updatedAt) throw new Error('A identidade e a origem do planner devem ser preservadas.');
  const blocks = new Map(next.weeks.flatMap(week => week.blocks).map(block => [block.id, block]));
  let activityChanged = false;
  for (const old of [...current.weeks.flatMap(week => week.blocks), ...current.backlog]) {
    const block = blocks.get(old.id);
    if (old.status === 'completed' && !same(old, block)) throw new Error('Um bloco concluído não pode ser alterado ou removido.');
    if (old.fixed && (!block || !same({ ...old, fixed: block.fixed, status: block.status, completedAt: block.completedAt }, block))) throw new Error('Desfixe o bloco antes de mudar seu horário ou conteúdo.');
    if (block && (old.fixed !== block.fixed || old.status !== block.status)) activityChanged = true;
  }
  if (activityChanged && next.undo !== null) throw new Error('Registrar atividade ou fixar blocos deve encerrar a opção de desfazer a proposta anterior.');
}
