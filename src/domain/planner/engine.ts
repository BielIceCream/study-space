import { assessCompetencies } from '../study/engine';
import type { StudyTrack } from '../study/types';
import type { PlannerBlock, PlannerClock, PlannerConfig, PlannerPreview, PlannerWeek, SaveStudyPlannerInput, StudyPlanner } from './types';
import { addCivilDays, civilDateSchema, configSchema, plannerWeekSchema, savePlannerSchema, weekdayFor } from './validation';

export function plannerClock(date: Date = new Date()): PlannerClock {
  const pad = (value: number) => String(value).padStart(2, '0');
  return { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`, minute: date.getHours() * 60 + date.getMinutes(), iso: date.toISOString() };
}
export function weekStartFor(date: string): string { civilDateSchema.parse(date); return addCivilDays(date, -weekdayFor(date)); }
export function defaultPlannerConfig(track: StudyTrack): PlannerConfig {
  return { days: [0, 1, 2, 3, 4].map(weekday => ({ weekday, startMinute: 19 * 60, minutes: 90 })), blockMinutes: 25, breakMinutes: 5, mockMinutes: 30, unitEstimates: track.catalog.units.map(unit => ({ unitId: unit.id, minutes: 50 })) };
}
const total = (block: PlannerBlock) => block.minutes + block.breakMinutes;
const absolute = (date: string, minute: number) => Date.parse(`${date}T00:00:00.000Z`) / 60000 + minute;
function hash(value: string): string {
  let first = 2166136261; let second = 2246822519;
  for (let i = 0; i < value.length; i++) { first = Math.imul(first ^ value.charCodeAt(i), 16777619); second = Math.imul(second ^ value.charCodeAt(i), 3266489917); }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
const sortedBlocks = (blocks: PlannerBlock[]) => blocks.sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute || a.id.localeCompare(b.id));
const selectedUnits = (track: StudyTrack) => {
  const selected = new Set(track.config.subjectIds);
  const competencies = new Map(track.catalog.competencies.map(item => [item.id, item]));
  return track.catalog.units.filter(unit => selected.has(competencies.get(unit.competencyId)?.subjectId ?? ''));
};
type Job = { block: PlannerBlock; carried: boolean };

/** One bounded week, deterministic for the same input. Activity never grants mastery. */
export function buildPreview(track: StudyTrack, planner: StudyPlanner | undefined, rawConfig: PlannerConfig, weekStart: string, clock: PlannerClock): PlannerPreview {
  const config = configSchema.parse(rawConfig);
  civilDateSchema.parse(clock.date); civilDateSchema.parse(weekStart);
  if (!Number.isInteger(clock.minute) || clock.minute < 0 || clock.minute > 1439 || !Number.isFinite(Date.parse(clock.iso))) throw new Error('O relógio do planner é inválido.');
  if (weekdayFor(weekStart) !== 0) throw new Error('Escolha uma semana que começa na segunda-feira.');
  if (planner && planner.trackId !== track.id) throw new Error('O planner pertence a outra trilha.');
  const end = addCivilDays(weekStart, 6);
  const localOffsetMinutes = absolute(clock.date, clock.minute) - Math.floor(Date.parse(clock.iso) / 60000);
  const dateOfInstant = (iso: string) => new Date(Date.parse(iso) + localOffsetMinutes * 60000).toISOString().slice(0, 10);
  const reviewDue = new Map<string, string>();
  const warnings: string[] = [];
  const units = selectedUnits(track);
  const selected = new Set(units.map(unit => unit.id));
  const unitMap = new Map(track.catalog.units.map(unit => [unit.id, unit]));
  const evidence = new Map(assessCompetencies(track, new Date(clock.iso)).map(item => [item.competencyId, item]));
  const estimates = new Map(track.catalog.units.map(unit => [unit.id, config.unitEstimates.find(item => item.unitId === unit.id)?.minutes ?? 50]));
  const oldWeeks = structuredClone(planner?.weeks ?? []);
  const target = oldWeeks.find(week => week.weekStart === weekStart);
  const all = oldWeeks.flatMap(week => week.blocks);
  const backlog = structuredClone(planner?.backlog ?? []);
  const movable = (block: PlannerBlock) => block.status === 'pending' && !block.fixed && (block.unitId === null || selected.has(block.unitId));
  const candidates = all.filter(block => movable(block) && (block.date < clock.date || (block.date >= weekStart && block.date <= end)) && block.date <= end);
  const candidateIds = new Set(candidates.map(block => block.id));
  const fromBacklog = backlog.filter(movable);
  const fromBacklogIds = new Set(fromBacklog.map(block => block.id));
  const jobs: Job[] = [...candidates, ...fromBacklog].map(block => ({ block: { ...block, breakMinutes: config.breakMinutes }, carried: true }));
  const seenJobs = new Set(jobs.map(job => job.block.id));
  const kept = (target?.blocks ?? []).filter(block => !candidateIds.has(block.id));
  const remainingOtherWeeks = oldWeeks.filter(week => week.weekStart !== weekStart).map(week => ({ ...week, blocks: week.blocks.filter(block => !candidateIds.has(block.id)) }));
  // Retain empty historical week records; accepting never silently deletes metadata.
  const queuedAndReserved = [...all, ...backlog];
  const add = (id: string, unitId: string | null, kind: PlannerBlock['kind'], minutes: number, reason: string) => {
    if (seenJobs.has(id) || queuedAndReserved.some(block => block.id === id)) return;
    seenJobs.add(id); jobs.push({ carried: false, block: { id, unitId, kind, date: weekStart, startMinute: 0, minutes, breakMinutes: config.breakMinutes, status: 'pending', fixed: false, completedAt: null, reason } });
  };
  for (const unit of units) {
    const existingLearn = queuedAndReserved.filter(block => block.unitId === unit.id && block.kind === 'learn').reduce((sum, block) => sum + block.minutes, 0);
    let missing = Math.max(0, estimates.get(unit.id)! - existingLearn);
    let offset = existingLearn;
    while (missing > 0) {
      const minutes = Math.min(config.blockMinutes, missing);
      add(`learn:${unit.id}:${offset}`, unit.id, 'learn', minutes, `Aprendizagem de “${unit.title}”. ${evidence.get(unit.competencyId)?.status === 'needs-practice' ? 'O diagnóstico sugere reforçar a base.' : 'Fundamentos organizados por pré-requisitos.'} Duração estimada por você; concluir o bloco registra atividade, não domínio.`);
      offset += minutes; missing -= minutes;
    }
    if (!queuedAndReserved.some(block => block.unitId === unit.id && block.kind === 'practice' && (block.status === 'pending' || (block.date >= weekStart && block.date <= end)))) {
      add(`practice:${unit.id}:${weekStart}`, unit.id, 'practice', config.blockMinutes, `Prática manual de “${unit.title}” com seus materiais. Registre dúvidas e correções nas notas.`);
    }
    const lastReview = queuedAndReserved.filter(block => block.unitId === unit.id && block.status === 'completed' && (block.kind === 'review' || block.kind === 'learn')).map(block => dateOfInstant(block.completedAt!));
    const answeredAt = evidence.get(unit.competencyId)?.lastAnsweredAt;
    const baseline = [...lastReview, ...(answeredAt ? [dateOfInstant(answeredAt)] : [])].sort().at(-1);
    if (baseline) reviewDue.set(unit.id, addCivilDays(baseline, track.config.reviewEveryDays));
    if (baseline && addCivilDays(baseline, track.config.reviewEveryDays) <= end && !queuedAndReserved.some(block => block.unitId === unit.id && block.kind === 'review' && (block.status === 'pending' || (block.date >= weekStart && block.date <= end)))) {
      add(`review:${unit.id}:${weekStart}`, unit.id, 'review', Math.min(config.blockMinutes, 20), `Revisão manual de “${unit.title}”: intervalo configurado de ${track.config.reviewEveryDays} dias desde a última evidência/atividade. Não é agendamento SRS dos cartões.`);
    }
  }
  const lastMock = all.filter(block => block.kind === 'mock' && block.status === 'completed').map(block => dateOfInstant(block.completedAt!)).sort().at(-1);
  const mockDue = lastMock ? addCivilDays(lastMock, track.config.mockEveryWeeks * 7) : null;
  if (!queuedAndReserved.some(block => block.kind === 'mock' && (block.status === 'pending' || (block.date >= weekStart && block.date <= end))) && (!lastMock || addCivilDays(lastMock, track.config.mockEveryWeeks * 7) <= end)) {
    add(`mock:${weekStart}`, null, 'mock', config.mockMinutes, `Simulado manual reservado no orçamento. Frequência desejada: ${track.config.mockEveryWeeks} semana(s). Escolha questões/material; a geração de provas será adicionada depois.`);
  }
  const depths = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (depths.has(id)) return depths.get(id)!;
    if (seen.has(id)) return 0;
    const next = new Set(seen); next.add(id);
    const result = Math.max(-1, ...(unitMap.get(id)?.prerequisites ?? []).map(ref => depth(ref, next))) + 1;
    depths.set(id, result); return result;
  };
  const score = (block: PlannerBlock) => {
    if (block.kind === 'mock') return -100;
    if (block.kind === 'review') return -50;
    const unit = unitMap.get(block.unitId!);
    return depth(block.unitId!) * 10 + (block.kind === 'practice' ? 3 : 0) + (unit && evidence.get(unit.competencyId)?.status === 'needs-practice' ? -1 : 0);
  };
  jobs.sort((a, b) => score(a.block) - score(b.block) || Number(b.carried) - Number(a.carried) || a.block.id.localeCompare(b.block.id));
  const blocks = structuredClone(kept);
  const learnTotals = new Map<string, number>(); const releases = new Map<string, number>();
  for (const block of all) if (block.kind === 'learn' && block.unitId && block.status === 'completed') learnTotals.set(block.unitId, (learnTotals.get(block.unitId) ?? 0) + block.minutes);
  for (const block of kept) if (block.kind === 'learn' && block.unitId && block.status === 'pending') {
    learnTotals.set(block.unitId, (learnTotals.get(block.unitId) ?? 0) + block.minutes);
    releases.set(block.unitId, Math.max(releases.get(block.unitId) ?? 0, absolute(block.date, block.startMinute + total(block))));
  }
  let used = blocks.reduce((sum, block) => sum + total(block), 0);
  const place = (block: PlannerBlock, earliest: number): PlannerBlock | null => {
    if (used + total(block) > track.config.weeklyMinutes || blocks.length >= 200) return null;
    for (let offset = 0; offset < 7; offset++) {
      const date = addCivilDays(weekStart, offset); if (date < clock.date) continue;
      const window = config.days.find(day => day.weekday === offset); if (!window) continue;
      let start = Math.max(window.startMinute, date === clock.date ? clock.minute : 0, Math.ceil(earliest - absolute(date, 0)));
      const busy = blocks.filter(item => item.date === date).sort((a, b) => a.startMinute - b.startMinute);
      for (const item of busy) {
        if (start + total(block) <= item.startMinute) break;
        if (start < item.startMinute + total(item)) start = item.startMinute + total(item);
      }
      if (start + total(block) <= window.startMinute + window.minutes) return { ...block, date, startMinute: start };
    }
    return null;
  };
  const remaining = [...jobs]; let movedCount = 0;
  // Each pass either schedules a job or stops; at most 10k bounded stored blocks.
  let changed = true;
  while (changed && remaining.length) {
    changed = false;
    for (let index = 0; index < remaining.length;) {
      const job = remaining[index]; const unit = job.block.unitId ? unitMap.get(job.block.unitId) : undefined;
      const due = job.block.kind === 'review' ? reviewDue.get(job.block.unitId!) : job.block.kind === 'mock' ? mockDue : null;
      let earliest = due ? absolute(due, 0) : 0; let eligible = true;
      for (const prerequisite of unit?.prerequisites ?? []) {
        const source = unitMap.get(prerequisite)!;
        if (evidence.get(source.competencyId)?.status !== 'initial-evidence' && (learnTotals.get(prerequisite) ?? 0) < estimates.get(prerequisite)!) { eligible = false; break; }
        earliest = Math.max(earliest, releases.get(prerequisite) ?? 0);
      }
      if (job.block.kind === 'practice' && unit && evidence.get(unit.competencyId)?.status !== 'initial-evidence' && (learnTotals.get(unit.id) ?? 0) < estimates.get(unit.id)!) eligible = false;
      if (unit && job.block.kind !== 'review') earliest = Math.max(earliest, releases.get(unit.id) ?? 0);
      const scheduled = eligible ? place(job.block, earliest) : null;
      if (!scheduled) { index++; continue; }
      blocks.push(scheduled); used += total(scheduled);
      if (job.carried && (scheduled.date !== job.block.date || scheduled.startMinute !== job.block.startMinute)) movedCount++;
      if (scheduled.kind === 'learn' && scheduled.unitId) {
        learnTotals.set(scheduled.unitId, (learnTotals.get(scheduled.unitId) ?? 0) + scheduled.minutes);
        releases.set(scheduled.unitId, absolute(scheduled.date, scheduled.startMinute + total(scheduled)));
      }
      remaining.splice(index, 1); changed = true;
    }
  }
  const unallocatedMinutes = remaining.reduce((sum, job) => sum + total(job.block), 0);
  const proposedBacklog = [...backlog.filter(block => !fromBacklogIds.has(block.id)), ...remaining.map(job => ({ ...job.block, reason: job.carried ? job.block.reason : `${job.block.reason} Sem horário: aguardando disponibilidade.` }))];
  if (unallocatedMinutes) warnings.push(`${unallocatedMinutes} min de estudo e pausas ficaram sem horário. Reduza o escopo, ajuste as estimativas ou amplie a disponibilidade; as pendências ficam guardadas, sem concentrar tudo amanhã.`);
  if (clock.date > end) warnings.push('Esta semana já terminou. Escolha uma semana atual ou futura para distribuir pendências.');
  if (kept.some(block => block.fixed && block.status === 'pending' && block.date < clock.date)) warnings.push('Há blocos fixos atrasados. Desfixe-os para permitir reagendamento; seus horários foram preservados.');
  if (track.config.examDate) {
    const firstWeek = weekStartFor(clock.date), lastWeek = weekStartFor(track.config.examDate);
    const capacityIn = (monday: string) => Math.min(track.config.weeklyMinutes, config.days.reduce((sum, day) => {
      const date = addCivilDays(monday, day.weekday);
      if (date < clock.date || date > track.config.examDate!) return sum;
      return sum + Math.max(0, day.startMinute + day.minutes - Math.max(day.startMinute, date === clock.date ? clock.minute : 0));
    }, 0));
    const fullWeeks = Math.max(0, (Date.parse(`${lastWeek}T00:00:00Z`) - Date.parse(`${firstWeek}T00:00:00Z`)) / (7 * 86400000) - 1);
    const futureCapacity = track.config.examDate < clock.date ? 0 : capacityIn(firstWeek) + (lastWeek === firstWeek ? 0 : capacityIn(lastWeek)) + fullWeeks * Math.min(track.config.weeklyMinutes, config.days.reduce((sum, day) => sum + day.minutes, 0));
    const remainingLearning = units.reduce((sum, unit) => sum + Math.max(0, estimates.get(unit.id)! - all.filter(block => block.unitId === unit.id && block.kind === 'learn' && block.status === 'completed').reduce((count, block) => count + block.minutes, 0)), 0);
    if (remainingLearning > futureCapacity) warnings.push(`Até a data da prova, a estimativa mínima de aprendizagem excede a capacidade em pelo menos ${remainingLearning - futureCapacity} min. Prática, revisões, simulados e pausas também precisam de tempo. Ajuste prazo, escopo ou disponibilidade.`);
  }
  const week: PlannerWeek = { weekStart, planId: '', generatedAt: clock.iso, rulesVersion: 1, budgetMinutes: track.config.weeklyMinutes, config, blocks: sortedBlocks(blocks) };
  week.planId = `plan:${weekStart}:${hash(JSON.stringify({ config, budget: week.budgetMinutes, blocks: week.blocks, backlog: proposedBacklog, otherWeeks: remainingOtherWeeks }))}`;
  const canAccept = plannerWeekSchema.safeParse(week).success && [...remainingOtherWeeks.flatMap(item => item.blocks), ...week.blocks, ...proposedBacklog].length <= 10000 && remainingOtherWeeks.length < 520;
  if (!canAccept) warnings.push('Blocos preservados não cabem nas novas janelas ou no orçamento. Ajuste a disponibilidade ou desfixe os pendentes antes de aceitar.');
  // Reserve jobs outside the target week: they stay untouched and were excluded
  // from workload generation, so future accepted study never gets duplicated.
  return { week, otherWeeks: remainingOtherWeeks, backlog: proposedBacklog, unallocatedMinutes, warnings, movedCount, canAccept };
}

function inputOf(planner: StudyPlanner): SaveStudyPlannerInput {
  return { trackId: planner.trackId, expectedRevision: planner.revision, config: structuredClone(planner.config), weeks: structuredClone(planner.weeks), backlog: structuredClone(planner.backlog), undo: null };
}
export function acceptPreview(trackId: string, planner: StudyPlanner | undefined, config: PlannerConfig, preview: PlannerPreview): SaveStudyPlannerInput {
  if (!preview.canAccept) throw new Error('Ajuste os conflitos da prévia antes de aceitar.');
  if (planner?.weeks.some(week => week.planId === preview.week.planId)) return { ...inputOf(planner), undo: structuredClone(planner.undo) };
  const value: SaveStudyPlannerInput = { trackId, ...(planner ? { expectedRevision: planner.revision } : {}), config: structuredClone(config), weeks: [...structuredClone(preview.otherWeeks), structuredClone(preview.week)].sort((a, b) => a.weekStart.localeCompare(b.weekStart)), backlog: structuredClone(preview.backlog), undo: { previousWeeks: structuredClone(planner?.weeks ?? []), previousBacklog: structuredClone(planner?.backlog ?? []), acceptedPlanId: preview.week.planId } };
  return savePlannerSchema.parse(value);
}
export function completeBlock(planner: StudyPlanner, blockId: string, iso: string): SaveStudyPlannerInput {
  const result = inputOf(planner); const block = result.weeks.flatMap(week => week.blocks).find(item => item.id === blockId);
  if (!block) throw new Error('O bloco não está na agenda.');
  if (block.status === 'completed') return result;
  block.status = 'completed'; block.completedAt = iso;
  return savePlannerSchema.parse(result);
}
export function toggleFixed(planner: StudyPlanner, blockId: string): SaveStudyPlannerInput {
  const result = inputOf(planner); const block = result.weeks.flatMap(week => week.blocks).find(item => item.id === blockId);
  if (!block || block.status === 'completed') throw new Error('Somente blocos pendentes podem ser fixados ou desfixados.');
  block.fixed = !block.fixed; return savePlannerSchema.parse(result);
}
export function undoPreview(planner: StudyPlanner): SaveStudyPlannerInput {
  if (!planner.undo) throw new Error('Não há proposta disponível para desfazer.');
  return savePlannerSchema.parse({ ...inputOf(planner), weeks: structuredClone(planner.undo.previousWeeks), backlog: structuredClone(planner.undo.previousBacklog) });
}
