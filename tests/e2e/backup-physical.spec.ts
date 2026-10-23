import { expect, test, type Page } from '@playwright/test';
import { open, readFile } from 'node:fs/promises';
import type { BackupDocument } from '../../src/shared/types';
import { ARCHIVE_MAGIC, createBackupArchive, readBackupArchive } from '../../src/services/backup-archive';
import { advanceSchedule } from '../../src/domain/spaced-repetition/engine';

async function exportBackup(page: Page) {
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Exportar backup', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^studyspace-backup-\d{4}-\d{2}-\d{2}\.studyspace$/);
  const path = (await download.path())!;
  const bytes = await readFile(path);
  const archive = await readBackupArchive(new Blob([new Uint8Array(bytes)]));
  const backup = archive.manifest;
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  return { path, bytes, archive, backup };
}

test('o pacote binário preserva Unicode, materiais e revisões ao restaurar em outro perfil', async ({ page, browser, baseURL }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill('Biologia — memória 🧠');
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();

  const material = Buffer.from(JSON.stringify({
    format: 'studyspace-import', version: 1,
    notes: [{ title: 'Células e revisão 🧠', text: 'A célula mantém o equilíbrio.\nRevisão com acentuação.' }],
    flashcards: [{ front: 'O que é homeostase? 🧠', back: 'Manutenção do equilíbrio interno.', tags: ['biologia', 'revisão'], noteIndex: 0 }],
  }), 'utf8');
  await page.getByRole('button', { name: 'Importar material', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: 'Importar material' });
  await importDialog.getByLabel('Arquivo', { exact: true }).setInputFiles({ name: 'células.json', mimeType: 'application/json', buffer: material });
  await importDialog.getByRole('button', { name: 'Ver prévia', exact: true }).click();
  await expect(importDialog.getByRole('region', { name: 'Prévia da importação' })).toContainText('1 cartões');
  await importDialog.getByRole('button', { name: 'Confirmar importação', exact: true }).click();
  await expect(importDialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await page.getByRole('button', { name: 'Começar revisão' }).click();
  await page.getByRole('button', { name: 'Revelar resposta', exact: true }).click();
  await page.getByRole('button', { name: /Bom/ }).click();
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await page.getByRole('button', { name: 'Ativar tema escuro' }).click();
  await page.locator('.recent-note').filter({ hasText: 'Células e revisão 🧠' }).click();
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).fill('A célula mantém o equilíbrio.\nÚltima edição imediatamente antes da exportação 🧠.');

  const exported = await exportBackup(page);
  expect(exported.backup.version).toBe(3);
  expect(exported.bytes.byteLength).toBeGreaterThan(Buffer.byteLength(JSON.stringify(exported.backup), 'utf8'));
  expect(exported.backup.data.notes[0].plainText).toContain('A célula mantém o equilíbrio.');
  expect(exported.backup.data.notes[0].plainText).toContain('Última edição imediatamente antes da exportação 🧠.');
  expect(exported.backup.data.reviewLogs).toHaveLength(1);
  expect(exported.backup.data.cardMetadata?.[0].tags).toEqual(['biologia', 'revisão']);
  expect(Buffer.from(await exported.archive.readMaterial(0))).toEqual(material);

  const isolated = await browser.newContext({ baseURL });
  try {
    const restored = await isolated.newPage();
    await restored.goto('/');
    await expect(restored.locator('.subject-card')).toHaveCount(0);
    await restored.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    const corrupt = Buffer.from(exported.bytes);
    corrupt[corrupt.length - 1] ^= 1;
    await restored.getByLabel('Arquivo de backup').setInputFiles({
      name: 'material-corrompido.studyspace', mimeType: 'application/octet-stream', buffer: corrupt,
    });
    await expect(restored.getByRole('alert')).toContainText('integridade');
    await expect(restored.locator('.subject-card')).toHaveCount(0);
    await restored.getByLabel('Arquivo de backup').setInputFiles(exported.path);
    await expect(restored.locator('.subject-card')).toContainText('Biologia — memória 🧠');
    await restored.reload();
    await expect(restored.locator('html')).toHaveAttribute('data-theme', 'dark');
    const roundtrip = await exportBackup(restored);
    expect(roundtrip.backup.data).toEqual(exported.backup.data);
    expect(roundtrip.backup.materials).toEqual(exported.backup.materials);
    expect(Buffer.from(await roundtrip.archive.readMaterial(0))).toEqual(material);
  } finally { await isolated.close(); }
});

test('JSON inválido e pacote acima de 256 MiB não alteram a biblioteca existente', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Nova matéria', exact: true }).click();
  await page.getByLabel('Nome da matéria').fill('Dados que devem permanecer');
  await page.getByRole('button', { name: 'Criar matéria', exact: true }).click();
  await page.getByRole('button', { name: 'Criar minha primeira nota' }).click();
  await page.getByLabel('Título da nota').fill('Não sobrescrever');
  await page.getByRole('textbox', { name: 'Conteúdo da nota' }).fill('Conteúdo original, íntegro e local.');
  await page.getByRole('button', { name: 'Biblioteca', exact: true }).click();
  const before = await exportBackup(page);

  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Importar backup', exact: true })).toBeDisabled();
  // Exercise the file handler even if a file selection arrives after the library became nonempty.
  await page.getByLabel('Arquivo de backup').setInputFiles({ name: 'incompleto.json', mimeType: 'application/json', buffer: Buffer.from('{"format":') });
  await expect(page.getByRole('alert')).toContainText('Este arquivo não contém um backup JSON válido.');

  const oversizedPath = testInfo.outputPath('backup-acima-do-limite.studyspace');
  const oversized = await open(oversizedPath, 'w');
  try {
    await oversized.write(ARCHIVE_MAGIC);
    await oversized.truncate(256 * 1024 * 1024 + 1);
  }
  finally { await oversized.close(); }
  await page.getByLabel('Arquivo de backup').setInputFiles(oversizedPath);
  await expect(page.getByRole('alert')).toContainText(/256\s*(MB|MiB)/);
  await page.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  await page.reload();
  const after = await exportBackup(page);
  expect(after.backup.data).toEqual(before.backup.data);
  expect(after.backup.materials).toEqual(before.backup.materials);
});

test('continua importando um backup JSON v2 e exporta o conteúdo no pacote atual', async ({ page }) => {
  const time = '2026-10-18T12:00:00.000Z';
  const text = 'Conteúdo legado com ação, acentuação e memória 🧠.';
  const legacy: BackupDocument = {
    format: 'studyspace-backup', version: 2, exportedAt: time,
    data: {
      subjects: [{ id: 'legacy-subject', name: 'História anterior', accent: 'rose', createdAt: time, updatedAt: time }],
      notes: [{ id: 'legacy-note', subjectId: 'legacy-subject', title: 'Documento antigo', bodyJson: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }, plainText: text, revision: 4, createdAt: time, updatedAt: time }],
      flashcards: [], reviewLogs: [], settings: { theme: 'dark' }, documents: [], cardMetadata: [],
    },
    materials: { documents: [], assets: [] },
  };
  await page.goto('/');
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await page.getByLabel('Arquivo de backup').setInputFiles({
    name: 'backup-antigo-v2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy, null, 2)),
  });
  await expect(page.locator('.subject-card')).toContainText('História anterior');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const exported = await exportBackup(page);
  expect(exported.backup.data).toEqual(legacy.data);
  expect(exported.backup.materials).toEqual(legacy.materials);
});

test('restaura agenda v6 após reinício e mantém a prática livre sem reagendar cartões', async ({ page }) => {
  const fixture: BackupDocument = JSON.parse(await readFile(new URL('../fixtures/recovery-parity.json', import.meta.url), 'utf8'));
  const log = { id: 'spaced-review', flashcardId: fixture.data.flashcards[0].id, sessionId: 'spaced-session', rating: 3 as const, reviewedAt: fixture.exportedAt };
  const state = advanceSchedule(undefined, log);
  const materials = fixture.materials!;
  const archive = await createBackupArchive({
    format: fixture.format, version: 6, exportedAt: fixture.exportedAt,
    data: { ...fixture.data, reviewLogs: [...fixture.data.reviewLogs, log], reviewSchedules: [state] },
    materials: {
      documents: materials.documents.map(doc => ({ documentId: doc.documentId, byteLength: Buffer.from(doc.dataBase64, 'base64').length, pages: doc.pages })),
      assets: materials.assets.map(({ dataBase64, ...asset }) => ({ ...asset, byteLength: Buffer.from(dataBase64, 'base64').length })),
    },
  }, async index => new Uint8Array(Buffer.from([...materials.documents, ...materials.assets][index].dataBase64, 'base64')));
  await page.goto('/');
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await page.getByLabel('Arquivo de backup').setInputFiles({ name: 'agenda-v6.studyspace', mimeType: 'application/octet-stream', buffer: Buffer.from(await archive.arrayBuffer()) });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  const before = await exportBackup(page);
  expect(before.backup.version).toBe(6);
  expect(before.backup.data.reviewSchedules).toEqual([state]);
  await page.getByRole('button', { name: 'Revisão', exact: true }).click();
  await expect(page.getByText('Prática livre · sem agendamento automático')).toBeVisible();
  await page.getByRole('button', { name: 'Começar revisão' }).click();
  await page.getByRole('button', { name: 'Revelar resposta', exact: true }).click();
  await page.getByRole('button', { name: /Errei/ }).click();
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  const after = await exportBackup(page);
  expect(after.backup.data.reviewLogs).toHaveLength(before.backup.data.reviewLogs.length + 1);
  expect(after.backup.data.reviewSchedules).toEqual([state]);
  expect(after.backup.materials).toEqual(before.backup.materials);
});
