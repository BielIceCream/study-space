import type { Snapshot, Note } from '../../shared/types';
import { textDocument } from '../../services/import/text';
import { civilDateSchema } from '../planner/validation';
import { weekStartFor } from '../planner/engine';
import type { StudyTrack } from '../study/types';
import type { PracticeContext, PracticeInput, PracticePreview, ResolvedPracticeContext } from './types';

const QUESTION_MINUTES = 5;
const MAX_QUESTIONS = 20;

/** Only an accepted, still pending mock slot can constrain an activity. */
export function resolvePracticeContext(data: Snapshot, context: PracticeContext): ResolvedPracticeContext {
  const track = data.studyTracks?.find(item => item.id === context.trackId);
  const planner = data.studyPlanners?.find(item => item.trackId === context.trackId);
  const block = planner?.weeks.flatMap(week => week.blocks).find(item => item.id === context.blockId);
  if (!track || !block || block.kind !== 'mock' || block.status !== 'pending') {
    throw new Error('Este simulado não está mais pendente em uma semana aceita. Volte ao planner para conferir os blocos.');
  }
  return { track, block };
}

function questionPool(track: StudyTrack | undefined, subjectId: string) {
  if (!track) return [];
  const selectedSubjects = new Set(track.config.subjectIds);
  const selectedCompetencies = new Set(track.catalog.competencies.filter(item => selectedSubjects.has(item.subjectId)).map(item => item.id));
  const units = new Map(track.catalog.units.map(unit => [unit.id, unit]));
  const boundCompetencies = new Set(track.config.bindings.filter(binding => binding.subjectId === subjectId).map(binding => units.get(binding.unitId)?.competencyId).filter((id): id is string => !!id && selectedCompetencies.has(id)));
  return track.catalog.questions.filter(question => boundCompetencies.has(question.competencyId));
}

function seedFor(value: string): number {
  let seed = 2166136261;
  for (let index = 0; index < value.length; index++) seed = Math.imul(seed ^ value.charCodeAt(index), 16777619);
  return seed >>> 0;
}

/** A local, reproducible shuffle. It never changes the source catalog. */
function sample<T extends { id: string }>(pool: T[], count: number, key: string): T[] {
  const ordered = [...pool].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  let state = seedFor(key);
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  for (let index = ordered.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
  }
  return ordered.slice(0, count);
}

const RUBRIC = [
  ['Tema e propósito', 'Meu texto responde ao tema e apresenta um ponto de vista?'],
  ['Argumentos e evidências', 'Cada argumento tem uma explicação, exemplo ou fonte verificável?'],
  ['Organização', 'Introdução, desenvolvimento e conclusão formam uma sequência compreensível?'],
  ['Coesão', 'As ideias se conectam e os referentes ficam claros?'],
  ['Clareza e revisão', 'Revisei ambiguidades, escolha de palavras, ortografia e pontuação?'],
];

/** Produces one ordinary note. No answers, scores, diagnostics or schedules are written. */
export function buildPracticePreview(data: Snapshot, input: PracticeInput): PracticePreview {
  if (input.kind !== 'weekly' && input.kind !== 'writing') throw new Error('Escolha um tipo de atividade.');
  const subject = data.subjects.find(item => item.id === input.subjectId);
  if (!subject) throw new Error('Escolha uma matéria existente na biblioteca.');
  if (!civilDateSchema.safeParse(input.date).success || input.date < '2000-01-01' || input.date > '2100-12-31') throw new Error('Escolha uma data válida entre 2000 e 2100.');
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 240) throw new Error('Escolha uma duração inteira de 1 a 240 minutos.');
  const context = input.context ? resolvePracticeContext(data, input.context) : undefined;
  const track = input.trackId ? data.studyTracks?.find(item => item.id === input.trackId) : undefined;
  if (input.trackId && !track) throw new Error('A trilha selecionada não está mais disponível.');
  if (context && (input.trackId !== context.track.id || input.date !== context.block.date || input.minutes > context.block.minutes)) {
    throw new Error(`A atividade precisa usar a trilha e a data do bloco, com até ${context.block.minutes} minutos.`);
  }
  const weekStart = weekStartFor(input.date);
  const title = `${input.kind === 'weekly' ? 'Prova semanal' : 'Redação'} · ${weekStart} · ${subject.name}`.slice(0, 180);
  const header = [title, `Matéria: ${subject.name}`, `Data escolhida: ${input.date} · Semana de ${weekStart}`, `Duração estimada: ${input.minutes} minutos`, track ? `Trilha: ${track.config.name}` : 'Trilha: atividade independente'];
  if (context) header.push(`Bloco do planner: ${context.block.id}. Concluir esta nota não conclui o bloco automaticamente.`);
  const warnings: string[] = [];
  let instructions: string;
  let answerKey = '';
  let questionIds: string[] = [];
  let bankSize = 0;
  if (input.kind === 'weekly') {
    const pool = questionPool(track, subject.id);
    bankSize = pool.length;
    const count = Math.min(MAX_QUESTIONS, Math.floor(input.minutes / QUESTION_MINUTES));
    const questions = sample(pool, count, `${weekStart}|${subject.id}|${track?.id ?? ''}|${track?.catalog.id ?? ''}|${track?.catalog.version ?? ''}`);
    questionIds = questions.map(question => question.id);
    const coverage = 'Amostra demonstrativa de estudo. Não é uma prova oficial nem cobre o currículo do ENEM. As questões podem se repetir em outras semanas e já ter aparecido no diagnóstico.';
    warnings.push(coverage);
    if (questions.length < count && questions.length) warnings.push(`O banco vinculado tem ${pool.length} questões. Foram usadas ${questions.length}, sem repetir questões nesta atividade; use o tempo restante para revisar e registrar dúvidas.`);
    if (!questions.length) warnings.push(pool.length ? 'A duração escolhida não comporta uma questão de 5 minutos. O roteiro será manual.' : 'Nenhuma questão vinculada explicitamente a esta matéria nas disciplinas selecionadas. O roteiro será manual; vincule materiais na trilha para usar o banco.');
    const source = track ? [`Catálogo: ${track.catalog.title} · ${track.catalog.id} · versão ${track.catalog.version}`, `Origem: ${track.catalog.origin}`, `Licença: ${track.catalog.license}`, 'Conteúdo demonstrativo original, sem IA.'] : ['Roteiro manual original do StudySpace. Nenhuma questão foi gerada.'];
    const body = questions.length ? questions.flatMap((question, index) => [
      `${index + 1}. ${question.prompt}`,
      ...question.choices.map((choice, choiceIndex) => `${String.fromCharCode(65 + choiceIndex)}) ${choice}`),
      'Minha resposta: __________', 'Raciocínio ou dúvida: __________', '',
    ]) : ['1. Escolha questões nos seus materiais e registre a origem e a página.', '2. Resolva sem consultar a correção, respeitando o tempo disponível.', '3. Confira com o gabarito da fonte e registre o que precisa retomar.', '', 'Minhas questões e fontes: __________', 'Minhas respostas: __________'];
    instructions = [...header, '', 'PROVA SEMANAL · AUTOCORREÇÃO MANUAL', coverage, `Questões desta atividade: ${questions.length} · Estimativa: ${QUESTION_MINUTES} minutos por questão; ajuste seu ritmo.`, ...source, '', 'Resolva antes de consultar a seção final. Respostas e resultados são registros manuais nesta nota; não alteram o diagnóstico, as revisões ou o domínio dos conteúdos.', '', ...body, '', 'REGISTRO DE ESTUDO', 'Tempo utilizado: __________', 'Acertos / questões tentadas (se conferir): __________', 'Evidências e pontos a revisar: __________', 'Próxima ação: __________'].join('\n');
    if (questions.length) answerKey = ['GABARITO · CONSULTE APÓS RESPONDER', ...questions.flatMap((question, index) => [`${index + 1}. ${String.fromCharCode(65 + question.correctIndex)}) ${question.choices[question.correctIndex]}`, question.explanation, `Referência no catálogo: ${question.id}`, ''])].join('\n').trim();
  } else {
    const theme = input.theme?.trim() ?? '';
    if (!theme || theme.length > 300 || theme.includes('\0')) throw new Error('Informe um tema com até 300 caracteres.');
    warnings.push('Rubrica genérica para estudo. Não representa a matriz nem uma nota oficial do ENEM; não há correção automática.');
    instructions = [...header, '', 'REDAÇÃO · ESTUDO E REVISÃO MANUAL', `Tema informado por mim: ${theme}`, 'Rubrica genérica de estudo do StudySpace, sem IA. Não é uma avaliação oficial do ENEM e não atribui nota.', '', 'ROTEIRO', 'Planeje uma tese, organize os argumentos, escreva e reserve tempo para reler. Distribua a duração escolhida conforme sua necessidade.', 'Fontes e repertório (confira antes de citar): __________', '', 'MEU TEXTO', 'Escreva aqui.', '', 'RUBRICA DE REVISÃO', ...RUBRIC.flatMap(([criterion, prompt]) => [`${criterion}: ${prompt}`, 'Evidência no meu texto (trecho): __________', 'O que vou melhorar: __________', '']), 'PRÓXIMA VERSÃO', 'Prioridade da reescrita: __________', 'O que mudou e por quê: __________', '', 'Esta atividade registra prática. Não altera resultados do diagnóstico, revisões espaçadas ou conclusão do planner.'].join('\n');
  }
  const plainText = `${instructions}${answerKey ? `\n\n${answerKey}` : ''}`;
  const note = { title, plainText, bodyJson: textDocument(plainText) };
  return { kind: input.kind, weekStart, instructions, answerKey, questionIds, bankSize, warnings, note, batch: { subjectId: subject.id, sourceName: title, format: 'txt', notes: [note], flashcards: [], documents: [], assets: [], warnings: [] } };
}

/** Exact matches only: edited notes are never overwritten or mistaken for a fresh template. */
export function findExistingPracticeNote(data: Pick<Snapshot, 'notes'>, preview: PracticePreview): Note | undefined {
  return data.notes.find(note => note.subjectId === preview.batch.subjectId && note.title === preview.note.title && note.plainText === preview.note.plainText);
}
