import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { JarvisStudyContext } from '../../src/services/jarvis/types';

const fixture = (extension: string) => fileURLToPath(new URL(`../../src/services/import/fixtures/studyspace.${extension}`, import.meta.url));
async function createSubject(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill('Biologia importada');
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Biologia importada', exact: true })).toBeVisible();
}
async function preview(page: Page, extension: string) {
  await page.getByRole('button', { name: 'Importar material', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar material' });
  await dialog.getByLabel('Arquivo', { exact: true }).setInputFiles(fixture(extension));
  await dialog.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await expect(dialog.getByRole('region', { name: 'Prévia da importação' })).toBeVisible();
  return dialog;
}
async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirmar importação', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function backup(page: Page) {
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar backup', exact: true }).click()]);
  const parsed = JSON.parse(await readFile((await download.path())!, 'utf8'));
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  return parsed;
}

test('CSV tem prévia reversível, detecta duplicatas, e JSON preserva nota e cartão após reload', async ({ page }) => {
  await createSubject(page);
  const first = await preview(page, 'csv');
  await expect(first.getByRole('region')).toContainText('2 cartões');
  await first.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect((await backup(page)).data.flashcards).toHaveLength(0);
  await preview(page, 'csv'); await confirm(page);
  const repeated = await preview(page, 'csv');
  await expect(repeated.getByRole('region')).toContainText('2 cartões repetidos identificados.');
  await confirm(page);
  const json = await preview(page, 'json'); await expect(json.getByRole('region')).toContainText('Aula JSON'); await confirm(page);
  await page.reload();
  await page.getByRole('navigation', { name: 'Matérias', exact: true }).getByRole('button', { name: 'Biologia importada' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('Fonte textual preservada.');
  const exported = await backup(page);
  expect(exported.version).toBe(2); expect(exported.data.flashcards).toHaveLength(3); expect(exported.data.notes).toHaveLength(1);
  const card = exported.data.flashcards.find((entry: { front: string }) => entry.front === 'Pergunta JSON');
  expect(card.noteId).toBe(exported.data.notes[0].id);
  expect(exported.data.cardMetadata.find((entry: { flashcardId: string }) => entry.flashcardId === card.id).tags).toEqual(['biologia']);
  expect(exported.data.documents).toHaveLength(1);
  expect(exported.data.documents[0].kind).toBe('json');
  expect(Buffer.from(exported.materials.documents[0].dataBase64, 'base64')).toEqual(await readFile(fixture('json')));
  await page.getByRole('button', { name: 'Flashcards 3', exact: true }).click();
  await page.getByRole('button', { name: 'Exportar JSON', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Exportar cartões JSON', exact: true });
  await expect(exportDialog).toContainText('Para preservar imagens, fontes e histórico, use o backup completo.');
  const [download] = await Promise.all([page.waitForEvent('download'), exportDialog.getByRole('button', { name: 'Baixar JSON', exact: true }).click()]);
  const interchange = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(Object.keys(interchange).sort()).toEqual(['flashcards', 'format', 'version']);
  expect(interchange.format).toBe('studyspace-import'); expect(interchange.version).toBe(1);
  expect(interchange.flashcards).toHaveLength(3);
  expect(interchange.flashcards.find((entry: { front: string }) => entry.front === 'Pergunta JSON')).toEqual({ front: 'Pergunta JSON', back: 'Resposta JSON', tags: ['biologia'] });
  expect(interchange.flashcards.map((entry: { front: string; back: string }) => [entry.front, entry.back]).sort()).toEqual(exported.data.flashcards.map((entry: { front: string; back: string }) => [entry.front, entry.back]).sort());
});

test('CSV sem cabeçalho preserva primeira linha e respeita mapeamento manual com cabeçalho', async ({ page }) => {
  await createSubject(page);
  await page.getByRole('button', { name: 'Importar material', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Importar material', exact: true });
  const upload = { name: 'sem-cabecalho.csv', mimeType: 'text/csv', buffer: Buffer.from('Qual é a primeira pergunta?;Primeira resposta.\nQual é a segunda pergunta?;Segunda resposta.', 'utf8') };
  await dialog.getByLabel('Arquivo', { exact: true }).setInputFiles(upload);
  await dialog.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  let region = dialog.getByRole('region', { name: 'Prévia da importação', exact: true });
  await expect(region.locator(':scope > strong')).toHaveText('0 notas · 2 cartões · 0 documentos');
  await expect(region.locator('article strong').first()).toHaveText('Qual é a primeira pergunta?');
  await expect(dialog.getByRole('checkbox', { name: 'Primeira linha é cabeçalho', exact: true })).not.toBeChecked();
  await confirm(page);
  let exported = await backup(page);
  expect(exported.data.flashcards).toHaveLength(2);
  expect(exported.data.flashcards).toEqual(expect.arrayContaining([
    expect.objectContaining({ front: 'Qual é a primeira pergunta?', back: 'Primeira resposta.' }),
    expect.objectContaining({ front: 'Qual é a segunda pergunta?', back: 'Segunda resposta.' }),
  ]));

  await page.getByRole('button', { name: 'Importar material', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Importar material', exact: true });
  await dialog.getByLabel('Arquivo', { exact: true }).setInputFiles(fixture('csv'));
  await dialog.getByLabel('Coluna da pergunta', { exact: true }).fill('2');
  await dialog.getByLabel('Coluna da resposta', { exact: true }).fill('1');
  await dialog.getByRole('checkbox', { name: 'Primeira linha é cabeçalho', exact: true }).check();
  await dialog.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  region = dialog.getByRole('region', { name: 'Prévia da importação', exact: true });
  await expect(region.locator(':scope > strong')).toHaveText('0 notas · 2 cartões · 0 documentos');
  await expect(region.locator('article strong').first()).toHaveText('A passagem de substâncias.');
  await expect(region.locator('article p').first()).toHaveText('O que regula a membrana?');
  await expect(dialog.getByLabel('Coluna da pergunta', { exact: true })).toHaveValue('2');
  await expect(dialog.getByLabel('Coluna da resposta', { exact: true })).toHaveValue('1');
  await expect(dialog.getByRole('checkbox', { name: 'Primeira linha é cabeçalho', exact: true })).toBeChecked();

  // A new file renews autodetection rather than carrying the preceding explicit mapping.
  await dialog.getByLabel('Arquivo', { exact: true }).setInputFiles(upload);
  await dialog.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await expect(region.locator(':scope > strong')).toHaveText('0 notas · 2 cartões · 0 documentos');
  await expect(region.locator('article strong').first()).toHaveText('Qual é a primeira pergunta?');
  await expect(dialog.getByLabel('Coluna da pergunta', { exact: true })).toHaveValue('1');
  await expect(dialog.getByLabel('Coluna da resposta', { exact: true })).toHaveValue('2');
  await expect(dialog.getByRole('checkbox', { name: 'Primeira linha é cabeçalho', exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();

  await page.getByRole('button', { name: 'Importar material', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Importar material', exact: true });
  await dialog.getByLabel('Arquivo', { exact: true }).setInputFiles(fixture('csv'));
  await dialog.getByLabel('Coluna da pergunta', { exact: true }).fill('2');
  await dialog.getByLabel('Coluna da resposta', { exact: true }).fill('1');
  await dialog.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await confirm(page); await page.reload(); exported = await backup(page);
  expect(exported.data.flashcards).toHaveLength(4);
  expect(exported.data.flashcards).toEqual(expect.arrayContaining([
    expect.objectContaining({ front: 'Qual é a primeira pergunta?', back: 'Primeira resposta.' }),
    expect.objectContaining({ front: 'A passagem de substâncias.', back: 'O que regula a membrana?' }),
    expect.objectContaining({ front: 'Resposta com ; separador', back: 'Linha múltipla\ncontinua' }),
  ]));
});

for (const extension of ['pdf', 'docx']) {
  test(`${extension.toUpperCase()} conserva bytes e texto, abre fonte e envia trecho só com consentimento`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await createSubject(page); const dialog = await preview(page, extension);
    await expect(dialog.getByRole('region')).toContainText('1 documentos'); await confirm(page); await page.reload();
    await page.getByRole('navigation', { name: 'Matérias', exact: true }).getByRole('button', { name: 'Biologia importada' }).click();
    await page.getByRole('button', { name: `Abrir documento original: studyspace.${extension}`, exact: true }).click();
    const reader = page.getByRole('dialog', { name: `studyspace.${extension}`, exact: true });
    await expect(reader.locator('.document-text')).toContainText(extension === 'pdf' ? 'membrane' : 'Membrana celular');
    if (extension === 'pdf') {
      await expect(reader.getByRole('img', { name: 'Página 1 do PDF' }).or(reader.locator('canvas'))).toBeVisible();
      await reader.getByRole('button', { name: 'Próxima', exact: true }).click();
      await expect(reader.getByLabel('Página do documento')).toHaveValue('2');
      await expect(reader.locator('.document-text')).toContainText('transport and review');
    }
    const [download] = await Promise.all([page.waitForEvent('download'), reader.getByRole('button', { name: 'Baixar original', exact: true }).click()]);
    expect(await readFile((await download.path())!)).toEqual(await readFile(fixture(extension)));
    await page.screenshot({ path: testInfo.outputPath(`${extension}-reader.png`), fullPage: true });
    await reader.getByRole('button', { name: 'Explicar', exact: true }).click();
    const jarvis = page.getByRole('region', { name: 'Assistente JARVIS', exact: true });
    await expect(jarvis.getByRole('checkbox')).not.toBeChecked();
    await expect(jarvis.getByRole('checkbox')).toHaveCount(1);
    await jarvis.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
    await expect(jarvis.getByText('Preencha GEMINI_API_KEY em config/.env e reabra este painel.', { exact: true })).toBeVisible();
    await jarvis.getByRole('button', { name: 'Fechar JARVIS', exact: true }).click();
    const exported = await backup(page); const doc = exported.data.documents[0]; const original = await readFile(fixture(extension));
    expect(doc.sha256).toBe(createHash('sha256').update(original).digest('hex'));
    expect(Buffer.from(exported.materials.documents[0].dataBase64, 'base64')).toEqual(original);
    expect(exported.materials.documents[0].pages.length).toBe(extension === 'pdf' ? 2 : 1);
    expect(errors).toEqual([]);
  });
}

test('APKG SQLite real preserva reverso, cloze e imagem e registra revisão durável', async ({ page }) => {
  await createSubject(page); const dialog = await preview(page, 'apkg');
  await expect(dialog.getByRole('region')).toContainText('4 cartões');
  await expect(dialog.getByRole('region')).toContainText('imagem(ns) preservada(s)'); await confirm(page); await page.reload();
  await page.getByRole('button', { name: 'Flashcards 4', exact: true }).click();
  await expect(page.locator('.flashcard-preview')).toHaveCount(4);
  const image = page.locator('.flashcard-preview img').first(); await expect(image).toBeVisible();
  expect(await image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await page.getByRole('button', { name: 'Começar revisão', exact: true }).click();
  for (let index = 0; index < 4; index += 1) {
    await page.getByRole('button', { name: 'Revelar resposta', exact: true }).click();
    await page.getByRole('button', { name: /^Bom/ }).click();
  }
  await expect(page.getByRole('heading', { name: 'Sua memória agradece.' })).toBeVisible();
  await page.reload(); const exported = await backup(page);
  expect(exported.data.reviewLogs).toHaveLength(4); expect(exported.materials.assets).toHaveLength(1);
  expect(exported.data.cardMetadata.some((entry: { images: unknown[] }) => entry.images.length > 0)).toBe(true);
  expect(exported.data.flashcards.some((entry: { front: string }) => entry.front.includes('[…]'))).toBe(true);
  expect(exported.data.flashcards.some((entry: { front: string }) => entry.front === 'Regular a passagem de substâncias.')).toBe(true);
});

test('JARVIS local pede a chave no .env e não simula resposta de IA ou conexão', async ({ page }) => {
  const providerRequests: string[] = [];
  page.on('request', request => { if (/googleapis|generativelanguage/i.test(request.url())) providerRequests.push(request.url()); });
  await page.goto('/'); await page.getByRole('button', { name: 'Abrir JARVIS', exact: true }).click();
  const jarvis = page.getByRole('region', { name: 'Assistente JARVIS', exact: true });
  await jarvis.getByLabel('Mensagem para JARVIS').fill('Quanto é 1 + 1?');
  await jarvis.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
  await expect(jarvis.getByText('Preencha GEMINI_API_KEY em config/.env e reabra este painel.', { exact: true })).toBeVisible();
  await jarvis.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(jarvis.locator('.jarvis-turn.assistant')).toContainText('config/.env');
  await expect(jarvis.locator('.jarvis-turn.assistant')).not.toContainText('2');
  await jarvis.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(jarvis.getByText('Preencha GEMINI_API_KEY em config/.env e reabra este painel.', { exact: true })).toBeVisible();
  await expect(jarvis.getByLabel('Chave Gemini')).toHaveCount(0);
  await jarvis.getByRole('button', { name: 'Atualizar modelos', exact: true }).click();
  await expect(jarvis.getByRole('alert')).toContainText('config\\.env');
  expect(providerRequests).toEqual([]);
  expect((await backup(page)).data.flashcards).toHaveLength(0);
});

test('proposta JARVIS com ponte API simulada só grava no SQLite real após confirmar', async ({ page }, testInfo) => {
  // Only the provider/credential/voice bridge is simulated, after browser SQLite initializes.
  // This verifies UI confirmation and persistence, not a live Gemini call or physical audio.
  const providerRequests: string[] = [];
  page.on('request', request => { if (/googleapis|generativelanguage/i.test(request.url())) providerRequests.push(request.url()); });
  await createSubject(page); await preview(page, 'txt'); await confirm(page);
  const before = await backup(page);
  expect(before.data.flashcards).toHaveLength(0);
  await page.getByRole('navigation', { name: 'Matérias', exact: true }).getByRole('button', { name: 'Biologia importada' }).click();
  await expect(page.getByRole('textbox', { name: 'Conteúdo da nota' })).toContainText('A membrana celular regula a passagem de substâncias.');
  await page.evaluate(() => {
    const commands: string[] = [];
    const requests: Record<string, unknown>[] = [];
    Object.assign(window, {
      isTauri: true,
      __missionApiMock: { commands, requests },
      __TAURI_INTERNALS__: {
        async invoke(command: string, args: { input?: Record<string, unknown> } = {}) {
          commands.push(command);
          if (command === 'jarvis_has_api_key') return true;
          if (command === 'jarvis_list_voices') return [];
          if (command === 'jarvis_list_models') return [{ id: 'models/mock-ui', displayName: 'Modelo simulado para teste de interface' }];
          if (command === 'jarvis_chat') {
            const input = args.input!;
            requests.push(structuredClone(input));
            const context = input.context as { activeSubject?: { id: string } };
            return {
              status: 'success', text: 'Proposta simulada: confira os três cartões antes de salvar.', conversationId: input.conversationId, references: [],
              actions: [{ name: 'propose_flashcards', args: { subjectId: context.activeSubject?.id, cards: [
                { front: 'O que regula a membrana celular?', back: 'A passagem de substâncias.' },
                { front: 'Qual estrutura regula a passagem de substâncias?', back: 'A membrana celular.' },
                { front: 'Qual assunto aparece na fonte compartilhada?', back: 'Membrana celular.' },
              ] } }],
            };
          }
          if (command === 'jarvis_cancel_request') return;
          throw new Error(`Comando não autorizado na ponte simulada: ${command}`);
        },
      },
    });
  });
  await page.getByRole('button', { name: 'Abrir documento original: studyspace.txt', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Gerar flashcards', exact: true }).click();
  const jarvis = page.getByRole('region', { name: 'Assistente JARVIS', exact: true });
  await jarvis.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await jarvis.getByRole('combobox', { name: 'Modelo', exact: true }).selectOption('models/mock-ui');
  await jarvis.getByRole('checkbox', { name: 'Silenciar respostas', exact: true }).check();
  await jarvis.getByRole('button', { name: 'Configurar JARVIS', exact: true }).click();
  await expect(jarvis.getByRole('checkbox')).not.toBeChecked();
  await jarvis.getByRole('checkbox').check();
  const requestProposal = async () => {
    await jarvis.getByLabel('Mensagem para JARVIS').fill('Gere três cartões fundamentados no trecho autorizado.');
    await jarvis.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Importar material', exact: true });
    await expect(dialog.getByRole('region', { name: 'Prévia da importação' })).toContainText('3 cartões');
    await expect(dialog).toContainText('Nenhum cartão foi salvo automaticamente.');
    await expect(dialog).toContainText('Fonte: studyspace.txt · página 1');
    return dialog;
  };
  const proposal = await requestProposal();
  await page.screenshot({ path: testInfo.outputPath('proposta-api-simulada-previa.png'), fullPage: true });
  await proposal.getByRole('button', { name: 'Cancelar', exact: true }).click();
  const cancelled = await backup(page);
  expect(cancelled.data).toEqual(before.data);
  expect(cancelled.materials).toEqual(before.materials);
  await requestProposal(); await confirm(page);
  const simulated = await page.evaluate(() => (window as unknown as { __missionApiMock: { commands: string[]; requests: { context: JarvisStudyContext; model: string }[] } }).__missionApiMock);
  expect(simulated.requests).toHaveLength(2);
  for (const request of simulated.requests) {
    expect(request.model).toBe('models/mock-ui'); expect(request.context.contentShared).toBe(true);
    expect(request.context.activeSubject?.id).toBe(before.data.subjects[0].id);
    expect(request.context.activeNote?.id).toBe(before.data.notes[0].id);
    expect(request.context.excerpts).toEqual([{ documentId: before.data.documents[0].id, title: 'studyspace.txt', page: 1, text: before.materials.documents[0].pages[0].text.trim() }]);
    expect(JSON.stringify(request.context)).not.toContain('dataBase64');
  }
  expect(simulated.commands.every(command => command.startsWith('jarvis_'))).toBe(true);
  expect(simulated.commands).not.toContain('jarvis_synthesize');
  expect(simulated.commands).not.toContain('jarvis_transcribe');
  await page.reload();
  await page.getByRole('button', { name: 'Flashcards 3', exact: true }).click();
  await expect(page.locator('.flashcard-preview')).toHaveCount(3);
  const persisted = await backup(page);
  expect(persisted.data.flashcards).toHaveLength(3);
  expect(persisted.data.notes).toEqual(before.data.notes);
  expect(persisted.materials).toEqual(before.materials);
  expect(persisted.data.flashcards.every((card: { subjectId: string; back: string }) => card.subjectId === before.data.subjects[0].id && card.back.includes('Fonte: studyspace.txt · página 1'))).toBe(true);
  expect(persisted.data.cardMetadata.every((metadata: { tags: string[] }) => metadata.tags.includes('JARVIS'))).toBe(true);
  expect(providerRequests).toEqual([]);
});
