import { spawn, spawnSync } from 'node:child_process';
import { existsSync, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { signingConfig } from './signing-config.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const TARGET = 'x86_64-pc-windows-msvc';
const RUST = '1.99.0';
const mode = process.argv[2] ?? 'build';
const localBin = join(root, '.cache/rust/toolchain/bin');
const localCargo = join(localBin, 'cargo.exe');
const env = existsSync(localCargo) ? {
  ...process.env, CARGO_HOME: join(root, '.cache/rust/cargo'), PATH: `${localBin};${process.env.PATH}`,
} : process.env;
const cargo = existsSync(localCargo) ? localCargo : 'cargo';
const proxyUrl = process.env.STUDYSPACE_CARGO_PROXY_URL;
if (proxyUrl && !/^http:\/\/127\.0\.0\.1:\d+\/$/.test(proxyUrl)) throw new Error('Proxy de build deve ser local.');
const cargoNetworkArgs = proxyUrl ? ['--config', 'source.crates-io.replace-with="studyspace-verified-proxy"', '--config', `source.studyspace-verified-proxy.registry="sparse+${proxyUrl}"`] : [];
const diagnosticDirectory = join(root, '.cache/windows-diagnostics');
const attemptStartedAt = new Date().toISOString();

async function run(command, args, cwd = root, childEnv = env) {
  await mkdir(diagnosticDirectory, { recursive: true });
  const logPath = join(diagnosticDirectory, `${mode}-${Date.now()}-${basename(command)}.log`);
  const log = createWriteStream(logPath);
  const child = spawn(command, args, { cwd, env: childEnv, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
  for (const [stream, destination] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
    stream.on('data', bytes => { destination.write(bytes); log.write(bytes); });
  }
  let code;
  try { code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); }); }
  finally { await new Promise(resolve => log.end(resolve)); }
  if (code !== 0) throw new Error(`A etapa ${basename(command)} terminou com código ${code}. Log: ${logPath}`);
}

async function verifyConfig() {
  const config = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const cliPackage = dirname(require.resolve('@tauri-apps/cli/package.json'));
  const schema = JSON.parse(await readFile(join(cliPackage, 'config.schema.json'), 'utf8'));
  const ajv = new Ajv({ strict: false, allErrors: true, validateFormats: false, unicodeRegExp: false });
  const validate = ajv.compile(schema);
  if (!validate(config)) throw new Error(`Configuração Tauri inválida: ${JSON.stringify(validate.errors)}`);
  for (const file of ['tauri.offline.conf.json', 'tauri.test.conf.json']) {
    const override = JSON.parse(await readFile(join(root, 'src-tauri', file), 'utf8'));
    const variant = {
      ...config, ...override,
      bundle: { ...config.bundle, ...override.bundle, windows: { ...config.bundle.windows, ...override.bundle?.windows } },
    };
    if (!validate(variant)) throw new Error(`Variante ${file} inválida: ${JSON.stringify(validate.errors)}`);
  }
  if (config.identifier !== 'app.studyspace.desktop') throw new Error('O identificador foi alterado e mudaria a pasta de estudos existentes.');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const cargoManifest = await readFile(join(root, 'src-tauri/Cargo.toml'), 'utf8');
  const cargoVersion = cargoManifest.split('[lib]')[0].match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (pkg.version !== config.version || cargoVersion !== config.version) throw new Error('Versões de package.json, Tauri e Cargo divergem.');
  if (config.productName !== 'StudySpace' || config.bundle.publisher !== 'StudySpace') throw new Error('Metadados base de produto/editor inconsistentes.');
  if (config.bundle.externalBin?.length || config.bundle.resources?.length) throw new Error('Binários/recursos adicionais devem ser inventariados antes da distribuição.');
  if (config.build.frontendDist !== '../dist' || config.bundle.targets.join() !== 'nsis') throw new Error('A distribuição deve embutir dist e gerar NSIS.');
  const window = config.app.windows.find(window => window.label === 'main');
  if (!window?.decorations || !window.resizable || !window.maximizable || !window.minimizable || !window.preventOverflow || !window.useHttpsScheme) throw new Error('A janela deve preservar controles nativos, área útil e origem segura.');
  if (!config.app.security.csp.includes('https://ipc.localhost')) throw new Error('A CSP deve permitir o IPC local com a origem HTTPS do Windows.');
  if (config.bundle.windows.nsis.installMode !== 'currentUser') throw new Error('O instalador deve usar a conta atual do Windows.');
  for (const path of [...config.bundle.icon, config.bundle.windows.nsis.installerIcon, config.bundle.windows.nsis.uninstallerIcon]) {
    if (!existsSync(join(root, 'src-tauri', path))) throw new Error(`Ícone ausente: ${path}`);
  }
  const main = await readFile(join(root, 'src-tauri/src/main.rs'), 'utf8');
  if (!main.includes('windows_subsystem = "windows"')) throw new Error('O release deve iniciar sem terminal.');
  process.stdout.write('Configuração Tauri/NSIS, ícones e entrada sem terminal: OK.\n');
  return config;
}

function prerequisites() {
  if (process.platform !== 'win32') throw new Error('O build NSIS exige Windows x64; use o workflow Windows documentado.');
  const version = spawnSync('rustc', ['--version'], { env, encoding: 'utf8', windowsHide: true });
  if (version.status !== 0 || !version.stdout.startsWith(`rustc ${RUST} `)) throw new Error(`Instale Rust ${RUST} para Windows MSVC, conforme docs/WINDOWS.md.`);
  const vswhere = join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
  const discovery = existsSync(vswhere) ? spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true }) : null;
  const visualStudio = discovery?.stdout?.trim();
  const compilerOnPath = spawnSync('cl.exe', [], { env, windowsHide: true, encoding: 'utf8' });
  if (!visualStudio && compilerOnPath.error) throw new Error('MSVC ausente. Execute npm.cmd run desktop:setup em um PowerShell como administrador, fora da sessão restrita, ou use o runner Windows. Nenhum executável foi gerado.');
  const sdk = join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Windows Kits/10/Include');
  if (!existsSync(sdk)) throw new Error('Windows SDK ausente. Execute npm.cmd run desktop:setup em um PowerShell como administrador.');
  if (!existsSync(join(root, 'src-tauri/Cargo.lock'))) throw new Error('Cargo.lock ausente. Resolva as dependências antes do build reproduzível.');
}

async function verifyAssets() {
  const html = await readFile(join(root, 'dist/index.html'), 'utf8');
  if (/https?:\/\//.test(html) || html.includes('/src/main.tsx')) throw new Error('O HTML de produção contém um recurso de desenvolvimento/remoto.');
  const files = await readdir(join(root, 'dist/assets'));
  for (const required of [/inter-latin.*\.woff2$/, /manrope-latin.*\.woff2$/, /sql-wasm.*\.wasm$/, /NoteEditor.*\.js$/, /index.*\.css$/, /pdf\.worker\.min-.*\.mjs$/, /DocumentReader-.*\.js$/, /JarvisPanel-.*\.js$/, /ImportModal-.*\.js$/]) {
    if (!files.some(file => required.test(file))) throw new Error(`Recurso não empacotado: ${required}`);
  }
  process.stdout.write('Fontes, CSS, editor, PDF worker, JARVIS, importadores e SQLite WASM locais no pacote: OK.\n');
}

try {
  await verifyConfig();
  await run(process.execPath, [join(root, 'scripts/quality/frontend-preservation.mjs')]);
  if (mode === 'config') { await verifyAssets(); }
  else {
    prerequisites();
    if (mode === 'check') process.stdout.write('Ambiente de build Windows disponível.\n');
    else if (mode === 'dev') {
      await run(process.execPath, [join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js'), 'dev', '--target', TARGET, '--', '--locked']);
    }
    else if (mode === 'test' || mode === 'test-ci') {
      const args = ['test','--locked','--target',TARGET,...cargoNetworkArgs];
      if(mode==='test-ci') {
        args.push('--','--skip','jarvis_credentials::tests::windows_vault_round_trip_uses_an_isolated_test_credential');
        process.stdout.write('CI: cofre Windows não testado; exige sessão utilizável. O teste local permanece na suíte completa.\n');
      }
      await run(cargo,args,join(root,'src-tauri'));
    }
    else if (mode === 'qa') {
      const args = [join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js'), 'build', '--target', TARGET,
        '--config', 'src-tauri/tauri.test.conf.json', '--no-bundle', '--', '--locked', ...cargoNetworkArgs];
      await run(process.execPath, args, root, { ...env, CARGO_TARGET_DIR: join(root, 'src-tauri/target/e2e') });
      process.stdout.write('Aplicativo QA em src-tauri/target/e2e/x86_64-pc-windows-msvc/release/studyspace.exe; dados e credenciais em namespace separado.\n');
    }
    else if (['build', 'offline', 'signed', 'offline-signed'].includes(mode)) {
      const offline = mode === 'offline' || mode === 'offline-signed';
      const signing = signingConfig(root, env);
      if (mode.includes('signed') && !signing) throw new Error('Build assinado exige certificado ou Artifact Signing configurado. Consulte docs/WINDOWS-TRUST.md.');
      let buildEnv = env;
      const args = [join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'tauri.js'), 'build', '--target', TARGET, '--bundles', 'nsis', '--', '--locked', ...cargoNetworkArgs];
      if (offline) args.splice(args.indexOf('--'), 0, '--config', 'src-tauri/tauri.offline.conf.json');
      if (signing) {
        const signingPath = join(diagnosticDirectory, 'signing-config.json');
        const signingLog = join(diagnosticDirectory, `signing-${Date.now()}.jsonl`);
        await mkdir(diagnosticDirectory, { recursive: true });
        await writeFile(signingLog, '');
        await writeFile(signingPath, JSON.stringify(signing, null, 2));
        const config = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
        const schema = JSON.parse(await readFile(join(dirname(require.resolve('@tauri-apps/cli/package.json')), 'config.schema.json'), 'utf8'));
        const validate = new Ajv({ strict: false, unicodeRegExp: false, validateFormats: false }).compile(schema);
        if (!validate({ ...config, bundle: { ...config.bundle, ...signing.bundle, windows: { ...config.bundle.windows, ...signing.bundle.windows } } })) throw new Error('Configuração de assinatura inválida.');
        buildEnv = { ...env, STUDYSPACE_SIGNING_LOG: signingLog };
        await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/desktop/sign-windows.ps1'), '-CheckOnly'], root, buildEnv);
        args.splice(args.indexOf('--'), 0, '--config', signingPath);
      } else process.stdout.write('Build sem assinatura: artefato de avaliação; confiança pública não foi validada.\n');
      await run(process.execPath, args, root, buildEnv);
      await verifyAssets();
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/desktop/package-windows.ps1'), '-ProjectRoot', root, ...(offline ? ['-OfflineWebView'] : [])], root, buildEnv);
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/desktop/verify-windows-release.ps1'), '-ProjectRoot', root, ...(signing ? ['-RequireSigned'] : [])], root, buildEnv);
      await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/desktop/scan-windows-release.ps1'), '-ProjectRoot', root, ...(env.STUDYSPACE_REQUIRE_DEFENDER === '1' ? ['-RequireDefender'] : [])], root, buildEnv);
    } else throw new Error(`Modo desconhecido: ${mode}`);
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  await mkdir(diagnosticDirectory, { recursive: true });
  await writeFile(join(diagnosticDirectory, 'last-failure.json'), JSON.stringify({ mode, attemptStartedAt, failedAt: new Date().toISOString(), message: error.message }, null, 2));
  if (process.platform === 'win32' && mode !== 'config') {
    try { await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/desktop/diagnose-windows.ps1')]); }
    catch { process.stderr.write('Logs do Windows indisponíveis; o erro da etapa acima foi preservado.\n'); }
  }
  process.exitCode = 1;
}
