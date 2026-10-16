import { expect, test } from '@playwright/test';

test('carrega todos os provedores configurados uma vez e preserva a lista correta durante trocas', async ({ page, request }) => {
  const config = await (await request.get('/__studyspace_local__/config')).json();
  config.provider = 'groq';
  config.providers = config.providers.map((item: { id: string }) => ({ ...item, configured: ['groq', 'openai', 'nvidia'].includes(item.id), model: '' }));
  const requests: Record<string, number> = {};
  await page.route('**/__studyspace_local__/config', route => route.fulfill({ json: config }));
  await page.route('**/__studyspace_local__/jarvis', async route => {
    const { command, input } = route.request().postDataJSON();
    if (command !== 'jarvis_list_models') return route.continue();
    const id = input.provider as string;
    requests[id] = (requests[id] ?? 0) + 1;
    if (id === 'groq') await new Promise(resolve => setTimeout(resolve, 1000));
    await route.fulfill({ json: [{ id: id + '-one', displayName: 'Modelo ' + id }] });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  const provider = page.getByRole('combobox', { name: 'Provedor de IA', exact: true });
  const model = page.getByRole('combobox', { name: 'Modelo', exact: true });
  await expect(provider).toHaveValue('groq');
  await provider.selectOption('nvidia');
  await expect(model).toHaveValue('nvidia-one');
  await expect.poll(() => requests.groq).toBe(1);
  await expect(provider.locator('option[value="groq"]')).toContainText('1 modelo');
  await expect(model.locator('option')).toContainText(['Selecione um modelo', 'Modelo nvidia']);
  await provider.selectOption('openai');
  await expect(model).toHaveValue('openai-one');
  await provider.selectOption('groq');
  await expect(model).toHaveValue('groq-one');
  await provider.selectOption('nvidia');
  await expect(model).toHaveValue('nvidia-one');
  await page.getByRole('button', { name: 'Fechar JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  const settings = page.getByRole('button', { name: 'Configurar JARVIS', exact: true });
  if (await settings.getAttribute('aria-expanded') !== 'true') await settings.click();
  await expect(model).toHaveValue('nvidia-one');
  expect(requests).toEqual({ groq: 1, openai: 1, nvidia: 1 });
});

test('microfone sem chave tem aparência de botão e abre a configuração ao clicar', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  const mic = page.getByRole('button', { name: 'Configurar microfone', exact: true });
  await expect(mic).toBeEnabled();
  expect(await mic.evaluate(element => getComputedStyle(element).cursor)).toBe('pointer');
  const box = await mic.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await mic.click();
  await expect(page.getByRole('combobox', { name: 'Provedor de IA', exact: true })).toBeVisible();
  await expect(page.getByText('Para usar o microfone, configure a chave de Gemini, Groq ou OpenAI no arquivo config/.env.', { exact: true })).toBeVisible();
});

test('Falar aciona a captura e orienta quando a permissão do microfone é negada', async ({ page, request }) => {
  const config = await (await request.get('/__studyspace_local__/config')).json();
  config.provider = 'groq';
  config.providers = config.providers.map((item: { id: string }) => ({ ...item, configured: item.id === 'groq', model: item.id === 'groq' ? 'groq-test' : '' }));
  await page.addInitScript(() => {
    Object.assign(window, { __micCalls: 0 });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => {
      const state = window as unknown as { __micCalls: number }; state.__micCalls++;
      throw new DOMException('Permission denied for test', 'NotAllowedError');
    } });
  });
  await page.route('**/__studyspace_local__/config', route => route.fulfill({ json: config }));
  await page.route('**/__studyspace_local__/jarvis', route => {
    if (route.request().postDataJSON().command === 'jarvis_list_models') return route.fulfill({ json: [{ id: 'groq-test', displayName: 'Modelo Groq' }] });
    return route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Modelo', exact: true })).toHaveValue('groq-test');
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  const mic = page.getByRole('button', { name: 'Falar com JARVIS', exact: true });
  await expect(mic).toHaveText('Falar');
  await mic.click();
  await expect(page.getByRole('alert')).toContainText('Permita o acesso ao microfone');
  expect(await page.evaluate(() => (window as unknown as { __micCalls: number }).__micCalls)).toBe(1);
});
