import { chromium, expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const baseURL = 'http://127.0.0.1:1420';

async function createSubject(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill(name);
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('criar → escrever → cartão → revisar → reiniciar mantém dados, tema e fonte', async ({}, testInfo) => {
  const profile = testInfo.outputPath('persistent-profile');
  let context = await chromium.launchPersistentContext(profile, {
    headless: true, viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
  });
  try {
    let page = context.pages()[0];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(baseURL);
    await expect(page.getByRole('heading', { name: 'Seu espaço, seu ritmo.' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('biblioteca-clara.png'), fullPage: true, animations: 'disabled' });
    await createSubject(page, 'Biologia');
    await page.getByRole('button', { name: 'Criar minha primeira nota' }).click();
    await page.getByLabel('Título da nota').fill('Membrana plasmática');
    const editor = page.getByRole('textbox', { name: 'Conteúdo da nota' });
    await editor.fill('A membrana plasmática controla a entrada e a saída de substâncias da célula.');
    await editor.press('Control+a');
    await page.getByRole('button', { name: 'Negrito', exact: true }).click();
    await expect(editor.locator('strong')).toContainText('A membrana plasmática');
    await page.getByRole('button', { name: 'Criar cartão', exact: true }).click();
    await expect(page.getByLabel('VERSO · RESPOSTA')).toHaveValue(/controla a entrada/);
    await page.getByLabel('FRENTE · PERGUNTA').fill('Qual é a função da membrana plasmática?');
    await page.getByRole('button', { name: 'Criar flashcard', exact: true }).click();
    await page.getByRole('button', { name: 'Revisão', exact: true }).click();
    await page.getByRole('button', { name: 'Começar revisão' }).click();
    await page.keyboard.press('3');
    await expect(page.getByRole('button', { name: 'Revelar resposta', exact: true })).toBeVisible();
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: /Bom/ }).click();
    await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
    await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
    await page.getByRole('button', { name: 'Ativar tema escuro' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('biblioteca-escura.png'), fullPage: true, animations: 'disabled' });
    await expect(page.locator('.library-facts')).toContainText('1revisão hoje');
    await expect(page.locator('.subject-card')).toContainText('1 nota');
    await expect(page.locator('.subject-card')).toContainText('1 cartão');
    expect(pageErrors).toEqual([]);

    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      headless: true, viewport: { width: 1440, height: 1000 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo',
    });
    page = context.pages()[0];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(baseURL);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.subject-card')).toContainText('Biologia');
    await expect(page.locator('.library-facts')).toContainText('1revisão hoje');
    await page.getByRole('button', { name: 'Flashcards 1', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Qual é a função da membrana plasmática?' })).toBeVisible();
    await page.getByRole('button', { name: 'Membrana plasmática', exact: true }).click();
    await expect(page.getByLabel('Título da nota')).toHaveValue('Membrana plasmática');
    await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' }).locator('strong')).toContainText('controla a entrada');
    await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true, animations: 'disabled' });

    // The app is already loaded. All study I/O must continue without HTTP.
    await context.setOffline(true);
    await page.getByLabel('Título da nota').fill('Membrana — estudado offline');
    await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
    await expect(page.locator('.recent-note')).toContainText('Membrana — estudado offline');
    await context.setOffline(false);
    await page.reload();
    await expect(page.locator('.recent-note')).toContainText('Membrana — estudado offline');

    await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Exportar backup' }).click(),
    ]);
    const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(backup.data.subjects[0].name).toBe('Biologia');
    expect(backup.data.notes[0].title).toBe('Membrana — estudado offline');
    expect(backup.data.reviewLogs).toHaveLength(1);
    expect(backup.data.reviewLogs[0].rating).toBe(3);
    expect(backup.data.flashcards[0].noteId).toBe(backup.data.notes[0].id);
    expect(pageErrors).toEqual([]);
  } finally { await context.close(); }
});

test('duas abas não sobrescrevem gravações e uma nota sai com o último rascunho salvo', async ({ context, page }) => {
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/');
  await expect(page.getByRole('heading', { name: 'Seu espaço, seu ritmo.' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Seu espaço, seu ritmo.' })).toBeVisible();
  await Promise.all([createSubject(page, 'História'), createSubject(second, 'Química')]);
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await page.reload();
  await expect(page.locator('.subject-card')).toHaveCount(2);
  await page.locator('.subject-card').filter({ hasText: 'História' }).click();
  await page.getByRole('button', { name: 'Criar minha primeira nota' }).click();
  await page.getByLabel('Título da nota').fill('Revolução Industrial');
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).fill('Uma edição feita imediatamente antes de sair.');
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await second.reload();
  await second.getByRole('button', { name: /Revolução Industrial História/ }).click();
  await expect(second.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('imediatamente antes de sair');
});

test('busca por teclado, restauração e layout compacto', async ({ page, browser }, testInfo) => {
  await page.goto('/');
  await createSubject(page, 'Inglês');
  await page.getByRole('button', { name: 'Criar minha primeira nota' }).click();
  await page.getByLabel('Título da nota').fill('Vocabulário');
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).fill('Serendipity: encontrar algo bom por acaso.');
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Seu espaço, seu ritmo.' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByLabel('Busca global').fill('serendipity');
  await page.getByRole('dialog').getByRole('button', { name: 'Vocabulário Inglês', exact: true }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue('Vocabulário');

  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar backup' }).click()]);
  const backupPath = (await download.path())!;
  const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  try {
    const fresh = await freshContext.newPage();
    await fresh.goto(baseURL);
    await fresh.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    await fresh.getByLabel('Arquivo de backup').setInputFiles(backupPath);
    await expect(fresh.locator('.subject-card')).toContainText('Inglês');
    await fresh.getByRole('button', { name: /Vocabulário Inglês/ }).click();
    await expect(fresh.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('Serendipity');
    expect(await fresh.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await fresh.screenshot({ path: testInfo.outputPath('editor-compacto.png'), fullPage: true, animations: 'disabled' });
  } finally { await freshContext.close(); }
});
