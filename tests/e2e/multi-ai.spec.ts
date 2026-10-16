import { expect, test } from '@playwright/test';

test('15 provedores, NVIDIA, modelo manual e preferências separadas sem expor chaves', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  const provider = page.getByRole('combobox', { name: 'Provedor de IA', exact: true });
  await expect(provider.locator('option')).toHaveCount(15);
  await provider.selectOption('nvidia');
  await expect(page.getByText('Preencha NVIDIA_API_KEY em config/.env e reabra este painel.', { exact: true })).toBeVisible();
  await page.getByText('Informar ID do modelo manualmente', { exact: true }).click();
  await page.getByRole('textbox', { name: 'ID do modelo', exact: true }).fill('meta/test-model');
  await page.getByRole('button', { name: 'Testar conexão', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('NVIDIA_API_KEY');
  await provider.selectOption('groq');
  await expect(page.getByRole('textbox', { name: 'ID do modelo', exact: true })).toHaveValue('');
  await expect(page.getByText('Preencha GROQ_API_KEY em config/.env e reabra este painel.', { exact: true })).toBeVisible();
  await provider.selectOption('nvidia');
  await expect(page.getByRole('textbox', { name: 'ID do modelo', exact: true })).toHaveValue('meta/test-model');
  await page.reload();
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(provider).toHaveValue('nvidia');
  await page.getByText('Informar ID do modelo manualmente', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'ID do modelo', exact: true })).toHaveValue('meta/test-model');
});

test('trocar IA limpa histórico e consentimento e envia provedor e ferramentas corretos', async ({ page, request }) => {
  const config = await (await request.get('/__studyspace_local__/config')).json();
  config.provider = 'groq';
  config.providers = config.providers.map((item: { id: string }) => ({ ...item, configured: true, model: 'test-' + item.id }));
  await page.addInitScript(() => localStorage.setItem('studyspace.jarvis.muted', 'true'));
  await page.route('**/__studyspace_local__/config', route => route.fulfill({ json: config }));
  const chats: Record<string, any>[] = [];
  await page.route('**/__studyspace_local__/jarvis', route => {
    const { command, input } = route.request().postDataJSON();
    if (command === 'jarvis_has_api_key') return route.fulfill({ json: true });
    if (command === 'jarvis_list_models') return route.fulfill({ json: [{ id: 'test-' + input.provider, displayName: 'Teste ' + input.provider }] });
    if (command === 'jarvis_chat') {
      chats.push(input);
      return route.fulfill({ json: { text: 'Resposta ' + input.provider, conversationId: input.conversationId, status: 'success', actions: [], references: [] } });
    }
    return route.continue();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Provedor de IA', exact: true })).toHaveValue('groq');
  await expect(page.getByRole('combobox', { name: 'Modelo', exact: true }).locator('option')).toContainText(['Selecione um modelo', 'Teste groq']);
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await page.locator('.jarvis-consent input').check();
  await page.getByLabel('Mensagem para JARVIS').fill('Primeira conversa privada');
  await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(page.locator('.jarvis-turn.assistant')).toContainText('Resposta groq');
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await page.getByRole('combobox', { name: 'Provedor de IA', exact: true }).selectOption('openai');
  await page.getByRole('checkbox', { name: 'Usar ações JARVIS (modelo com ferramentas)', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(page.locator('.jarvis-consent input')).not.toBeChecked();
  await expect(page.locator('.jarvis-turn')).toHaveCount(0);
  await page.getByLabel('Mensagem para JARVIS').fill('Nova conversa');
  await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(page.locator('.jarvis-turn.assistant')).toContainText('Resposta openai');
  expect(chats).toHaveLength(2);
  expect(chats[0].provider).toBe('groq');
  expect(chats[1].provider).toBe('openai');
  expect(chats[1].tools).toBe(false);
  expect(chats[1].history).toEqual([]);
  expect(chats[1].context.contentShared).toBe(false);
  expect(chats[0].conversationId).not.toBe(chats[1].conversationId);
});
