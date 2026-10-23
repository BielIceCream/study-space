import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import type { ErrorEntry } from '../../src/domain/error-notebook/types';
import { advanceSchedule } from '../../src/domain/spaced-repetition/engine';
import { defaultConfig, DEMO_CATALOG } from '../../src/domain/study/demo';
import type { StudyTrack } from '../../src/domain/study/types';
import type { Snapshot } from '../../src/shared/types';
import { createBackupArchive, readBackupArchive } from '../../src/services/backup-archive';

const NOW = '2026-10-23T15:00:00.000Z';
const OLD = '2026-10-01T15:00:00.000Z';
const MATH = 'Matemática dos exemplos';
const OTHER = 'Linguagens dos exemplos';
const TRACK = 'Fundamentos com vínculos explícitos';

function fixture(): Snapshot {
  const subjects = ['math', 'other'].map((id, index) => ({ id, name: index ? OTHER : MATH, accent: 'blue' as const, createdAt: OLD, updatedAt: OLD }));
  const flashcards = ['old', 'due', 'future', 'other'].map(id => ({ id, subjectId: id === 'other' ? 'other' : 'math', noteId: null, front: `Pergunta ${id}`, back: `Resposta ${id}`, createdAt: OLD, updatedAt: OLD }));
  const reviewLogs = [
    { id: 'old-review', flashcardId: 'old', sessionId: 'old-session', rating: 4 as const, reviewedAt: OLD },
    { id: 'due-review', flashcardId: 'due', sessionId: 'math-session', rating: 1 as const, reviewedAt: '2026-10-20T15:00:00.000Z' },
    { id: 'future-review', flashcardId: 'future', sessionId: 'math-session', rating: 3 as const, reviewedAt: '2026-10-23T14:00:00.000Z' },
    { id: 'other-review', flashcardId: 'other', sessionId: 'other-session', rating: 2 as const, reviewedAt: '2026-10-22T15:00:00.000Z' },
  ];
  const error = (id: string, subjectId: string): ErrorEntry => ({
    id, subjectId, revision: 1, originLabel: 'Exercício de exemplo', question: `Dúvida ${id}`, correction: '', nextAction: '',
    status: 'open', source: { kind: 'manual' }, sourceSnapshot: { title: 'Exercício de exemplo', prompt: `Dúvida ${id}`, answer: '' },
    createdAt: OLD, updatedAt: '2026-10-22T15:00:00.000Z', resolvedAt: null, practices: [],
  });
  const open = error('open-math', 'math');
  open.practices = [
    { id: 'old-practice', description: 'Prática antiga', createdAt: '2026-10-10T15:00:00.000Z' },
    { id: 'recent-practice', description: 'Prática recente', createdAt: '2026-10-21T15:00:00.000Z' },
  ];
  const resolved: ErrorEntry = {
    ...error('resolved-math', 'math'), status: 'resolved', correction: 'Corrigi a conta.', nextAction: 'Retomar o exemplo.',
    source: { kind: 'flashcard', flashcardId: 'due', reviewLogId: 'due-review' },
    sourceSnapshot: { title: `Flashcard · ${MATH}`, prompt: 'Pergunta due', answer: 'Resposta due' },
    createdAt: '2026-10-20T15:00:00.000Z', resolvedAt: '2026-10-22T15:00:00.000Z',
    practices: [{ id: 'resolved-practice', description: 'Conferi a resolução', createdAt: '2026-10-22T15:00:00.000Z' }],
  };
  const unrelated = error('open-other', 'other');
  unrelated.practices = [{ id: 'other-practice', description: 'Prática em outra matéria', createdAt: '2026-10-22T15:00:00.000Z' }];
  const catalog = structuredClone(DEMO_CATALOG);
  const config = defaultConfig(catalog);
  config.name = TRACK;
  config.bindings = [{ unitId: 'mat-operacoes', subjectId: 'math', noteIds: ['source-note'] }];
  const track: StudyTrack = {
    id: 'track', revision: 1, createdAt: OLD, updatedAt: NOW, catalog, config,
    diagnostics: [{ id: 'diagnostic', startedAt: '2026-10-20T14:00:00.000Z', updatedAt: '2026-10-20T15:00:00.000Z', status: 'completed', questionIds: ['operacoes-1', 'operacoes-2'], answers: [
      { questionId: 'operacoes-1', choiceIndex: 1, answeredAt: '2026-10-20T14:30:00.000Z' },
      { questionId: 'operacoes-2', choiceIndex: 0, answeredAt: '2026-10-20T15:00:00.000Z' },
    ] }],
  };
  const plannerConfig = { days: [{ weekday: 4, startMinute: 1140, minutes: 90 }], blockMinutes: 25, breakMinutes: 5, mockMinutes: 30, unitEstimates: [] };
  return {
    subjects, notes: [{ id: 'source-note', subjectId: 'math', title: 'Meu material original', revision: 1, plainText: 'Respeite a ordem das operações.', bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Respeite a ordem das operações.' }] }] }, createdAt: OLD, updatedAt: OLD }],
    flashcards, reviewLogs, reviewSchedules: [advanceSchedule(undefined, reviewLogs[1]), advanceSchedule(undefined, reviewLogs[2])],
    errorEntries: [open, resolved, unrelated], studyTracks: [track], settings: { theme: 'light' }, documents: [], cardMetadata: [],
    studyPlanners: [{ trackId: track.id, revision: 1, createdAt: OLD, updatedAt: NOW, config: plannerConfig, backlog: [], undo: null, weeks: [{
      weekStart: '2026-10-19', planId: 'accepted-week', generatedAt: NOW, rulesVersion: 1, budgetMinutes: 90, config: plannerConfig,
      blocks: [{ id: 'weekly-mock', unitId: null, kind: 'mock', date: '2026-10-23', startMinute: 1140, minutes: 30, breakMinutes: 5, status: 'pending', fixed: false, completedAt: null, reason: 'Atividade reservada para conferir os fundamentos.' }],
    }] }],
  };
}

async function seed(page: Page) {
  const data = fixture();
  const archive = await createBackupArchive({ format: 'studyspace-backup', version: 7, exportedAt: NOW, data, materials: { documents: [], assets: [] } }, async () => { throw new Error('A fixture não contém materiais binários.'); });
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await page.getByLabel('Arquivo de backup', { exact: true }).setInputFiles({ name: 'estudos-v7.studyspace', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive.arrayBuffer()) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  return data;
}

async function openProgress(page: Page, subject = MATH, keyboard = false) {
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('heading', { name: subject, exact: true }).click();
  if (subject === MATH) await expect(page.getByLabel('Título da nota')).toBeVisible();
  if (keyboard) {
    await page.getByRole('tab', { name: /^Notas/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^Flashcards/ })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Progresso', exact: true })).toBeFocused();
  } else await page.getByRole('tab', { name: 'Progresso', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu progresso na matéria', exact: true })).toBeVisible();
}

async function openActivities(page: Page) {
  await page.getByRole('button', { name: 'Atividades semanais', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Atividades semanais.', exact: true })).toBeVisible();
}

async function previewWeekly(page: Page, subjectId = 'math') {
  await openActivities(page);
  await page.getByLabel('Matéria da atividade', { exact: true }).selectOption(subjectId);
  await page.getByLabel('Trilha (opcional)', { exact: true }).selectOption('track');
  await page.getByLabel('Data da atividade', { exact: true }).fill('2026-10-23');
  await page.getByLabel('Duração (minutos)', { exact: true }).fill('10');
  await page.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confira antes de criar', exact: true })).toBeFocused();
}

async function exportBackup(page: Page) {
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar backup', exact: true }).click()]);
  const path = (await download.path())!;
  const bytes = new Uint8Array(await readFile(path));
  const archive = await readBackupArchive(new Blob([bytes]));
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  return { path, manifest: archive.manifest };
}

function expectStudyHistoryUnchanged(actual: Snapshot, original: Snapshot) {
  const ordered = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
  expect(ordered(actual.reviewLogs)).toEqual(ordered(original.reviewLogs));
  expect(actual.reviewSchedules).toEqual(original.reviewSchedules);
  expect(actual.studyTracks).toEqual(original.studyTracks);
  expect(actual.studyPlanners).toEqual(original.studyPlanners);
  expect(ordered(actual.errorEntries ?? [])).toEqual(ordered(original.errorEntries ?? []));
}

test('progresso separa matéria e período, mantém retornos e sobrevive a reload e backup v7', async ({ page, browser, baseURL }, info) => {
  const original = await seed(page);
  await openProgress(page, MATH, true);
  await expect(page.getByTestId('progress-review-answers')).toHaveText('2');
  await expect(page.getByTestId('progress-review-sessions')).toHaveText('1');
  await expect(page.getByTestId('progress-notebook-practices')).toHaveText('2');
  await expect(page.getByTestId('progress-cards-due')).toHaveText('1');
  await expect(page.getByTestId('progress-errors-open')).toHaveText('1');
  await expect(page.getByTestId('progress-errors-resolved')).toHaveText('1');
  await expect(page.locator('.progress-track')).toContainText('2 respostas registradas em 2 questões distintas');
  await page.getByLabel(/^Período de atividade/).selectOption('all');
  await expect(page.getByTestId('progress-review-answers')).toHaveText('3');
  await expect(page.getByTestId('progress-review-sessions')).toHaveText('2');
  await expect(page.getByTestId('progress-notebook-practices')).toHaveText('3');
  await expect(page.getByTestId('progress-cards-due')).toHaveText('1');
  await page.getByRole('button', { name: 'Atualizar referência', exact: true }).click();
  await expect(page.locator('.subject-progress [role="status"]')).toContainText('Referência atualizada');
  await page.screenshot({ path: info.outputPath('progresso-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Abrir caderno desta matéria', exact: true }).click();
  await expect(page.getByLabel(/^Filtrar por matéria/)).toHaveValue('math');
  await expect(page.locator('.notebook-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Voltar ao progresso', exact: true }).click();
  await expect(page.getByLabel(/^Período de atividade/)).toHaveValue('all');
  await page.getByRole('button', { name: 'Revisar cartões', exact: true }).click();
  await expect(page.getByLabel('Escolha sua matéria')).toHaveValue('math');
  await page.getByRole('button', { name: 'Voltar ao progresso', exact: true }).click();
  await expect(page.getByLabel(/^Período de atividade/)).toHaveValue('all');
  await page.getByRole('button', { name: 'Abrir trilha', exact: true }).click();
  await expect(page.getByRole('heading', { name: TRACK, exact: true })).toBeVisible();
  await openProgress(page, OTHER);
  await expect(page.getByTestId('progress-review-answers')).toHaveText('1');
  await expect(page.getByTestId('progress-notebook-practices')).toHaveText('1');
  await expect(page.getByTestId('progress-errors-resolved')).toHaveText('0');
  await expect(page.locator('.progress-track')).toHaveCount(0);
  const exported = await exportBackup(page);
  expect(exported.manifest.version).toBe(7);
  expectStudyHistoryUnchanged(exported.manifest.data, original);
  await page.reload();
  await openProgress(page);
  await expect(page.getByTestId('progress-review-answers')).toHaveText('2');
  const other = await browser.newContext();
  try {
    const destination = await other.newPage();
    await destination.clock.setFixedTime(NOW);
    await destination.goto(baseURL!);
    await destination.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    await destination.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(exported.path);
    await expect(destination.getByRole('dialog')).toHaveCount(0);
    await openProgress(destination);
    await expect(destination.getByTestId('progress-review-answers')).toHaveText('2');
    await expect(destination.getByTestId('progress-notebook-practices')).toHaveText('2');
  } finally { await other.close(); }
});

test('atividades usam vínculos explícitos e só criam notas após confirmação sem mudar evidências', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(120_000);
  const original = await seed(page);
  await previewWeekly(page);
  const preview = page.locator('.practice-preview');
  await expect(preview).toContainText('2 questões nesta atividade');
  await expect(preview).toContainText('Quanto vale 8 + 3 × 4?');
  await expect(preview).not.toContainText('A biblioteca abre às 8h');
  await expect(preview).toContainText('CC0-1.0');
  await page.getByText('Ver gabarito para autocorreção', { exact: true }).click();
  await expect(page.locator('.practice-answer-key')).toContainText('A multiplicação vem antes da adição');
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Confira antes de criar', exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Crie a nota da atividade ou descarte seus ajustes');
  await page.getByRole('button', { name: 'Descartar ajustes', exact: true }).click();
  const untouched = await exportBackup(page);
  expect(untouched.manifest.data.notes).toHaveLength(1);
  expectStudyHistoryUnchanged(untouched.manifest.data, original);
  await previewWeekly(page);
  await page.getByRole('button', { name: 'Criar nota da atividade', exact: true }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue(`Prova semanal · 2026-10-19 · ${MATH}`);
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('GABARITO');
  // The same confirmed template opens its existing note rather than adding another copy.
  await previewWeekly(page);
  await page.getByRole('button', { name: 'Criar nota da atividade', exact: true }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue(`Prova semanal · 2026-10-19 · ${MATH}`);
  await previewWeekly(page, 'other');
  await expect(page.locator('.practice-preview')).toContainText('0 questões nesta atividade');
  await expect(page.locator('.practice-preview')).toContainText('O roteiro será manual');
  await expect(page.locator('.practice-preview-text')).toContainText('Minhas questões e fontes');
  await page.getByRole('button', { name: 'Criar nota da atividade', exact: true }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue(`Prova semanal · 2026-10-19 · ${OTHER}`);
  await openActivities(page);
  await page.getByRole('button', { name: 'Redação', exact: true }).click();
  await page.getByLabel('Matéria da atividade', { exact: true }).selectOption('math');
  await page.getByLabel('Tema da redação', { exact: true }).fill('O acesso aos espaços de estudo na comunidade');
  await page.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await expect(page.locator('.practice-preview')).toContainText('Rubrica genérica para estudo');
  await expect(page.locator('.practice-preview')).toContainText('Evidência no meu texto');
  await page.screenshot({ path: info.outputPath('atividade-desktop.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Criar nota da atividade', exact: true }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue(`Redação · 2026-10-19 · ${MATH}`);
  const editor = page.getByRole('textbox', { name: 'Conteúdo da nota' });
  await editor.focus();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Minha tese: a comunidade precisa de bibliotecas acessíveis.');
  const exported = await exportBackup(page);
  expect(exported.manifest.data.notes).toHaveLength(4);
  const writing = exported.manifest.data.notes.find(note => note.title.startsWith('Redação ·'))!;
  expect(writing.plainText).toContain('Minha tese: a comunidade precisa de bibliotecas acessíveis.');
  expect(writing.plainText).toContain('RUBRICA DE REVISÃO');
  expectStudyHistoryUnchanged(exported.manifest.data, original);
  await page.reload();
  await page.locator('.recent-note').filter({ hasText: writing.title }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('Minha tese: a comunidade');
  const other = await browser.newContext();
  try {
    const destination = await other.newPage();
    await destination.goto(baseURL!);
    await destination.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    await destination.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(exported.path);
    await expect(destination.getByRole('dialog')).toHaveCount(0);
    await destination.locator('.recent-note').filter({ hasText: writing.title }).click();
    await expect(destination.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('Minha tese: a comunidade');
  } finally { await other.close(); }
});

test('progresso e atividade do planner são acessíveis no celular e a nota salva sem rede', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const original = await seed(page);
  await openProgress(page, MATH, true);
  const progressAxe = await new AxeBuilder({ page }).include('.subject-progress').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(progressAxe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('progresso-mobile.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Planner', exact: true }).click();
  await page.getByRole('button', { name: 'Preparar atividade', exact: true }).click();
  await expect(page.getByLabel('Data da atividade', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Trilha (opcional)', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('Duração (minutos)', { exact: true })).toHaveAttribute('max', '30');
  await page.getByRole('button', { name: 'Redação', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel('Tema da redação', { exact: true }).fill('Como organizar meus estudos');
  await page.getByRole('button', { name: 'Ver prévia', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Confira antes de criar', exact: true })).toBeFocused();
  const practiceAxe = await new AxeBuilder({ page }).include('.practice-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(practiceAxe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('atividade-mobile.png'), fullPage: true, animations: 'disabled' });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Criar nota da atividade', exact: true }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue(`Redação · 2026-10-19 · ${MATH}`);
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('Bloco do planner: weekly-mock');
  await context.setOffline(false);
  await page.reload();
  const exported = await exportBackup(page);
  expect(exported.manifest.data.notes).toHaveLength(2);
  expect(exported.manifest.data.notes.find(note => note.title.startsWith('Redação ·'))?.plainText).toContain('Como organizar meus estudos');
  expectStudyHistoryUnchanged(exported.manifest.data, original);
});
