import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const manifestPath = join(root, 'docs/windows/reference/frontend.json');
const integrationPath = join(root, 'docs/windows/reference/mission-2.4.json');
const permittedIntegrations = new Set(['src/App.tsx','src/shared/types.ts','src/services/storage/sqlite.ts','src/services/storage/sqlite.test.ts','src/services/storage/native.ts','src/services/storage/validation.ts','src/features/subjects/SubjectWorkspace.tsx','src/features/flashcards/CardLibrary.tsx','src/features/flashcards/Review.tsx']);
const shortWindowFix = '\n/* Keep sidebar controls reachable in short Windows viewports at high DPI. */\n@media (max-height: 600px) {\n  .sidebar { min-height: 0; }\n}\n';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function filesIn(folder) {
  const files = [];
  for (const item of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, item.name);
    if (item.isDirectory()) files.push(...await filesIn(path));
    else if (item.isFile()) files.push(path);
  }
  return files;
}

async function capture() {
  try { await readFile(manifestPath); throw new Error('A referência já existe. Ela foi preservada.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = [...await filesIn(join(root, 'src')), ...await filesIn(join(root, 'public'))].sort();
  const manifest = { version: 1, createdAt: new Date().toISOString(), files: {} };
  for (const path of files) {
    const bytes = await readFile(path);
    manifest.files[relative(root, path).replaceAll('\\', '/')] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`Referência registrada: ${files.length} arquivos do frontend.\n`);
}

async function verify() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  let integrations = {files:{}};
  try { integrations = JSON.parse(await readFile(integrationPath,'utf8')); }
  catch(error) {if(error.code!=='ENOENT') throw error;}
  const changed = [];
  let exception = false;
  for (const [name, expected] of Object.entries(manifest.files)) {
    const bytes = await readFile(join(root, name));
    if (sha256(bytes) === expected.sha256) continue;
    const integration = integrations.files[name];
    if(permittedIntegrations.has(name) && integration?.beforeSha256 === expected.sha256 && integration.afterSha256 === sha256(bytes)) continue;
    if (name === 'src/styles.css' && sha256(bytes.subarray(0, expected.bytes)) === expected.sha256 && bytes.subarray(expected.bytes).toString('utf8') === shortWindowFix) {
      exception = true; continue;
    }
    changed.push(name);
  }
  if (changed.length) throw new Error(`O frontend aprovado foi alterado: ${changed.join(', ')}`);
  process.stdout.write(`Referência original conferida: ${Object.keys(manifest.files).length} arquivos; ${Object.keys(integrations.files).length} integrações da missão 2.4 registradas.${exception ? ' Correção de rolagem da sidebar mantida.' : ''}\n`);
}

async function recordIntegrations() {
  const original=JSON.parse(await readFile(manifestPath,'utf8'));
  const files={};
  for(const name of permittedIntegrations){
    const before=original.files[name]; if(!before)continue;
    const bytes=await readFile(join(root,name));const afterSha256=sha256(bytes);
    if(afterSha256!==before.sha256)files[name]={beforeSha256:before.sha256,afterSha256,bytes:bytes.length};
  }
  await writeFile(integrationPath,JSON.stringify({mission:'2.4',createdAt:new Date().toISOString(),scope:'Controles indispensáveis JARVIS/importação, arquivos originais preservados em checkpoint, armazenamento v2. Não substitui a comparação visual.',files},null,2)+'\n');
  await verify();
}

if (process.argv[2] === 'capture') await capture();
else if(process.argv[2]==='record-mission-2.4') await recordIntegrations();
else await verify();
