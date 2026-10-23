import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import type { Flashcard, ReviewLog, Snapshot } from '../../src/shared/types';
import { createBackupArchive, readBackupArchive } from '../../src/services/backup-archive';
import { advanceSchedule } from '../../src/domain/spaced-repetition/engine';

const NOW = '2026-10-21T15:00:00.000Z'; // Midday in America/Sao_Paulo, away from day-boundary races.

async function importCards(page: Page, subjectName: string, questions: string[]) {
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill(subjectName);
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();
  await page.getByRole('button', { name: 'Importar material', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar material' });
  await dialog.getByRole('combobox').selectOption({ label: subjectName });
  await dialog.getByLabel('Arquivo', { exact: true }).setInputFiles({
    name: 'cartões.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({
      format: 'studyspace-import', version: 1,
      flashcards: questions.map(front => ({ front, back: `Resposta: ${front}`, tags: ['revisão'] })),
    }), 'utf8'),
  });
  await dialog.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Prévia da importação' })).toContainText(`${questions.length} cartões`);
  await dialog.getByRole('button', { name: 'Confirmar importação', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function review(page: Page) {
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await page.getByRole('radio', { name: 'Revisão espaçada', exact: true }).check();
}

async function exportSnapshot(page: Page) {
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar backup', exact: true }).click(),
  ]);
  const bytes = await readFile((await download.path())!);
  const archive = await readBackupArchive(new Blob([new Uint8Array(bytes)]));
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  return archive.manifest;
}

async function answerByKeyboard(page: Page, rating: 1 | 2 | 3 | 4) {
  // Leave buttons/inputs before Space so the page shortcut is exercised.
  await page.locator('#main-content').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /^Errei/ })).toBeVisible();
  await page.keyboard.press(String(rating));
}

test('cota global sobrevive a filtros e reload, prática livre permanece intacta e retomada não admite cartão novo', async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await importCards(page, 'Biologia — revisão', ['Membrana', 'Mitocôndria', 'Ribossomo']);
  await importCards(page, 'Física — revisão', ['Energia']);
  await review(page);
  await page.getByLabel('Escolha sua matéria').selectOption({ label: 'Biologia — revisão' });
  await page.getByLabel('Novos cartões por dia').fill('1');
  await page.screenshot({ path: info.outputPath('revisao-espacada-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: 'Começar revisão espaçada', exact: true }).click();
  await expect(page.getByText('Novo cartão', { exact: true })).toBeVisible();
  await expect(page.locator('.review-progress')).toHaveAttribute('aria-valuemax', '1');
  await answerByKeyboard(page, 1);
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  const first = await exportSnapshot(page);
  expect(first.version).toBe(6);
  expect(first.data.flashcards).toHaveLength(4);
  expect(first.data.reviewLogs).toHaveLength(1);
  expect(first.data.reviewSchedules).toHaveLength(1);
  const admitted = first.data.reviewSchedules![0];
  expect(admitted).toMatchObject({ repetitions: 1, lapses: 1, stage: 0, introducedAt: NOW, dueAt: '2026-10-21T15:10:00.000Z' });

  await page.reload();
  await review(page);
  await expect(page.getByLabel('Novos cartões por dia')).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Começar revisão espaçada', exact: true })).toBeDisabled();
  await page.getByLabel('Escolha sua matéria').selectOption({ label: 'Física — revisão' });
  await expect(page.getByRole('button', { name: 'Começar revisão espaçada', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Prática livre', exact: true }).check();
  await page.getByRole('button', { name: 'Começar revisão', exact: true }).click();
  await answerByKeyboard(page, 4);
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  const free = await exportSnapshot(page);
  expect(free.data.reviewLogs).toHaveLength(2);
  expect(free.data.reviewSchedules).toEqual(first.data.reviewSchedules);

  await page.clock.setFixedTime('2026-10-21T15:10:00.000Z');
  await page.reload();
  await review(page);
  await page.getByLabel('Novos cartões por dia').fill('0');
  await page.getByRole('button', { name: 'Começar revisão espaçada', exact: true }).click();
  await expect(page.getByText('Revisão de hoje', { exact: true })).toBeVisible();
  await expect(page.locator('.review-progress')).toHaveAttribute('aria-valuemax', '1');
  await answerByKeyboard(page, 3);
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  const returned = await exportSnapshot(page);
  expect(returned.data.reviewLogs).toHaveLength(3);
  expect(returned.data.reviewSchedules).toHaveLength(1);
  expect(returned.data.reviewSchedules![0]).toMatchObject({
    firstReviewId: admitted.firstReviewId, introducedAt: NOW, repetitions: 2,
    stage: 1, dueAt: '2026-10-22T15:10:00.000Z',
  });
});

test('agenda restaurada prioriza atraso, inclui o vencimento exato e preserva cartões futuros', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const subject = { id: 'subject', name: 'Revisões restauradas', accent: 'green' as const, createdAt: NOW, updatedAt: NOW };
  const card = (id: string, front: string): Flashcard => ({ id, subjectId: subject.id, noteId: null, front, back: `Resposta: ${front}`, createdAt: NOW, updatedAt: NOW });
  const cards = [card('old', 'Primeiro: atraso'), card('today', 'Depois: hoje'), card('future', 'Futuro: aguardar'), card('new', 'Novo: sem vaga')];
  const logs: ReviewLog[] = [
    { id: 'review-old', flashcardId: 'old', sessionId: 'session-old', rating: 3, reviewedAt: '2026-10-19T15:00:00.000Z' },
    { id: 'review-today', flashcardId: 'today', sessionId: 'session-today', rating: 2, reviewedAt: '2026-10-21T14:00:00.000Z' },
    { id: 'review-future', flashcardId: 'future', sessionId: 'session-future', rating: 3, reviewedAt: NOW },
  ];
  const data: Snapshot = { subjects: [subject], notes: [], flashcards: cards, reviewLogs: logs, reviewSchedules: logs.map(log => advanceSchedule(undefined, log)), settings: { theme: 'light' }, documents: [], cardMetadata: [] };
  const archive = await createBackupArchive({ format: 'studyspace-backup', version: 6, exportedAt: NOW, data, materials: { documents: [], assets: [] } }, async () => { throw new Error('Sem materiais na fixture.'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await page.getByLabel('Arquivo de backup').setInputFiles({ name: 'agenda-devida.studyspace', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive.arrayBuffer()) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await review(page);
  await page.getByLabel('Novos cartões por dia').fill('0');
  await page.getByRole('button', { name: 'Começar revisão espaçada', exact: true }).click();
  await expect(page.locator('.review-progress')).toHaveAttribute('aria-valuemax', '2');
  await expect(page.locator('.review-card .front p')).toHaveText('Primeiro: atraso');
  await expect(page.getByText('Atrasado', { exact: true })).toBeVisible();
  await answerByKeyboard(page, 3);
  await expect(page.locator('.review-card .front p')).toHaveText('Depois: hoje');
  await expect(page.getByText('Revisão de hoje', { exact: true })).toBeVisible();
  await answerByKeyboard(page, 3);
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  const result = await exportSnapshot(page);
  expect(result.data.reviewLogs).toHaveLength(5);
  expect(result.data.reviewSchedules).toHaveLength(3);
  expect(result.data.reviewSchedules!.find(item => item.flashcardId === 'future')).toEqual(data.reviewSchedules!.find(item => item.flashcardId === 'future'));
  expect(result.data.reviewSchedules!.some(item => item.flashcardId === 'new')).toBe(false);
});

test('revisão espaçada móvel acessível por teclado grava sem rede após carregar', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await importCards(page, 'História — móvel', ['Pergunta de revisão']);
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  const spaced = page.getByRole('radio', { name: 'Revisão espaçada', exact: true });
  await spaced.focus();
  await page.keyboard.press('Space');
  await expect(spaced).toBeChecked();
  await page.getByLabel('Novos cartões por dia').fill('1');
  await page.screenshot({ path: info.outputPath('revisao-espacada-inicio-mobile.png'), fullPage: true });
  const startAxe = await new AxeBuilder({ page }).include('.review-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(startAxe.violations).toEqual([]);
  await page.getByRole('button', { name: 'Começar revisão espaçada', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Novo cartão', { exact: true })).toBeVisible();
  await context.setOffline(true);
  await page.locator('#main-content').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /^Bom/ })).toBeVisible();
  const sessionAxe = await new AxeBuilder({ page }).include('.review-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(sessionAxe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('revisao-espacada-mobile.png'), fullPage: true });
  await page.keyboard.press('3');
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  const saved = await exportSnapshot(page);
  expect(saved.version).toBe(6);
  expect(saved.data.reviewSchedules).toHaveLength(1);
  expect(saved.data.reviewLogs).toHaveLength(1);
  expect(saved.data.reviewSchedules![0]).toMatchObject({ stage: 1, repetitions: 1, dueAt: '2026-10-22T15:00:00.000Z' });
});

test('resposta já salva aguarda a recarga da agenda sem permitir nova avaliação ou criar duplicata', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await importCards(page, 'Memória e durabilidade', ['Uma resposta de cada vez']);
  await review(page);
  await page.getByLabel('Novos cartões por dia').fill('1');
  await page.getByRole('button', { name: 'Começar revisão espaçada', exact: true }).click();
  await page.evaluate(() => {
    const originalPut = IDBObjectStore.prototype.put;
    const originalGet = IDBObjectStore.prototype.get;
    let responseWasWritten = false;
    IDBObjectStore.prototype.put = function(value, key) {
      const request = originalPut.call(this, value, key);
      if (this.name === 'storage' && key === 'sqlite') responseWasWritten = true;
      return request;
    };
    IDBObjectStore.prototype.get = function(key) {
      if (this.name === 'storage' && key === 'sqlite' && responseWasWritten) {
        IDBObjectStore.prototype.put = originalPut;
        IDBObjectStore.prototype.get = originalGet;
        throw new Error('Falha sintética ao reler a agenda após a gravação durável.');
      }
      return originalGet.call(this, key);
    };
  });
  await answerByKeyboard(page, 3);
  await expect(page.locator('.review-page').getByRole('alert')).toContainText('Sua resposta foi salva');
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toHaveCount(0);
  for (const name of [/^Errei/, /^Difícil/, /^Bom/, /^Fácil/]) await expect(page.getByRole('button', { name })).toBeDisabled();
  const reload = page.getByRole('button', { name: 'Recarregar agenda', exact: true });
  await expect(reload).toBeFocused();
  await reload.click();
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  await expect(page.locator('.review-next-due')).toContainText('Próxima revisão:');
  const saved = await exportSnapshot(page);
  expect(saved.data.reviewLogs).toHaveLength(1);
  expect(saved.data.reviewSchedules).toHaveLength(1);
  expect(saved.data.reviewSchedules![0]).toMatchObject({ repetitions: 1, dueAt: '2026-10-22T15:00:00.000Z', lastReviewId: saved.data.reviewLogs[0].id });
});

test('bloco do planner abre a matéria vinculada e orienta o tempo sem concluir a atividade', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  const { DEMO_CATALOG, defaultConfig } = await import('../../src/domain/study/demo');
  const subject = { id: 'planner-subject', name: 'Matemática vinculada', accent: 'blue' as const, createdAt: NOW, updatedAt: NOW };
  const unitId = DEMO_CATALOG.units[0].id;
  const config = defaultConfig();
  config.bindings = [{ unitId, subjectId: subject.id, noteIds: [] }];
  const track: import('../../src/domain/study/types').StudyTrack = { id: 'planner-track', revision: 1, createdAt: NOW, updatedAt: NOW, catalog: DEMO_CATALOG, config, diagnostics: [] };
  const plannerConfig: import('../../src/domain/planner/types').PlannerConfig = { days: [{ weekday: 2, startMinute: 720, minutes: 90 }], blockMinutes: 25, breakMinutes: 5, mockMinutes: 30, unitEstimates: [] };
  const block: import('../../src/domain/planner/types').PlannerBlock = { id: 'review-block', unitId, kind: 'review', date: '2026-10-21', startMinute: 720, minutes: 25, breakMinutes: 5, status: 'pending', fixed: false, completedAt: null, reason: 'Tempo reservado para os cartões da matéria vinculada.' };
  const planner: import('../../src/domain/planner/types').StudyPlanner = { trackId: track.id, revision: 1, createdAt: NOW, updatedAt: NOW, config: plannerConfig, weeks: [{ weekStart: '2026-10-19', planId: 'accepted-week', generatedAt: NOW, rulesVersion: 1, budgetMinutes: config.weeklyMinutes, config: plannerConfig, blocks: [block] }], backlog: [], undo: null };
  const data: Snapshot = { subjects: [subject], notes: [], flashcards: [{ id: 'planner-card', subjectId: subject.id, noteId: null, front: 'Quanto é 2 + 2?', back: '4.', createdAt: NOW, updatedAt: NOW }], reviewLogs: [], settings: { theme: 'light' }, documents: [], cardMetadata: [], studyTracks: [track], studyPlanners: [planner] };
  const archive = await createBackupArchive({ format: 'studyspace-backup', version: 6, exportedAt: NOW, data, materials: { documents: [], assets: [] } }, async () => { throw new Error('Sem materiais na fixture.'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await page.getByLabel('Arquivo de backup').setInputFiles({ name: 'planner-com-revisao.studyspace', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive.arrayBuffer()) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Planner', exact: true }).click();
  await page.getByRole('button', { name: 'Revisar cartões', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Revisão espaçada', exact: true })).toBeChecked();
  await expect(page.getByLabel('Escolha sua matéria')).toHaveValue(subject.id);
  await expect(page.locator('.review-planner-context')).toContainText('25 min como referência');
  await expect(page.locator('.review-planner-context')).toContainText('Conclua o bloco separadamente no planner.');
  await page.getByRole('button', { name: 'Começar revisão espaçada', exact: true }).click();
  await answerByKeyboard(page, 3);
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  await page.getByRole('button', { name: 'Voltar ao planner', exact: true }).click();
  await expect(page.locator('.planner-block.completed')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Revisar cartões', exact: true })).toHaveCount(1);
  const saved = await exportSnapshot(page);
  expect(saved.data.studyPlanners).toEqual([planner]);
  expect(saved.data.reviewSchedules).toHaveLength(1);
  expect(saved.data.reviewLogs).toHaveLength(1);
});
