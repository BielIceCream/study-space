import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { unzipSync } from 'fflate';
import { classifyLocalIdentity } from '../../runtime/identity.mjs';
import { collectPortableFiles, createPortableZip } from './package.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'studyspace-public-package-'));
  const put = (path, content) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content); };
  for (const path of [
    'Abrir StudySpace.cmd', 'Encerrar StudySpace.cmd', 'config/COMO-CONFIGURAR.txt',
    'config/Editar configuracao.cmd', 'config/PROVEDORES.md', 'runtime/config.mjs',
    'runtime/gemini.mjs', 'runtime/jarvis.mjs', 'runtime/launcher.mjs',
    'runtime/local-voice.ps1', 'runtime/multi-ai.mjs', 'runtime/providers.mjs',
    'runtime/server.mjs', 'runtime/NODE-LICENSE.txt', 'runtime/COMPONENTES-LICENSES.txt',
  ]) put(path, 'public');
  put('package.json', '{"version":"2.0.0"}');
  put('src-tauri/tauri.conf.json', '{"version":"2.0.0"}');
  put('src-tauri/Cargo.toml', '[package]\nversion = "2.0.0"\n');
  put('runtime/identity.mjs', 'StudySpace-Local-2.0.0');
  put('config/.env.example', 'AI_PROVIDER=gemini\nGEMINI_API_KEY=\n');
  put('dist/index.html', '<main>StudySpace</main>');
  put('dist/assets/app.js', 'console.log("public");');
  put('scripts/local/LEIA-ME-RELEASE.txt', 'StudySpace {{VERSION}}');
  for (const name of ['context', 'tools']) {
    put(`src/services/jarvis/${name}.ts`, 'export const ok = true;\n');
    put(`runtime/study-${name}.mjs`, 'export const ok = true;\n');
  }
  const node = Buffer.alloc(100);
  node.write('MZ'); node.writeUInt32LE(64, 60); node.write('PE\0\0', 64); node.writeUInt16LE(0x8664, 68);
  put('node.exe', node);
  return { root, put, nodePath: join(root, 'node.exe') };
}

test('o ZIP inclui apenas arquivos públicos, com manifesto verificável e conteúdo reproduzível', () => {
  const source = fixture();
  try {
    for (const privatePath of ['config/.env', '.agents/token.txt', '.codex/settings.json', 'runtime/private.mjs', 'app/private.txt', 'library.sqlite']) source.put(privatePath, 'PRIVATE_MARKER');
    const { version, files } = collectPortableFiles(source);
    assert.equal(version, '2.0.0');
    const first = createPortableZip(files);
    assert.deepEqual(createPortableZip(new Map([...files].reverse())), first);
    const extracted = unzipSync(first);
    assert.equal(Buffer.from(extracted['LEIA-ME.txt']).toString(), 'StudySpace 2.0.0');
    assert.equal(extracted['config/.env'], undefined);
    assert.equal(extracted['runtime/private.mjs'], undefined);
    assert.equal(extracted['app/private.txt'], undefined);
    for (const content of Object.values(extracted)) assert.equal(Buffer.from(content).includes(Buffer.from('PRIVATE_MARKER')), false);
    for (const line of Buffer.from(extracted['MANIFEST-SHA256.txt']).toString().trim().split('\n')) {
      const [hash, path] = line.split('  ');
      assert.equal(createHash('sha256').update(extracted[path]).digest('hex'), hash);
    }
    assert.equal(Object.keys(extracted).length - 1, Buffer.from(extracted['MANIFEST-SHA256.txt']).toString().trim().split('\n').length);
  } finally { rmSync(source.root, { recursive: true, force: true }); }
});

test('o empacotamento rejeita chave no modelo público, sourcemap, runtime incompatível e adaptador antigo', () => {
  const source = fixture();
  try {
    source.put('config/.env.example', 'GEMINI_API_KEY=private-key');
    assert.throws(() => collectPortableFiles(source), /valor privado/);
    source.put('config/.env.example', 'GEMINI_API_KEY=');
    source.put('dist/assets/app.js.map', '{}');
    assert.throws(() => collectPortableFiles(source), /não publicável/);
    rmSync(join(source.root, 'dist/assets/app.js.map'));
    source.put('node.exe', 'not-a-runtime');
    assert.throws(() => collectPortableFiles(source), /Windows x64/);
    source.put('runtime/study-context.mjs', 'stale');
    assert.throws(() => collectPortableFiles(source), /desatualizados/);
  } finally { rmSync(source.root, { recursive: true, force: true }); }
});

test('o iniciador diferencia a versão atual, o servidor anterior e programas desconhecidos', () => {
  assert.equal(classifyLocalIdentity('StudySpace-Local-2.0.0'), 'ready');
  assert.equal(classifyLocalIdentity('StudySpace-Local-0.2.0'), 'legacy');
  assert.equal(classifyLocalIdentity('StudySpace-Local-0.2.0\n'), 'occupied');
  assert.equal(classifyLocalIdentity('other-server'), 'occupied');
  assert.equal(classifyLocalIdentity('StudySpace-Local-999.0.0'), 'occupied');
});
