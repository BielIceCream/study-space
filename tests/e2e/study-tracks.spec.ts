import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const openTracks = async (page: Page) => {
  await page.getByRole('button', { name: /^Trilhas(?:\s*\d+)?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Trilhas de estudo.' })).toBeVisible();
};
async function configure(page: Page, name = 'Minha base ENEM') {
  await openTracks(page);
  await page.getByRole('button', { name: 'Configurar minha trilha' }).click();
  await page.getByLabel('Nome da trilha', { exact: true }).fill(name);
  await page.getByLabel('Objetivo final').fill('Reconstruir minha base sem sobrecarga');
  await page.getByLabel('Ano escolar de partida').selectOption('concluido');
  await page.getByLabel('Data da prova (opcional)').fill('2027-11-07');
  await page.getByLabel('Disponibilidade semanal (minutos)').fill('240');
  await page.getByLabel('Dificuldade em Matemática', { exact: true }).selectOption('high');
  await page.getByLabel('Intensidade').selectOption('light');
  await page.getByLabel('Ritmo de progressão').selectOption('gradual');
  await page.getByLabel('Revisar a cada (dias)').fill('3');
  await page.getByLabel('Simulado a cada (semanas)').fill('2');
  await page.getByRole('button', { name: 'Salvar trilha', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('configura, liga material, retoma diagnóstico e restaura todo o estudo em outro perfil', async ({ page, browser, baseURL }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill('Matemática da biblioteca');
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();
  await page.getByRole('heading', { name: 'Matemática da biblioteca', exact: true }).click();
  await page.getByRole('button', { name: 'Criar minha primeira nota' }).click();
  await page.getByLabel('Título da nota').fill('Minha base de operações');
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).fill('Agrupar antes de somar.');
  await configure(page);
  await expect(page.getByRole('region', { name: 'Próximo passo sugerido' })).toContainText(/operações/i);
  await expect(page.locator('.study-evidence .study-status').first()).toHaveText('Ainda sem evidência');
  await page.getByRole('button', { name: 'Vincular materiais', exact: true }).first().click();
  await page.getByLabel('Matéria da biblioteca').selectOption({ label: 'Matemática da biblioteca' });
  await page.getByLabel('Minha base de operações', { exact: true }).check();
  await page.getByRole('button', { name: 'Salvar vínculo', exact: true }).click();
  await page.getByRole('button', { name: 'Minha base de operações', exact: true }).click();
  await expect(page.getByLabel('Título da nota')).toHaveValue('Minha base de operações');
  await openTracks(page);
  await page.getByRole('button', { name: 'Pular diagnóstico', exact: true }).click();
  await expect(page.locator('.study-diagnostic')).toContainText('Diagnóstico adiado');
  await page.getByRole('button', { name: 'Retomar diagnóstico', exact: true }).click();
  await page.locator('.study-answer').nth(0).click();
  await page.getByRole('button', { name: 'Próxima questão', exact: true }).click();
  await page.getByRole('button', { name: 'Encerrar diagnóstico por agora' }).click();
  await page.reload(); await openTracks(page);
  await expect(page.locator('.study-summary')).toContainText('240 min/semana');
  await page.getByRole('button', { name: 'Retomar diagnóstico', exact: true }).click();
  await expect(page.locator('.study-question-meta')).toContainText('Questão 2 de 12');
  await page.locator('.study-answer').nth(0).click();
  await page.getByRole('button', { name: 'Próxima questão', exact: true }).click();
  await expect(page.locator('.study-evidence').first()).toContainText('Reforçar a base');
  for (let index = 2; index < 12; index++) {
    await page.getByRole('button', { name: 'Não sei ainda', exact: true }).click();
    await page.getByRole('button', { name: index === 11 ? 'Ver resultado' : 'Próxima questão', exact: true }).click();
  }
  await expect(page.locator('.study-diagnostic')).toContainText('Diagnóstico concluído');
  await page.screenshot({ path: info.outputPath('trilha-desktop.png'), fullPage: true });
  const axe = await new AxeBuilder({ page }).include('.study-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations).toEqual([]);
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar backup', exact: true }).click()]);
  const path = (await download.path())!;
  const other = await browser.newContext();
  try {
    const destination = await other.newPage(); await destination.goto(baseURL!);
    await destination.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    await destination.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(path);
    await expect(destination.getByRole('dialog')).toHaveCount(0);
    await openTracks(destination);
    await expect(destination.locator('.study-summary')).toContainText('Minha base ENEM');
    await expect(destination.locator('.study-diagnostic')).toContainText('Diagnóstico concluído');
    await expect(destination.locator('.study-evidence').first()).toContainText('Amostra: 2 respostas');
    await expect(destination.getByRole('button', { name: 'Minha base de operações', exact: true })).toBeVisible();
  } finally { await other.close(); }
  expect(errors).toEqual([]);
});

test('formulário móvel com teclado e estudo local sem conexão', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await openTracks(page); await page.getByRole('button', { name: 'Configurar minha trilha' }).click();
  await expect(page.getByLabel('Nome da trilha', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(page.getByLabel('Objetivo final')).toBeFocused();
  await page.getByLabel('Disponibilidade semanal (minutos)').fill('90');
  await page.getByRole('button', { name: 'Salvar trilha', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Salvar trilha', exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('configuracao-mobile.png') });
  await page.getByRole('button', { name: 'Salvar trilha', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Editar configuração', exact: true }).click();
  await page.getByLabel('Objetivo final').fill('Estudar localmente');
  await page.getByRole('button', { name: 'Salvar trilha', exact: true }).click();
  await expect(page.locator('.study-summary')).toContainText('Estudar localmente');
  await page.getByRole('button', { name: 'Iniciar diagnóstico', exact: true }).click();
  await page.getByRole('button', { name: 'Não sei ainda', exact: true }).click();
  await page.getByRole('button', { name: 'Próxima questão', exact: true }).click();
  await expect(page.locator('.study-question-meta')).toContainText('Questão 2 de 12');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('diagnostico-mobile.png'), fullPage: true });
  await context.setOffline(false); await page.reload(); await openTracks(page);
  await expect(page.locator('.study-summary')).toContainText('Estudar localmente');
  await expect(page.locator('.study-question-meta')).toContainText('Questão 2 de 12');
});
