import { z } from 'zod';
import type { SaveStudyTrackInput, StudyCatalog, StudyTrack } from './types';

const text = (max: number) => z.string().max(max).refine((value) => value.trim().length > 0 && !value.includes('\0'), 'Texto vazio ou inválido.');
const id = text(160);
const utc = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'Data UTC inválida.');
const day = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, 'Data da prova inválida.');
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
const unique = (items: string[]) => new Set(items).size === items.length;

export const catalogSchema = z.object({
  id, version: revision, title: text(180), description: text(4000), origin: text(500), license: text(120), demonstrative: z.literal(true),
  subjects: z.array(z.object({ id, name: text(120) }).strict()).min(1).max(32),
  competencies: z.array(z.object({ id, subjectId: id, title: text(180) }).strict()).min(1).max(256),
  units: z.array(z.object({ id, competencyId: id, title: text(180), summary: text(4000), prerequisites: z.array(id).max(512) }).strict()).min(1).max(512),
  questions: z.array(z.object({ id, competencyId: id, prompt: text(4000), choices: z.array(text(1000)).min(2).max(8), correctIndex: z.number().int().min(0), explanation: text(4000) }).strict()).min(1).max(2048),
}).strict().superRefine((catalog, context) => {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  for (const [name, items] of [['matérias', catalog.subjects], ['competências', catalog.competencies], ['unidades', catalog.units], ['questões', catalog.questions]] as const) {
    if (!unique(items.map((item) => item.id))) issue(`O catálogo contém identificadores repetidos em ${name}.`);
  }
  const subjects = new Set(catalog.subjects.map((subject) => subject.id));
  const competencies = new Set(catalog.competencies.map((competency) => competency.id));
  const units = new Map(catalog.units.map((unit) => [unit.id, unit]));
  if (catalog.competencies.some((competency) => !subjects.has(competency.subjectId))) issue('Uma competência aponta para uma matéria inexistente.');
  if (catalog.units.some((unit) => !competencies.has(unit.competencyId))) issue('Uma unidade aponta para uma competência inexistente.');
  if (catalog.questions.some((question) => !competencies.has(question.competencyId) || question.correctIndex >= question.choices.length)) issue('Uma questão contém competência ou resposta inválida.');
  if (catalog.units.some((unit) => !unique(unit.prerequisites) || unit.prerequisites.some((ref) => !units.has(ref)))) issue('Uma unidade contém pré-requisito inexistente ou repetido.');
  // Kahn's algorithm keeps validation bounded even for long or hostile imported graphs.
  const degrees = new Map(catalog.units.map((unit) => [unit.id, unit.prerequisites.length]));
  const successors = new Map<string, string[]>();
  for (const unit of catalog.units) for (const prerequisite of unit.prerequisites) {
    const list = successors.get(prerequisite) ?? [];
    list.push(unit.id); successors.set(prerequisite, list);
  }
  const ready = catalog.units.filter((unit) => unit.prerequisites.length === 0).map((unit) => unit.id);
  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    visited++;
    for (const successor of successors.get(ready[index]) ?? []) {
      const degree = (degrees.get(successor) ?? 0) - 1;
      degrees.set(successor, degree);
      if (degree === 0) ready.push(successor);
    }
  }
  if (visited !== catalog.units.length) issue('O catálogo contém um ciclo de pré-requisitos.');
});

const configSchema = z.object({
  name: text(120), objective: text(300), startingYear: z.enum(['fundamental', 'medio-1', 'medio-2', 'medio-3', 'concluido']),
  subjectIds: z.array(id).min(1).max(32),
  difficulties: z.array(z.object({ subjectId: id, level: z.enum(['unknown', 'low', 'medium', 'high']) }).strict()).max(32),
  examDate: day.nullable(), weeklyMinutes: z.number().int().min(30).max(5040),
  intensity: z.enum(['light', 'balanced', 'intensive']), pace: z.enum(['gradual', 'regular', 'accelerated']),
  reviewEveryDays: z.number().int().min(1).max(90), mockEveryWeeks: z.number().int().min(1).max(26),
  bindings: z.array(z.object({ unitId: id, subjectId: id, noteIds: z.array(id).max(500) }).strict()).max(512),
}).strict();

const attemptSchema = z.object({
  id, startedAt: utc, updatedAt: utc, status: z.enum(['in-progress', 'completed', 'skipped']),
  questionIds: z.array(id).min(1).max(2048),
  answers: z.array(z.object({ questionId: id, choiceIndex: z.number().int().min(0).nullable(), answeredAt: utc }).strict()).max(2048),
}).strict();

function refineStudy(data: Pick<StudyTrack, 'catalog' | 'config' | 'diagnostics'>, context: z.RefinementCtx): void {
  const issue = (message: string) => context.addIssue({ code: 'custom', message });
  const { catalog, config, diagnostics } = data;
  const subjects = new Set(catalog.subjects.map((subject) => subject.id));
  const selected = new Set(config.subjectIds);
  const competencies = new Map(catalog.competencies.map((competency) => [competency.id, competency]));
  const units = new Map(catalog.units.map((unit) => [unit.id, unit]));
  const questions = new Map(catalog.questions.map((question) => [question.id, question]));
  if (!unique(config.subjectIds) || config.subjectIds.some((ref) => !subjects.has(ref))) issue('Selecione matérias únicas que existam no catálogo.');
  if (!unique(config.difficulties.map((item) => item.subjectId)) || config.difficulties.some((item) => !selected.has(item.subjectId))) issue('As dificuldades precisam se referir às matérias selecionadas, sem repetição.');
  if (!unique(config.bindings.map((binding) => binding.unitId))) issue('Uma unidade tem mais de um vínculo com a biblioteca.');
  for (const binding of config.bindings) {
    const unit = units.get(binding.unitId);
    if (!unit || !selected.has(competencies.get(unit.competencyId)?.subjectId ?? '')) issue('O vínculo precisa apontar para uma unidade de uma matéria selecionada.');
    if (!unique(binding.noteIds)) issue('Um vínculo contém notas repetidas.');
  }
  if (!unique(diagnostics.map((attempt) => attempt.id))) issue('O diagnóstico contém tentativas repetidas.');
  if (diagnostics.filter((attempt) => attempt.status === 'in-progress').length > 1) issue('Conclua ou encerre o diagnóstico em andamento antes de iniciar outro.');
  for (const attempt of diagnostics) {
    if (attempt.startedAt > attempt.updatedAt) issue('A atualização do diagnóstico antecede seu início.');
    const questionIds = new Set(attempt.questionIds);
    if (!unique(attempt.questionIds) || attempt.questionIds.some((ref) => !questions.has(ref))) issue('O diagnóstico contém questões inexistentes ou repetidas.');
    if (!unique(attempt.answers.map((answer) => answer.questionId))) issue('Uma questão foi respondida mais de uma vez na mesma tentativa.');
    for (const answer of attempt.answers) {
      const question = questions.get(answer.questionId);
      if (!questionIds.has(answer.questionId) || !question || (answer.choiceIndex !== null && answer.choiceIndex >= question.choices.length)) issue('O diagnóstico contém uma resposta inválida.');
      if (answer.answeredAt < attempt.startedAt || answer.answeredAt > attempt.updatedAt) issue('A data de uma resposta está fora da duração do diagnóstico.');
    }
    if (attempt.status === 'completed' && attempt.answers.length !== attempt.questionIds.length) issue('Um diagnóstico concluído precisa registrar uma resposta ou pulo para cada questão.');
    if (attempt.status === 'in-progress' && attempt.answers.length >= attempt.questionIds.length) issue('Um diagnóstico totalmente respondido precisa estar concluído.');
  }
}

export const studyTrackSchema: z.ZodType<StudyTrack> = z.object({
  id, revision, createdAt: utc, updatedAt: utc, catalog: catalogSchema, config: configSchema, diagnostics: z.array(attemptSchema).max(200),
}).strict().superRefine((track, context) => {
  refineStudy(track, context);
  if (track.createdAt > track.updatedAt) context.addIssue({ code: 'custom', message: 'A atualização da trilha antecede sua criação.' });
});

export const saveStudyTrackSchema: z.ZodType<SaveStudyTrackInput> = z.object({
  id: id.optional(), expectedRevision: revision.optional(), catalog: catalogSchema, config: configSchema, diagnostics: z.array(attemptSchema).max(200),
}).strict().superRefine((input, context) => {
  refineStudy(input, context);
  if ((input.id === undefined) !== (input.expectedRevision === undefined)) context.addIssue({ code: 'custom', message: 'Ao editar uma trilha, informe seu identificador e revisão.' });
});

/** Only library IDs belong here; catalogs must remain free of student content. */
export function validateStudyLinks<T extends Pick<StudyTrack, 'catalog' | 'config' | 'diagnostics'>>(track: T, snapshot: {
  subjects: readonly { id: string }[];
  notes: readonly { id: string; subjectId: string }[];
}): T {
  const subjects = new Set(snapshot.subjects.map((subject) => subject.id));
  const notes = new Map(snapshot.notes.map((note) => [note.id, note]));
  for (const binding of track.config.bindings) {
    if (!subjects.has(binding.subjectId)) throw new Error('A matéria vinculada à trilha não existe na biblioteca.');
    if (binding.noteIds.some((noteId) => notes.get(noteId)?.subjectId !== binding.subjectId)) throw new Error('Uma nota vinculada não existe ou pertence a outra matéria.');
  }
  return track;
}

export function validateCatalog(input: unknown): StudyCatalog { return catalogSchema.parse(input); }

/** Edits can add evidence, never rewrite the student's saved history. */
export function validateStudyTransition(current: StudyTrack, next: StudyTrack): void {
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  if (current.id !== next.id || current.createdAt !== next.createdAt || current.updatedAt > next.updatedAt) throw new Error('A identidade e a data de criação da trilha devem ser preservadas.');
  if (!same(current.catalog, next.catalog)) throw new Error('O catálogo de uma trilha salva é imutável. Crie outra trilha para usar uma versão diferente.');
  const attempts = new Map(next.diagnostics.map((attempt) => [attempt.id, attempt]));
  for (const previous of current.diagnostics) {
    const attempt = attempts.get(previous.id);
    if (!attempt || attempt.startedAt !== previous.startedAt || !same(attempt.questionIds, previous.questionIds) || attempt.updatedAt < previous.updatedAt) throw new Error('O histórico e as questões de um diagnóstico salvo devem ser preservados.');
    if (previous.status === 'completed' && !same(previous, attempt)) throw new Error('Um diagnóstico concluído não pode ser alterado.');
    const answers = new Map(attempt.answers.map((answer) => [answer.questionId, answer]));
    if (previous.answers.some((answer) => !same(answer, answers.get(answer.questionId)))) throw new Error('As respostas salvas não podem ser removidas ou alteradas. Inicie uma nova tentativa.');
  }
}
