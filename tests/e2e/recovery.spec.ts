import { expect, test, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import type { BackupDocument } from '../../src/shared/types';
import { readBackupArchive } from '../../src/services/backup-archive';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const fixture = JSON.parse(await readFile(new URL('../fixtures/recovery-parity.json', import.meta.url), 'utf8')) as BackupDocument;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function databaseBytes(version: number, subjectName?: string) {
  const SQL = await sql;
  const db = new SQL.Database();
  try {
    db.exec(await readFile(new URL('../../db/migrations/001_initial.sql', import.meta.url), 'utf8'));
    if (version >= 2) db.exec(await readFile(new URL('../../db/migrations/002_materials.sql', import.meta.url), 'utf8'));
    for (const s of fixture.data.subjects) db.run('INSERT INTO subjects VALUES (?,?,?,?,?)', [s.id, subjectName ?? s.name, s.accent, s.createdAt, s.updatedAt]);
    for (const n of fixture.data.notes) db.run('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?)', [n.id, n.subjectId, n.title, JSON.stringify(n.bodyJson), n.plainText, n.revision, n.createdAt, n.updatedAt]);
    for (const c of fixture.data.flashcards) db.run('INSERT INTO flashcards VALUES (?,?,?,?,?,?,?)', [c.id, c.subjectId, c.noteId, c.front, c.back, c.createdAt, c.updatedAt]);
    for (const r of fixture.data.reviewLogs) db.run('INSERT INTO review_logs VALUES (?,?,?,?,?)', [r.id, r.flashcardId, r.sessionId, r.rating, r.reviewedAt]);
    db.run("UPDATE settings SET value=? WHERE key='theme'", [fixture.data.settings.theme]);
    if (version >= 2) {
      for (const a of fixture.materials!.assets) db.run('INSERT INTO material_assets VALUES (?,?,?,?)', [a.sha256, a.fileName, a.mimeType, Buffer.from(a.dataBase64, 'base64')]);
      for (const d of fixture.data.documents!) {
        const p = fixture.materials!.documents.find(item => item.documentId === d.id)!;
        db.run('INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?,?,?)', [d.id, d.subjectId, d.noteId, d.fileName, d.kind, d.mimeType, d.sha256, d.pageCount, JSON.stringify(p.pages), Buffer.from(p.dataBase64, 'base64'), d.createdAt]);
      }
      for (const m of fixture.data.cardMetadata!) db.run('INSERT INTO card_metadata VALUES (?,?,?)', [m.flashcardId, JSON.stringify(m.tags), JSON.stringify(m.images)]);
    }
    db.run(`PRAGMA user_version=${version}`);
    return new Uint8Array(db.export());
  } finally { db.close(); }
}

async function seed(page: Page, active: Uint8Array, copy?: Uint8Array, schemaVersion = 2) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).waitFor();
  const metadata = copy ? { id: randomUUID(), format: 'studyspace-recovery', version: 1, schemaVersion, targetSchemaVersion: schemaVersion + 1, createdAt: fixture.exportedAt, reason: 'before-migration', byteLength: copy.length, sha256: hash(copy) } : null;
  await page.evaluate(async ({ active, copy, metadata }) => {
    const request = indexedDB.open('studyspace-local-v1', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('storage', 'readwrite');
      const store = tx.objectStore('storage');
      store.put(new Uint8Array(active).buffer, 'sqlite');
      if (copy && metadata) { store.add(metadata, 'recovery:meta:' + metadata.id); store.add(new Uint8Array(copy).buffer, 'recovery:data:' + metadata.id); }
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close();
  }, { active: [...active], copy: copy ? [...copy] : null, metadata });
}

async function inspect(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('studyspace-local-v1', 1);
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const result = await new Promise<{ active: number[]; copies: { key: string; bytes: number[] }[] }>((resolve, reject) => {
      const tx = db.transaction('storage', 'readonly');
      const result = { active: [] as number[], copies: [] as { key: string; bytes: number[] }[] };
      const request = tx.objectStore('storage').openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (cursor.key === 'sqlite') result.active = [...new Uint8Array(cursor.value)];
        if (String(cursor.key).startsWith('recovery:data:')) result.copies.push({ key: String(cursor.key), bytes: [...new Uint8Array(cursor.value)] });
        cursor.continue();
      };
      tx.oncomplete = () => resolve(result); tx.onabort = () => reject(tx.error);
    });
    db.close(); return result;
  });
}

async function downloadRecovery(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Baixar cópia recuperada de/ }).first().click()]);
  const path = (await download.path())!;
  return { path, bytes: new Uint8Array(await readFile(path)) };
}

test('cria uma cópia verificável ao migrar v1 e permite baixá-la pelo painel', async ({ page }, testInfo) => {
  const before = await databaseBytes(1);
  await seed(page, before);
  await page.reload();
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  const region = page.getByRole('region', { name: 'Proteção antes de migrações' });
  await expect(region).toContainText('Banco v1 → v6');
  await region.scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Concluir', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('recuperacao-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await region.scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Concluir', exact: true })).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('recuperacao-mobile.png') });
  const saved = await inspect(page);
  expect(saved.copies).toHaveLength(1);
  expect(hash(new Uint8Array(saved.copies[0].bytes))).toBe(hash(before));
  const recovered = await downloadRecovery(page);
  const archive = await readBackupArchive(new Blob([recovered.bytes]));
  expect(archive.manifest.data).toEqual({ ...fixture.data, documents: [], cardMetadata: [] });
});

test('recupera para outro perfil quando o banco principal é de versão futura', async ({ page, browser, baseURL }) => {
  const future = await databaseBytes(99);
  await seed(page, future, await databaseBytes(2));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Seu espaço precisa de atenção' })).toBeVisible();
  const recovered = await downloadRecovery(page);
  const archive = await readBackupArchive(new Blob([recovered.bytes]));
  expect(archive.manifest.data).toEqual(fixture.data);
  for (let index = 0; index < archive.manifest.materials.documents.length; index++) {
    expect(hash(await archive.readMaterial(index))).toBe(fixture.data.documents![index].sha256);
  }
  expect(hash(new Uint8Array((await inspect(page)).active))).toBe(hash(future));
  const context = await browser.newContext();
  try {
    const destination = await context.newPage();
    await destination.goto(baseURL!);
    await destination.getByRole('button', { name: 'Dados e backup', exact: true }).click();
    await destination.getByLabel('Arquivo de backup', { exact: true }).setInputFiles(recovered.path);
    await expect(destination.getByRole('dialog')).toHaveCount(0);
    await expect(destination.getByRole('heading', { name: fixture.data.subjects[0].name, exact: true })).toBeVisible();
  } finally { await context.close(); }
});

test('quota interrompe a migração e a transação incompleta preserva o banco e a cópia anterior', async ({ page }) => {
  const before = await databaseBytes(1);
  const older = await databaseBytes(1, 'Estado anterior seguro');
  await seed(page, before, older, 1);
  await page.addInitScript(() => {
    if (localStorage.getItem('mission3-fault-disabled') === '1') return;
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      if (String(key).startsWith('recovery:data:')) throw new DOMException('Quota sintética', 'QuotaExceededError');
      return add.call(this, value, key);
    };
  });
  await page.reload();
  await expect(page.getByRole('alert').first()).toContainText('O banco anterior foi preservado');
  const failed = await inspect(page);
  expect(hash(new Uint8Array(failed.active))).toBe(hash(before));
  expect(failed.copies).toHaveLength(1);
  expect(hash(new Uint8Array(failed.copies[0].bytes))).toBe(hash(older));
  await page.evaluate(() => localStorage.setItem('mission3-fault-disabled', '1'));
  await page.reload();
  await page.getByRole('button', { name: 'Dados e backup', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Proteção antes de migrações' }).getByRole('button', { name: /Baixar cópia recuperada de/ })).toHaveCount(2);
});
