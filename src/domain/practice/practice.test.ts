import { describe, expect, it } from 'vitest';
import { DEMO_CATALOG, defaultConfig } from '../study/demo';
import { defaultPlannerConfig } from '../planner/engine';
import type { PlannerBlock, StudyPlanner } from '../planner/types';
import type { StudyTrack } from '../study/types';
import type { RichDocument, Snapshot } from '../../shared/types';
import { buildPracticePreview, findExistingPracticeNote, resolvePracticeContext } from './engine';
import type { PracticeInput } from './types';

const now = '2026-10-23T12:00:00.000Z';
function fixture(): Snapshot {
  const track: StudyTrack = { id: 'track', revision: 1, createdAt: now, updatedAt: now, catalog: structuredClone(DEMO_CATALOG), config: defaultConfig(), diagnostics: [] };
  track.config.bindings = [{ unitId: 'mat-operacoes', subjectId: 'library-math', noteIds: [] }, { unitId: 'mat-proporcoes', subjectId: 'library-math', noteIds: [] }, { unitId: 'lin-informacao', subjectId: 'library-language', noteIds: [] }];
  return { subjects: [{ id: 'library-math', name: 'Minha matéria', accent: 'blue', createdAt: now, updatedAt: now }, { id: 'library-language', name: 'Matemática', accent: 'green', createdAt: now, updatedAt: now }], notes: [], flashcards: [], reviewLogs: [], settings: { theme: 'light' }, studyTracks: [track] };
}
const input = (extra: Partial<PracticeInput> = {}): PracticeInput => ({ kind: 'weekly', subjectId: 'library-math', trackId: 'track', date: '2026-10-23', minutes: 10, ...extra });
function withMock(data: Snapshot): Snapshot {
  const config = defaultPlannerConfig(data.studyTracks![0]);
  const block: PlannerBlock = { id: 'mock-accepted', kind: 'mock', unitId: null, date: '2026-10-23', startMinute: 1140, minutes: 10, breakMinutes: 5, status: 'pending', fixed: false, completedAt: null, reason: 'Prática manual' };
  const planner: StudyPlanner = { trackId: 'track', revision: 1, createdAt: now, updatedAt: now, config, weeks: [{ weekStart: '2026-10-19', planId: 'accepted', generatedAt: now, rulesVersion: 1, budgetMinutes: 300, config, blocks: [block] }], backlog: [], undo: null };
  return { ...data, studyPlanners: [planner] };
}
const allText = (document: RichDocument): string => document.content!.map(paragraph => paragraph.content?.map(node => node.text ?? '').join('') ?? '').join('\n');

describe('atividades semanais manuais', () => {
  it('seleciona de forma determinística por semana e matéria sem mutar fontes ou diagnóstico', () => {
    const data = fixture(); const original = structuredClone(data);
    const first = buildPracticePreview(data, input());
    expect(first.questionIds).toEqual(buildPracticePreview(data, input({ date: '2026-10-21' })).questionIds);
    data.studyTracks![0].catalog.questions.reverse();
    expect(buildPracticePreview(data, input()).questionIds).toEqual(first.questionIds);
    data.studyTracks![0].catalog.questions.reverse();
    expect(data).toEqual(original);
    expect(first.note.plainText).toContain('CC0-1.0');
    expect(first.note.plainText).toContain(DEMO_CATALOG.origin);
    expect(first.warnings.join(' ')).toContain('Não é uma prova oficial');
  });

  it('respeita cinco minutos por questão e o banco pequeno, sem repetições na mesma atividade', () => {
    const data = fixture();
    expect(buildPracticePreview(data, input({ minutes: 9 })).questionIds).toHaveLength(1);
    const short = buildPracticePreview(data, input({ minutes: 4 }));
    expect(short.questionIds).toHaveLength(0); expect(short.answerKey).toBe('');
    expect(short.instructions).toContain('Escolha questões nos seus materiais');
    const long = buildPracticePreview(data, input({ minutes: 240 }));
    expect(long.bankSize).toBe(4); expect(long.questionIds).toHaveLength(4);
    expect(new Set(long.questionIds).size).toBe(4);
    expect(long.warnings.some(warning => warning.includes('tempo restante'))).toBe(true);
    const baseQuestion = data.studyTracks![0].catalog.questions[0];
    data.studyTracks![0].catalog.questions = Array.from({ length: 35 }, (_, index) => ({ ...baseQuestion, id: `sample-${index}` }));
    expect(buildPracticePreview(data, input({ minutes: 240 })).questionIds).toHaveLength(20);
  });

  it('exige vínculos explícitos e disciplinas selecionadas sem inferir nada pelo nome da matéria', () => {
    const data = fixture();
    const math = buildPracticePreview(data, input({ minutes: 30 }));
    expect(math.questionIds.every(id => id.startsWith('operacoes-') || id.startsWith('proporcoes-'))).toBe(true);
    const misleadingName = buildPracticePreview(data, input({ subjectId: 'library-language', minutes: 30 }));
    expect(misleadingName.questionIds).toEqual(expect.arrayContaining(['informacao-1', 'informacao-2']));
    data.studyTracks![0].config.subjectIds = ['linguagens'];
    expect(buildPracticePreview(data, input()).questionIds).toHaveLength(0);
    data.studyTracks![0].config.bindings = [];
    expect(buildPracticePreview(data, input({ subjectId: 'library-language' })).questionIds).toHaveLength(0);
  });

  it('oferece roteiro independente sem fabricar questões e usa uma nota sem cartões ou materiais', () => {
    const preview = buildPracticePreview(fixture(), input({ trackId: undefined }));
    expect(preview.questionIds).toEqual([]); expect(preview.answerKey).toBe('');
    expect(preview.instructions).toContain('Nenhuma questão foi gerada');
    expect(preview.batch.notes).toEqual([preview.note]);
    expect(preview.batch.flashcards).toEqual([]); expect(preview.batch.documents).toEqual([]); expect(preview.batch.assets).toEqual([]);
  });

  it('separa gabarito final da prévia e preserva coerência entre texto e documento rico', () => {
    const preview = buildPracticePreview(fixture(), input());
    expect(preview.instructions).not.toContain('GABARITO ·');
    expect(preview.answerKey).toContain('GABARITO ·'); expect(preview.answerKey).toContain('Referência no catálogo:');
    expect(preview.note.plainText).toBe(`${preview.instructions}\n\n${preview.answerKey}`);
    expect(allText(preview.note.bodyJson)).toBe(preview.note.plainText);
    expect(preview.note.bodyJson.content!.every(node => node.type === 'paragraph')).toBe(true);
    expect(preview.note.plainText).toContain('Minha resposta: __________');
  });

  it('cria redação com tema e rubrica genérica sem interpretar HTML ou atribuir nota', () => {
    const theme = '<script>alert("exemplo")</script> e educação';
    const preview = buildPracticePreview(fixture(), input({ kind: 'writing', theme }));
    expect(preview.questionIds).toEqual([]); expect(preview.answerKey).toBe('');
    expect(preview.note.plainText).toContain(theme); expect(preview.note.plainText).toContain('Evidência no meu texto (trecho)');
    expect(preview.note.plainText).toContain('Não é uma avaliação oficial do ENEM'); expect(preview.note.plainText).toContain('sem IA');
    expect(allText(preview.note.bodyJson)).toBe(preview.note.plainText);
    expect(JSON.stringify(preview.note.bodyJson)).not.toContain('"type":"script"');
    for (const invalid of ['  ', 'x'.repeat(301), 'tema\0inválido']) expect(() => buildPracticePreview(fixture(), input({ kind: 'writing', theme: invalid }))).toThrow('tema');
  });

  it('usa só simulado aceito pendente e limita data, trilha e duração ao bloco sem concluí-lo', () => {
    const data = withMock(fixture()); const original = structuredClone(data);
    const context = { trackId: 'track', blockId: 'mock-accepted' };
    expect(resolvePracticeContext(data, context).block.minutes).toBe(10);
    expect(buildPracticePreview(data, input({ context })).note.plainText).toContain('Concluir esta nota não conclui o bloco');
    expect(() => buildPracticePreview(data, input({ context, minutes: 11 }))).toThrow('até 10');
    expect(() => buildPracticePreview(data, input({ context, date: '2026-10-22' }))).toThrow('trilha e a data');
    expect(() => buildPracticePreview(data, input({ context, trackId: undefined }))).toThrow('trilha e a data');
    expect(data).toEqual(original);
    const block = data.studyPlanners![0].weeks[0].blocks[0];
    block.status = 'completed'; block.completedAt = now;
    expect(() => resolvePracticeContext(data, context)).toThrow('não está mais pendente');
    block.status = 'pending'; block.completedAt = null; block.kind = 'review';
    expect(() => resolvePracticeContext(data, context)).toThrow('não está mais pendente');
    block.kind = 'mock'; data.studyPlanners![0].backlog.push(block); data.studyPlanners![0].weeks[0].blocks = [];
    expect(() => resolvePracticeContext(data, context)).toThrow('semana aceita');
  });

  it('rejeita datas e duração inválidas ou matéria e trilha ausentes', () => {
    for (const extra of [{ date: '2026-02-30' }, { date: 'not-a-date' }, { date: '2101-01-01' }, { minutes: 0 }, { minutes: 241 }, { minutes: Number.NaN }, { minutes: 5.5 }, { subjectId: 'absent' }, { trackId: 'absent' }]) expect(() => buildPracticePreview(fixture(), input(extra))).toThrow();
  });

  it('localiza só notas idênticas e preserva notas editadas ou de outra matéria', () => {
    const data = fixture(); const preview = buildPracticePreview(data, input());
    data.notes.push({ ...preview.note, subjectId: 'library-math', id: 'existing', revision: 1, createdAt: now, updatedAt: now });
    expect(findExistingPracticeNote(data, preview)?.id).toBe('existing');
    const original = structuredClone(data.notes[0]);
    data.notes[0].plainText += '\nMinha resposta: B';
    expect(findExistingPracticeNote(data, preview)).toBeUndefined(); expect(data.notes[0].plainText).toContain('Minha resposta: B');
    data.notes[0] = { ...original, subjectId: 'library-language' };
    expect(findExistingPracticeNote(data, preview)).toBeUndefined();
  });
});
