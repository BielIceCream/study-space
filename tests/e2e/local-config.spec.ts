import { expect, test } from '@playwright/test';

test('config e runtime ficam fora dos arquivos públicos e chamadas externas são recusadas', async ({ request }) => {
  const response = await request.get('/__studyspace_local__/config');
  const config = await response.json();
  expect(config.configured).toBe(false);
  expect(config.voiceEnabled).toBe(true);
  expect(config).not.toHaveProperty('apiKey');
  for (const path of ['/config/.env', '/.env', '/runtime/config.mjs']) expect((await request.get(path)).status()).toBe(404);
  expect((await request.post('/__studyspace_local__/jarvis', { headers: { Origin: 'https://example.invalid', 'X-StudySpace-Local': '1' }, data: { command: 'jarvis_list_voices' } })).status()).toBe(403);
  expect((await request.post('/__studyspace_local__/jarvis', { data: { command: 'jarvis_list_voices' } })).status()).toBe(403);
});

test('painel oferece vozes instaladas e o teste produz WAV local sem rede externa', async ({ page }) => {
  const external: string[] = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  const voices = page.getByRole('combobox', { name: 'Voz local', exact: true });
  await expect(voices).toHaveValue('Microsoft Maria Desktop');
  const response = page.waitForResponse(response => response.url().endsWith('/__studyspace_local__/jarvis') && response.request().postDataJSON()?.command === 'jarvis_synthesize');
  await page.getByRole('button', { name: 'Testar voz local', exact: true }).click();
  const audio = await (await response).json();
  expect(audio.mimeType).toBe('audio/wav');
  expect(Buffer.from(audio.audioBase64, 'base64').subarray(0, 4).toString()).toBe('RIFF');
  await expect(page.getByText('Voz sob seu controle', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(external).toEqual([]);
});

test('voz desativada no .env permanece silenciosa mesmo com preferência anterior', async ({ page }) => {
  let voiceRequests = 0;
  await page.addInitScript(() => localStorage.setItem('studyspace.jarvis.muted', 'false'));
  await page.route('**/__studyspace_local__/config', route => route.fulfill({ json: { configured: false, model: '', voiceEnabled: false, voiceId: '', volume: 0.8 } }));
  page.on('request', request => { if (request.url().endsWith('/__studyspace_local__/jarvis') && request.postDataJSON()?.command === 'jarvis_list_voices') voiceRequests++; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Silenciar respostas', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Testar voz local', exact: true })).toBeDisabled();
  expect(voiceRequests).toBe(0);
});
