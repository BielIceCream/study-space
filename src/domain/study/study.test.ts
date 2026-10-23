import { describe, expect, it } from 'vitest';
import { defaultConfig, DEMO_CATALOG } from './demo';
import { answerDiagnostic, assessCompetencies, nextUnit, skipDiagnostic, startDiagnostic } from './engine';
import { catalogSchema, saveStudyTrackSchema, studyTrackSchema, validateStudyLinks, validateStudyTransition } from './validation';
import type { DiagnosticAttempt, StudyTrack } from './types';

const now = new Date('2026-10-19T12:00:00.000Z');
function track(): StudyTrack {
  return { id: 'trilha-1', revision: 1, createdAt: now.toISOString(), updatedAt: now.toISOString(), catalog: structuredClone(DEMO_CATALOG), config: defaultConfig(), diagnostics: [] };
}
function putAttempt(value: StudyTrack, attempt: DiagnosticAttempt): void {
  value.diagnostics = [...value.diagnostics.filter((item) => item.id !== attempt.id), attempt];
}
function answer(value: StudyTrack, questionId: string, choiceIndex: number | null, date = now): void {
  const attempt = value.diagnostics.find((item) => item.status === 'in-progress')!;
  putAttempt(value, answerDiagnostic(value, attempt.id, questionId, choiceIndex, date));
}
function withOperationAnswers(first: number | null = 1, second: number | null = 0): StudyTrack {
  const value = track();
  putAttempt(value, startDiagnostic(value, now, 'tentativa-1'));
  answer(value, 'operacoes-1', first); answer(value, 'operacoes-2', second);
  return value;
}

describe('catálogo demonstrativo e configuração', () => {
  it('oferece conteúdo original pequeno e identifica explicitamente a cobertura limitada', () => {
    expect(catalogSchema.parse(DEMO_CATALOG).license).toBe('CC0-1.0');
    expect(DEMO_CATALOG.demonstrative).toBe(true);
    expect(DEMO_CATALOG.subjects).toHaveLength(2);
    expect(DEMO_CATALOG.units).toHaveLength(6);
    expect(DEMO_CATALOG.questions).toHaveLength(12);
    expect(DEMO_CATALOG.description).toContain('não cobrem');
    expect(studyTrackSchema.safeParse(track()).success).toBe(true);
  });

  it('rejeita ciclos, incluindo pré-requisito da própria unidade', () => {
    const cyclic = structuredClone(DEMO_CATALOG);
    cyclic.units[0].prerequisites = [cyclic.units[2].id];
    expect(catalogSchema.safeParse(cyclic).success).toBe(false);
    cyclic.units[0].prerequisites = [cyclic.units[0].id];
    expect(catalogSchema.safeParse(cyclic).success).toBe(false);
  });

  it('rejeita referências inexistentes, IDs repetidos e alternativa correta fora do limite', () => {
    const invalid = structuredClone(DEMO_CATALOG);
    invalid.units[0].prerequisites = ['unidade-ausente'];
    expect(catalogSchema.safeParse(invalid).success).toBe(false);
    const duplicate = structuredClone(DEMO_CATALOG);
    duplicate.questions[1].id = duplicate.questions[0].id;
    expect(catalogSchema.safeParse(duplicate).success).toBe(false);
    const answerOutOfRange = structuredClone(DEMO_CATALOG);
    answerOutOfRange.questions[0].correctIndex = 3;
    expect(catalogSchema.safeParse(answerOutOfRange).success).toBe(false);
  });

  it('limita recursos e rejeita campos privados inseridos em conteúdo compartilhável', () => {
    expect(catalogSchema.safeParse({ ...DEMO_CATALOG, studentName: 'Pessoa' }).success).toBe(false);
    expect(catalogSchema.safeParse({ ...DEMO_CATALOG, questions: Array(2049).fill(DEMO_CATALOG.questions[0]) }).success).toBe(false);
    const value = track();
    value.config.weeklyMinutes = 5041;
    expect(studyTrackSchema.safeParse(value).success).toBe(false);
    value.config.weeklyMinutes = 300;
    value.config.examDate = '2026-02-30';
    expect(studyTrackSchema.safeParse(value).success).toBe(false);
  });

  it('confere seleção, dificuldades, vínculo único e notas da mesma matéria existente', () => {
    const value = track();
    value.config.subjectIds = ['matematica', 'matematica'];
    expect(studyTrackSchema.safeParse(value).success).toBe(false);
    value.config.subjectIds = ['matematica'];
    expect(studyTrackSchema.safeParse(value).success).toBe(false); // retained Linguagens difficulty must also be removed
    value.config.difficulties = [];
    value.config.bindings = [{ unitId: 'mat-operacoes', subjectId: 'biblioteca-mat', noteIds: ['nota-1'] }];
    expect(studyTrackSchema.safeParse(value).success).toBe(true);
    expect(() => validateStudyLinks(value, { subjects: [], notes: [] })).toThrow('matéria vinculada');
    expect(() => validateStudyLinks(value, { subjects: [{ id: 'biblioteca-mat' }], notes: [{ id: 'nota-1', subjectId: 'outra' }] })).toThrow('outra matéria');
    expect(validateStudyLinks(value, { subjects: [{ id: 'biblioteca-mat' }], notes: [{ id: 'nota-1', subjectId: 'biblioteca-mat' }] })).toBe(value);
    value.config.bindings.push(structuredClone(value.config.bindings[0]));
    expect(studyTrackSchema.safeParse(value).success).toBe(false);
  });

  it('exige par identificador/revisão ao salvar edição', () => {
    const value = track();
    const input = { catalog: value.catalog, config: value.config, diagnostics: [] };
    expect(saveStudyTrackSchema.safeParse(input).success).toBe(true);
    expect(saveStudyTrackSchema.safeParse({ ...input, id: value.id }).success).toBe(false);
    expect(saveStudyTrackSchema.safeParse({ ...input, id: value.id, expectedRevision: 1 }).success).toBe(true);
  });
});

describe('diagnóstico opcional e evidência local', () => {
  it('mantém desconhecido sem diagnóstico, independentemente da série ou dificuldade declarada', () => {
    const value = track();
    value.config.startingYear = 'concluido';
    value.config.difficulties = value.config.difficulties.map((item) => ({ ...item, level: 'low' }));
    expect(assessCompetencies(value, now).every((item) => item.status === 'unknown' && item.sampleSize === 0)).toBe(true);
    expect(nextUnit(value, now)?.unit.id).toBe('mat-operacoes');
  });

  it('usa só as matérias selecionadas e não cria tentativa nova ao retomar', () => {
    const value = track();
    value.config.subjectIds = ['linguagens'];
    value.config.difficulties = [];
    const attempt = startDiagnostic(value, now, 'tentativa-1');
    expect(attempt.questionIds).toHaveLength(6);
    expect(attempt.questionIds).not.toContain('operacoes-1');
    putAttempt(value, attempt);
    expect(startDiagnostic(value, now, 'id-novo').id).toBe('tentativa-1');
    expect(value.diagnostics).toHaveLength(1);
  });

  it('não conta pulo como evidência e exige duas questões distintas', () => {
    const skipped = withOperationAnswers(1, null);
    expect(assessCompetencies(skipped, now)[0]).toMatchObject({ status: 'unknown', sampleSize: 1, correctCount: 1 });
    const repeated = track();
    repeated.diagnostics = ['1', '2'].map((id) => ({ id, status: 'completed', startedAt: now.toISOString(), updatedAt: now.toISOString(), questionIds: ['operacoes-1'], answers: [{ questionId: 'operacoes-1', choiceIndex: 1, answeredAt: now.toISOString() }] }));
    expect(assessCompetencies(repeated, now)[0]).toMatchObject({ status: 'unknown', sampleSize: 1 });
  });

  it('produz sinal inicial ou lacuna sem declarar domínio', () => {
    const positive = assessCompetencies(withOperationAnswers(), now)[0];
    expect(positive).toMatchObject({ status: 'initial-evidence', sampleSize: 2, freshSampleSize: 2, correctCount: 2 });
    expect(positive.explanation).toContain('sem certificação de domínio');
    const gap = assessCompetencies(withOperationAnswers(0, 0), now)[0];
    expect(gap).toMatchObject({ status: 'needs-practice', sampleSize: 2, correctCount: 1 });
    expect(gap.explanation).toContain('amostra pequena');
  });

  it('expõe recência e solicita revisão depois de 30 dias, sem inflar amostra com repetições', () => {
    const value = withOperationAnswers();
    expect(assessCompetencies(value, new Date(now.getTime() + 30 * 86400000))[0].status).toBe('initial-evidence');
    expect(assessCompetencies(value, new Date(now.getTime() + 31 * 86400000))[0]).toMatchObject({ status: 'review-due', sampleSize: 2, freshSampleSize: 0, lastAnsweredAt: now.toISOString() });
    const old = value.diagnostics[0];
    value.diagnostics.push({ ...structuredClone(old), id: 'reteste', status: 'skipped', answers: [{ questionId: 'operacoes-1', choiceIndex: 0, answeredAt: now.toISOString() }] });
    expect(assessCompetencies(value, now)[0]).toMatchObject({ sampleSize: 2, correctCount: 1, status: 'needs-practice' });
  });

  it('pausa e retoma preservando respostas; conclui ao responder ou pular toda a amostra', () => {
    const value = withOperationAnswers();
    const originalAnswers = structuredClone(value.diagnostics[0].answers);
    putAttempt(value, skipDiagnostic(value, 'tentativa-1', now));
    expect(value.diagnostics[0].status).toBe('skipped');
    const resumed = startDiagnostic(value, now, 'nova-tentativa');
    expect(resumed.id).toBe('tentativa-1');
    expect(resumed.answers).toEqual(originalAnswers);
    putAttempt(value, resumed);
    for (const questionId of resumed.questionIds.slice(2)) answer(value, questionId, null);
    expect(value.diagnostics[0].status).toBe('completed');
    expect(studyTrackSchema.safeParse(value).success).toBe(true);
    expect(assessCompetencies(value, now)[1].status).toBe('unknown');
  });

  it('rejeita resposta duplicada, alternativa inválida e relógio regressivo', () => {
    const value = withOperationAnswers();
    expect(() => answerDiagnostic(value, 'tentativa-1', 'operacoes-1', 1, now)).toThrow('não está disponível');
    expect(() => answerDiagnostic(value, 'tentativa-1', 'proporcoes-1', 99, now)).toThrow('alternativa válida');
    expect(() => answerDiagnostic(value, 'tentativa-1', 'proporcoes-1', 1, new Date('2026-10-18T12:00:00.000Z'))).toThrow('relógio');
  });

  it('rejeita estados impossíveis e datas de resposta fora da tentativa', () => {
    const value = withOperationAnswers();
    value.diagnostics[0].status = 'completed';
    expect(studyTrackSchema.safeParse(value).success).toBe(false);
    value.diagnostics[0].status = 'in-progress';
    value.diagnostics[0].answers[0].answeredAt = '2026-10-18T12:00:00.000Z';
    expect(studyTrackSchema.safeParse(value).success).toBe(false);
    value.diagnostics[0].answers[0].answeredAt = now.toISOString();
    value.diagnostics.push({ ...structuredClone(value.diagnostics[0]), id: 'outra' });
    expect(studyTrackSchema.safeParse(value).success).toBe(false);
  });
});

describe('sequência pedagógica e integridade de histórico', () => {
  it('avança quando há sinais iniciais e prioriza a raiz desconhecida mesmo para unidade avançada', () => {
    const value = withOperationAnswers();
    expect(nextUnit(value, now)?.unit.id).toBe('mat-proporcoes');
    const unknown = track();
    unknown.catalog.units.reverse();
    unknown.config.subjectIds = ['matematica'];
    unknown.config.difficulties = [];
    const next = nextUnit(unknown, now);
    expect(next?.unit.id).toBe('mat-operacoes');
    expect(next?.reason).toContain('pré-requisito');
  });

  it('retorna a revisão do pré-requisito quando os sinais envelhecem', () => {
    const value = withOperationAnswers();
    const next = nextUnit(value, new Date(now.getTime() + 31 * 86400000));
    expect(next?.unit.id).toBe('mat-operacoes');
    expect(next?.evidence.status).toBe('review-due');
  });

  it('permite editar preferências e acrescentar evidências, preservando o catálogo e respostas', () => {
    const value = withOperationAnswers();
    const edited = structuredClone(value);
    edited.config.weeklyMinutes = 180;
    edited.diagnostics[0] = skipDiagnostic(value, 'tentativa-1', now);
    expect(() => validateStudyTransition(value, edited)).not.toThrow();
    const rewritten = structuredClone(edited);
    rewritten.diagnostics[0].answers[0].choiceIndex = 2;
    expect(() => validateStudyTransition(edited, rewritten)).toThrow('respostas salvas');
    const removed = structuredClone(edited);
    removed.diagnostics = [];
    expect(() => validateStudyTransition(edited, removed)).toThrow('histórico');
    const recataloged = structuredClone(edited);
    recataloged.catalog.version++;
    expect(() => validateStudyTransition(edited, recataloged)).toThrow('catálogo');
  });

  it('permite retomar pausa e impede alterar uma tentativa concluída', () => {
    const value = withOperationAnswers();
    putAttempt(value, skipDiagnostic(value, 'tentativa-1', now));
    const resumed = structuredClone(value);
    putAttempt(resumed, startDiagnostic(value, now, 'outro-id'));
    expect(() => validateStudyTransition(value, resumed)).not.toThrow();
    for (const questionId of resumed.diagnostics[0].questionIds.slice(2)) answer(resumed, questionId, null);
    const mutated = structuredClone(resumed);
    mutated.diagnostics[0].status = 'skipped';
    expect(() => validateStudyTransition(resumed, mutated)).toThrow('concluído');
  });
});
