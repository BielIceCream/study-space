import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import type { BackupDocument } from '../../src/shared/types';
import { readBackupArchive } from '../../src/services/backup-archive';

const NOW = '2026-10-22T15:00:00.000Z';
const QUESTION = 'Quanto vale 8 + 3 × 4?';
const backup: BackupDocument = {
  format: 'studyspace-backup', version: 1, exportedAt: NOW,
  data: {
    subjects: [{ id: 'notebook-subject', name: 'Matemática dos exemplos', accent: 'blue', createdAt: NOW, updatedAt: NOW }],
    notes: [{ id: 'notebook-note', subjectId: 'notebook-subject', title: 'Ordem das operações', bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Multiplicar antes de somar.' }] }] }, plainText: 'Multiplicar antes de somar.', revision: 1, createdAt: NOW, updatedAt: NOW }],
    flashcards: [{ id: 'notebook-card', subjectId: 'notebook-subject', noteId: 'notebook-note', front: QUESTION, back: '20: multiplique 3 × 4 antes de somar 8.', createdAt: NOW, updatedAt: NOW }],
    reviewLogs: [], settings: { theme: 'light' },
  },
};

async function seed(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/');
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await page.getByLabel('Arquivo de backup', { exact: true }).setInputFiles({ name: 'biblioteca-anterior.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function openNotebook(page: Page) {
  await page.getByRole('button', { name: 'Caderno de erros', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Caderno de erros/ })).toBeVisible();
}
async function save(page: Page) {
  await page.getByRole('button', { name: 'Salvar registro', exact: true }).click();
  await expect(page.locator('.notebook-page').getByRole('status')).toContainText('Registro salvo.');
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
async function answer(page: Page, rating: 1 | 3) {
  await page.locator('#main-content').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /^Errei/ })).toBeVisible();
  await page.keyboard.press(String(rating));
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
}

test('caderno registra, pratica, resolve e reabre com restauração portátil v7', async ({ page, browser, baseURL }, info) => {
  await seed(page);
  await openNotebook(page);
  await page.getByRole('button', { name: 'Novo erro', exact: true }).click();
  await page.getByLabel(/^O que aconteceu\?/).fill('Confundi a ordem das operações.');
  await page.getByLabel(/^Origem ou atividade/).fill('Exercício do meu caderno');
  await save(page);
  await page.getByRole('button', { name: 'Resolver erro', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Preencha e salve a correção e a próxima ação');
  await page.getByLabel(/^Correção/).fill('A multiplicação vem antes da adição.');
  await page.getByLabel(/^Próxima ação/).fill('Refazer dois exemplos com operações.');
  await save(page);
  await page.getByLabel(/^O que praticou\?/).fill('Refiz dois exemplos sem consultar.');
  await page.getByRole('button', { name: 'Registrar prática', exact: true }).click();
  await expect(page.locator('.notebook-practice .notebook-history li')).toHaveCount(1);
  await expect(page.locator('.notebook-record-meta')).toContainText('Aberto');
  await page.getByRole('button', { name: 'Resolver erro', exact: true }).click();
  await expect(page.locator('.notebook-record-meta')).toContainText('Resolvido');
  await page.getByLabel(/^Filtrar por situação/).selectOption('resolved');
  await expect(page.locator('.notebook-entry')).toHaveCount(1);
  await page.getByRole('button', { name: 'Reabrir erro', exact: true }).click();
  await page.getByLabel(/^Filtrar por situação/).selectOption('open');
  await expect(page.locator('.notebook-entry')).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('caderno-desktop.png'), fullPage: true, animations: 'disabled' });
  const exported = await exportBackup(page);
  expect(exported.manifest.version).toBe(7);
  expect(exported.manifest.data.errorEntries).toHaveLength(1);
  expect(exported.manifest.data.errorEntries![0]).toMatchObject({ status: 'open', resolvedAt: null, practices: [{ description: 'Refiz dois exemplos sem consultar.' }] });
  expect(exported.manifest.data.reviewLogs).toEqual([]);
  expect(exported.manifest.data.reviewSchedules).toBeUndefined();
  await page.reload();
  await openNotebook(page);
  await page.locator('.notebook-entry').click();
  await expect(page.getByLabel(/^Correção/)).toHaveValue('A multiplicação vem antes da adição.');
  const other = await browser.newContext();
  try {
    const destination = await other.newPage();
    await destination.goto(baseURL!);
    await destination.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    await destination.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(exported.path);
    await expect(destination.getByRole('dialog')).toHaveCount(0);
    await openNotebook(destination);
    await destination.locator('.notebook-entry').click();
    await expect(destination.getByLabel(/^Próxima ação/)).toHaveValue('Refazer dois exemplos com operações.');
    await expect(destination.locator('.notebook-practice .notebook-history li')).toHaveCount(1);
  } finally { await other.close(); }
});

test('Errei oferece rascunho explícito e a prática do cartão retorna ao registro sem resolvê-lo', async ({ page }) => {
  await seed(page);
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await page.getByRole('radio', { name: 'Prática livre', exact: true }).check();
  await page.getByRole('button', { name: 'Começar revisão', exact: true }).click();
  await answer(page, 1);
  await page.getByRole('button', { name: 'Anotar no caderno de erros', exact: true }).click();
  await expect(page.getByLabel(/^O que aconteceu\?/)).toHaveValue(QUESTION);
  await expect(page.getByLabel(/^Fonte/)).toHaveValue('flashcard');
  await expect(page.locator('.notebook-count')).toHaveText('0 registros encontrados');
  await save(page);
  await expect(page.getByRole('region', { name: 'Fonte capturada ao criar' })).toContainText(QUESTION);
  await page.getByRole('button', { name: 'Praticar este cartão', exact: true }).click();
  await expect(page.locator('.review-card .front p')).toHaveText(QUESTION);
  await answer(page, 3);
  await page.getByRole('button', { name: 'Voltar ao registro de erro', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detalhes do registro', exact: true })).toBeVisible();
  await expect(page.locator('.notebook-record-meta')).toContainText('Aberto');
  await expect(page.locator('.notebook-reviews')).toContainText('Bom');
  const { manifest } = await exportBackup(page);
  expect(manifest.data.errorEntries).toHaveLength(1);
  expect(manifest.data.errorEntries![0].status).toBe('open');
  expect(manifest.data.reviewLogs).toHaveLength(2);
  expect(manifest.data.reviewSchedules).toBeUndefined();
});

test('caderno móvel acessível usa teclado e grava sem rede após carregar', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page);
  await openNotebook(page);
  await page.getByRole('button', { name: 'Novo erro', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByLabel(/^O que aconteceu\?/).focus();
  await page.keyboard.type('Preciso revisar o meu exemplo.');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel(/^Origem ou atividade/)).toBeFocused();
  await page.keyboard.type('Exercício sem conexão');
  const axe = await new AxeBuilder({ page }).include('.notebook-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(true);
  await save(page);
  await page.getByLabel(/^O que praticou\?/).fill('Refiz uma conta no papel.');
  await page.getByRole('button', { name: 'Registrar prática', exact: true }).click();
  await expect(page.locator('.notebook-practice .notebook-history li')).toHaveCount(1);
  await page.getByLabel(/^O que aconteceu\?/).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('caderno-mobile.png'), animations: 'disabled' });
  await context.setOffline(false);
  await page.reload();
  await openNotebook(page);
  await page.locator('.notebook-entry').click();
  await expect(page.getByLabel(/^O que aconteceu\?/)).toHaveValue('Preciso revisar o meu exemplo.');
  await expect(page.locator('.notebook-practice .notebook-history')).toContainText('Refiz uma conta no papel.');
});
