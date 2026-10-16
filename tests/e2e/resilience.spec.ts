import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function subjectAndNote(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill('Estudo local');
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();
  await page.getByRole('button', { name: 'Criar minha primeira nota' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toBeVisible();
}

test('falha de disco conserva o banco e recupera o rascunho depois de recarregar', async ({ page, context }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (key === 'sqlite' && sessionStorage.getItem('simulate-full-storage') === 'true') {
        throw new DOMException('Sem espaço para gravar', 'QuotaExceededError');
      }
      return original.call(this, value, key);
    };
  });
  await subjectAndNote(page);
  await page.evaluate(() => sessionStorage.setItem('simulate-full-storage', 'true'));
  await page.getByLabel('Título da nota').fill('Um rascunho importante');
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).fill('Esta ideia precisa sobreviver à falha de gravação.');
  await expect(page.locator('.save-status.error')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('armazenamento local está cheio');

  // A second client reads only committed SQLite bytes, without mounting the note.
  const observer = await context.newPage();
  await observer.goto('/');
  await observer.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const [download] = await Promise.all([observer.waitForEvent('download'), observer.getByRole('button', { name: 'Exportar backup' }).click()]);
  const backup = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(backup.data.notes[0].plainText).toBe('');
  expect(backup.data.notes[0].revision).toBe(1);
  await observer.close();

  page.on('dialog', dialog => void dialog.accept());
  await page.reload();
  await page.locator('.subject-card').filter({ hasText: 'Estudo local' }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue('Um rascunho importante');
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('sobreviver à falha');
  await expect(page.getByText('Seu rascunho foi recuperado. Continue de onde parou.')).toBeVisible();
  await expect(page.locator('.save-status.error')).toBeVisible();
  await page.evaluate(() => sessionStorage.removeItem('simulate-full-storage'));
  await page.getByRole('button', { name: 'Tentar salvar' }).click();
  await expect(page.getByText('Salvo neste dispositivo', { exact: true })).toBeVisible();
  await page.reload();
  await page.locator('.subject-card').filter({ hasText: 'Estudo local' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('sobreviver à falha');
});

test('acessibilidade automática na biblioteca, temas, editor, formulário e revisão', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  async function check() {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(violation => ({
      id: violation.id,
      nodes: violation.nodes.map(node => ({ target: node.target, reason: node.failureSummary })),
    }))).toEqual([]);
  }
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Seu espaço, seu ritmo.' })).toBeVisible();
  await check();
  await page.getByRole('button', { name: 'Ativar tema escuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await check();
  await page.getByRole('button', { name: 'Ativar tema claro' }).click();
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill('Biologia');
  await check();
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();
  await page.getByRole('button', { name: 'Criar minha primeira nota' }).click();
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).fill('Uma nota acessível.');
  await expect(page.getByText('Salvo neste dispositivo', { exact: true })).toBeVisible();
  await check();
  await page.getByRole('button', { name: 'Criar cartão', exact: true }).click();
  await page.getByLabel('FRENTE · PERGUNTA').fill('O que é ATP?');
  await page.getByLabel('VERSO · RESPOSTA').fill('Uma molécula que armazena energia.');
  await check();
  await page.getByRole('button', { name: 'Criar flashcard', exact: true }).click();
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await page.getByRole('button', { name: 'Começar revisão' }).click();
  await check();
  await page.getByRole('button', { name: 'Revelar resposta', exact: true }).click();
  await check();
});
