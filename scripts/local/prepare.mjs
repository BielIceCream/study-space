import { cpSync, copyFileSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) {
  throw new Error('Execute npm run build antes de preparar o aplicativo local.');
}

const adapters = ['context', 'tools'].map(name => ({
  path: join(root, 'runtime', `study-${name}.mjs`),
  content: stripTypeScriptTypes(readFileSync(join(root, 'src', 'services', 'jarvis', `${name}.ts`), 'utf8')),
}));

cpSync(dist, join(root, 'app'), { recursive: true });
for (const adapter of adapters) writeFileSync(adapter.path, adapter.content);
mkdirSync(join(root, 'config'), { recursive: true });
try {
  copyFileSync(join(root, 'config', '.env.example'), join(root, 'config', '.env'), constants.COPYFILE_EXCL);
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
console.log('StudySpace preparado. Use npm start ou Abrir StudySpace.cmd.');
console.log('Configure os provedores em config/.env. Valores existentes foram preservados.');
