import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { zipSync } from 'fflate';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicFiles = [
  'Abrir StudySpace.cmd', 'Encerrar StudySpace.cmd',
  'config/.env.example', 'config/COMO-CONFIGURAR.txt',
  'config/Editar configuracao.cmd', 'config/PROVEDORES.md',
  'runtime/config.mjs', 'runtime/gemini.mjs', 'runtime/identity.mjs',
  'runtime/jarvis.mjs', 'runtime/launcher.mjs', 'runtime/local-voice.ps1',
  'runtime/multi-ai.mjs', 'runtime/providers.mjs', 'runtime/server.mjs',
  'runtime/study-context.mjs', 'runtime/study-tools.mjs',
  'runtime/NODE-LICENSE.txt', 'runtime/COMPONENTES-LICENSES.txt',
];
const sha256 = content => createHash('sha256').update(content).digest('hex');
const sortPaths = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function readPublicFile(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error(`Arquivo público inválido: ${path}`);
  return readFileSync(path);
}

function assertVersion(root) {
  const pkg = JSON.parse(readPublicFile(join(root, 'package.json')));
  const tauri = JSON.parse(readPublicFile(join(root, 'src-tauri/tauri.conf.json')));
  const cargo = readPublicFile(join(root, 'src-tauri/Cargo.toml')).toString('utf8');
  const cargoVersion = cargo.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version) || pkg.version !== tauri.version || pkg.version !== cargoVersion) {
    throw new Error('As versões de package.json, Cargo.toml e tauri.conf.json precisam coincidir.');
  }
  if (!readPublicFile(join(root, 'runtime/identity.mjs')).toString('utf8').includes(`StudySpace-Local-${pkg.version}`)) {
    throw new Error('A identidade do servidor local precisa corresponder à versão do pacote.');
  }
  return pkg.version;
}

function assertTemplateIsPublic(content) {
  const values = parseEnv(content.toString('utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key) && value.trim()) {
      throw new Error(`O modelo público contém um valor privado em ${key}. Remova-o antes de empacotar.`);
    }
  }
}

function assertWindowsNode(content) {
  const offset = content.length >= 64 ? content.readUInt32LE(60) : 0;
  if (content.length < offset + 6 || content.toString('ascii', 0, 2) !== 'MZ'
    || content.toString('ascii', offset, offset + 4) !== 'PE\0\0' || content.readUInt16LE(offset + 4) !== 0x8664) {
    throw new Error('O runtime precisa ser o node.exe oficial para Windows x64.');
  }
}

export function collectPortableFiles({ root = projectRoot, nodePath } = {}) {
  if (!nodePath) throw new Error('Informe o caminho do node.exe para Windows x64.');
  const version = assertVersion(root);
  const files = new Map();
  for (const path of publicFiles) files.set(path, readPublicFile(join(root, path)));
  assertTemplateIsPublic(files.get('config/.env.example'));

  for (const name of ['context', 'tools']) {
    const expected = stripTypeScriptTypes(readPublicFile(join(root, `src/services/jarvis/${name}.ts`)).toString('utf8'));
    if (files.get(`runtime/study-${name}.mjs`).toString('utf8') !== expected) {
      throw new Error('Os adaptadores locais estão desatualizados. Execute npm run local:prepare após o build.');
    }
  }

  const dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('Execute npm run build e npm run local:prepare antes de empacotar.');
  function addAssets(directory) {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error('A distribuição não pode conter links simbólicos.');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error('A distribuição não pode conter links simbólicos.');
      if (entry.isDirectory()) { addAssets(path); continue; }
      const asset = relative(dist, path).split(sep).join('/');
      if (asset.split('/').some(part => part.startsWith('.')) || /\.(?:map|sqlite|db|log|pfx|p12|pem|key|zip)$/i.test(asset)) {
        throw new Error(`Arquivo não publicável na distribuição: ${asset}`);
      }
      files.set(`app/${asset}`, readPublicFile(path));
    }
  }
  addAssets(dist);

  const node = readPublicFile(resolve(nodePath));
  assertWindowsNode(node);
  files.set('runtime/node.exe', node);
  const guide = readPublicFile(join(root, 'scripts/local/LEIA-ME-RELEASE.txt')).toString('utf8').replaceAll('{{VERSION}}', version);
  files.set('LEIA-ME.txt', Buffer.from(guide, 'utf8'));

  const ordered = [...files].sort(([left], [right]) => sortPaths(left, right));
  const manifest = ordered.map(([path, content]) => `${sha256(content)}  ${path}`).join('\n') + '\n';
  files.set('MANIFEST-SHA256.txt', Buffer.from(manifest, 'utf8'));
  return { version, files: new Map([...files].sort(([left], [right]) => sortPaths(left, right))) };
}

export function createPortableZip(files) {
  const archive = Object.create(null);
  // Datas e ordem fixas: os mesmos bytes de entrada produzem o mesmo ZIP.
  const mtime = new Date(2000, 0, 1, 0, 0, 0);
  for (const [path, content] of [...files].sort(([left], [right]) => sortPaths(left, right))) {
    archive[path] = [new Uint8Array(content), { mtime, os: 0, attrs: 0, level: 6 }];
  }
  return Buffer.from(zipSync(archive));
}

function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--node-path')) throw new Error('Uso: npm run local:package -- [--node-path caminho/para/node.exe]');
  const nodePath = args[1] || join(homedir(), 'Documents', 'StudySpace-Local', 'runtime', 'node.exe');
  const { version, files } = collectPortableFiles({ nodePath });
  const zip = createPortableZip(files);
  const filename = `StudySpace_${version}_windows-x64-local.zip`;
  const directory = join(projectRoot, 'release', 'local', version);
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, filename);
  if (existsSync(destination) && sha256(readPublicFile(destination)) !== sha256(zip)) {
    throw new Error('Já existe um pacote diferente desta versão. Preserve-o em outra pasta antes de gerar novamente.');
  }
  writeFileSync(destination, zip);
  writeFileSync(join(directory, 'SHA256SUMS.txt'), `${sha256(zip)}  ${filename}\n`, 'utf8');
  console.log(`Pacote local ${version}: ${destination}`);
  console.log(`${files.size} arquivos públicos; manifesto SHA256 incluído. Nenhuma configuração privada foi copiada.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
