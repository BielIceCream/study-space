import type { DiagnosticAttempt, StudyCatalog, StudyTrack } from './types';

export type EvidenceStatus = 'unknown' | 'needs-practice' | 'initial-evidence' | 'review-due';
export interface CompetencyEvidence {
  competencyId: string; status: EvidenceStatus; sampleSize: number; freshSampleSize: number;
  correctCount: number; lastAnsweredAt: string | null; explanation: string;
}
const DAY = 86_400_000;
export const EVIDENCE_MAX_AGE_DAYS = 30;

/** Latest answer per distinct question; skipped questions never count as evidence. */
export function assessCompetencies(track: StudyTrack, now: Date = new Date()): CompetencyEvidence[] {
  const questions = new Map(track.catalog.questions.map((question) => [question.id, question]));
  const latest = new Map<string, DiagnosticAttempt['answers'][number]>();
  for (const attempt of track.diagnostics) for (const answer of attempt.answers) {
    if (answer.choiceIndex === null || !questions.has(answer.questionId)) continue;
    const previous = latest.get(answer.questionId);
    if (!previous || previous.answeredAt <= answer.answeredAt) latest.set(answer.questionId, answer);
  }
  return track.catalog.competencies.map((competency) => {
    const answers = [...latest.values()].filter((answer) => questions.get(answer.questionId)?.competencyId === competency.id);
    const sampleSize = answers.length;
    const correctCount = answers.filter((answer) => questions.get(answer.questionId)?.correctIndex === answer.choiceIndex).length;
    const freshSampleSize = answers.filter((answer) => {
      const age = now.getTime() - Date.parse(answer.answeredAt);
      return age >= 0 && age <= EVIDENCE_MAX_AGE_DAYS * DAY;
    }).length;
    const lastAnsweredAt = answers.reduce<string | null>((last, answer) => last === null || last < answer.answeredAt ? answer.answeredAt : last, null);
    let status: EvidenceStatus;
    let explanation: string;
    if (sampleSize < 2) {
      status = 'unknown'; explanation = `${sampleSize} questão(ões) distinta(s) respondida(s). São necessárias ao menos 2 para um sinal inicial; série escolar e dificuldade declarada não demonstram domínio.`;
    } else if (correctCount / sampleSize < 0.75) {
      status = 'needs-practice'; explanation = `${correctCount} de ${sampleSize} respostas corretas em questões distintas. Há sinal de dificuldade; revise os fundamentos. Esta amostra pequena não é uma medida de domínio.`;
    } else if (freshSampleSize < 2) {
      status = 'review-due'; explanation = `${correctCount} de ${sampleSize} respostas corretas, mas menos de 2 respostas têm até ${EVIDENCE_MAX_AGE_DAYS} dias. Uma revisão pode atualizar esse sinal.`;
    } else {
      status = 'initial-evidence'; explanation = `${correctCount} de ${sampleSize} respostas corretas em questões distintas, com ao menos 2 nos últimos ${EVIDENCE_MAX_AGE_DAYS} dias. É apenas evidência inicial, sem certificação de domínio.`;
    }
    return { competencyId: competency.id, status, sampleSize, freshSampleSize, correctCount, lastAnsweredAt, explanation };
  });
}

export interface NextStudyUnit {
  unit: StudyCatalog['units'][number]; reason: string; evidence: CompetencyEvidence;
}

/** The graph is pedagogical order, never a claim that a grade implies mastery. */
export function nextUnit(track: StudyTrack, now: Date = new Date()): NextStudyUnit | null {
  const evidence = new Map(assessCompetencies(track, now).map((item) => [item.competencyId, item]));
  const competencies = new Map(track.catalog.competencies.map((item) => [item.id, item]));
  const units = new Map(track.catalog.units.map((unit) => [unit.id, unit]));
  const selected = new Set(track.config.subjectIds);
  const candidates = track.catalog.units.filter((unit) => selected.has(competencies.get(unit.competencyId)?.subjectId ?? ''));
  const settled = (unit: StudyCatalog['units'][number]) => evidence.get(unit.competencyId)?.status === 'initial-evidence';
  const findPrerequisite = (unit: StudyCatalog['units'][number], seen: Set<string>): StudyCatalog['units'][number] | null => {
    if (seen.has(unit.id)) return null;
    seen.add(unit.id);
    for (const ref of unit.prerequisites) {
      const prerequisite = units.get(ref);
      if (!prerequisite) continue;
      const deeper = findPrerequisite(prerequisite, seen);
      if (deeper) return deeper;
      if (!settled(prerequisite)) return prerequisite;
    }
    return null;
  };
  // Check prerequisites even when a later competency has a positive diagnostic signal.
  for (const candidate of candidates) {
    const prerequisite = findPrerequisite(candidate, new Set());
    if (prerequisite) return { unit: prerequisite, evidence: evidence.get(prerequisite.competencyId)!, reason: `Revise “${prerequisite.title}”, pré-requisito de “${candidate.title}”, antes de avançar. A recomendação usa respostas e dependências, não a série escolar.` };
    if (!settled(candidate)) return { unit: candidate, evidence: evidence.get(candidate.competencyId)!, reason: `“${candidate.title}” é o próximo fundamento disponível. ${evidence.get(candidate.competencyId)!.explanation}` };
  }
  return null;
}

export function startDiagnostic(track: StudyTrack, now: Date, id: string): DiagnosticAttempt {
  const current = track.diagnostics.find((attempt) => attempt.status === 'in-progress');
  if (current) return structuredClone(current);
  const paused = [...track.diagnostics].reverse().find((attempt) => attempt.status === 'skipped' && attempt.answers.length < attempt.questionIds.length);
  if (paused) {
    const date = now.toISOString();
    if (date < paused.updatedAt) throw new Error('O relógio está anterior à última resposta. Ajuste a data do dispositivo para continuar.');
    return { ...structuredClone(paused), status: 'in-progress', updatedAt: date };
  }
  if (track.diagnostics.length >= 200) throw new Error('O limite de 200 tentativas foi atingido. Exporte um backup antes de reorganizar seu histórico.');
  const subjects = new Set(track.config.subjectIds);
  const competencies = new Set(track.catalog.competencies.filter((competency) => subjects.has(competency.subjectId)).map((competency) => competency.id));
  const questionIds = track.catalog.questions.filter((question) => competencies.has(question.competencyId)).map((question) => question.id);
  if (!questionIds.length) throw new Error('Não há questões para as matérias selecionadas. Você pode continuar estudando sem diagnóstico.');
  const date = now.toISOString();
  return { id, startedAt: date, updatedAt: date, status: 'in-progress', questionIds, answers: [] };
}

export function answerDiagnostic(track: StudyTrack, attemptId: string, questionId: string, choiceIndex: number | null, now: Date): DiagnosticAttempt {
  const attempt = track.diagnostics.find((item) => item.id === attemptId);
  const question = track.catalog.questions.find((item) => item.id === questionId);
  if (!attempt || attempt.status !== 'in-progress') throw new Error('Este diagnóstico não está em andamento.');
  if (!question || !attempt.questionIds.includes(questionId) || attempt.answers.some((answer) => answer.questionId === questionId)) throw new Error('Esta questão não está disponível para resposta.');
  if (choiceIndex !== null && (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length)) throw new Error('Selecione uma alternativa válida.');
  const date = now.toISOString();
  if (date < attempt.updatedAt) throw new Error('O relógio está anterior à última resposta. Ajuste a data do dispositivo para continuar.');
  const answers = [...attempt.answers, { questionId, choiceIndex, answeredAt: date }];
  return { ...attempt, updatedAt: date, answers, status: answers.length === attempt.questionIds.length ? 'completed' : 'in-progress' };
}

export function skipDiagnostic(track: StudyTrack, attemptId: string, now: Date): DiagnosticAttempt {
  const attempt = track.diagnostics.find((item) => item.id === attemptId);
  if (!attempt || attempt.status !== 'in-progress') throw new Error('Este diagnóstico não está em andamento.');
  const date = now.toISOString();
  if (date < attempt.updatedAt) throw new Error('O relógio está anterior à última resposta. Ajuste a data do dispositivo para continuar.');
  return { ...structuredClone(attempt), status: 'skipped', updatedAt: date };
}
