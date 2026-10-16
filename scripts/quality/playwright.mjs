import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const projectPath = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(projectPath, '.cache', 'playwright'),
  STUDYSPACE_E2E_MANAGED_SERVER: '1',
};
let server;
let child;

function stop() {
  // Kill only the direct Node processes created here. No cmd.exe tree or WMI
  // taskkill is necessary in a Windows environment with restricted permissions.
  server?.kill();
  child?.kill();
}
process.on('SIGINT', () => { stop(); process.exitCode = 130; });
process.on('SIGTERM', () => { stop(); process.exitCode = 143; });

async function ready() {
  try {
    const response = await fetch('http://127.0.0.1:1420', { signal: AbortSignal.timeout(800) });
    await response.body?.cancel();
    return response.ok;
  } catch { return false; }
}

try {
  if (args[0] === 'test' && !args.includes('--list') && !await ready()) {
    const preview = process.env.STUDYSPACE_E2E_PREVIEW === '1';
    server = spawn(process.execPath, [join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js'), ...(preview ? ['preview'] : []), '--host', '127.0.0.1', '--port', '1420', '--strictPort'], {
      cwd: projectPath, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let serverFailure;
    server.on('error', error => { serverFailure = error; });
    server.stdout.on('data', data => process.stdout.write(data));
    server.stderr.on('data', data => process.stderr.write(data));
    const deadline = Date.now() + 30_000;
    while (!await ready()) {
      if (serverFailure) throw serverFailure;
      if (server.exitCode !== null || Date.now() > deadline) throw new Error('Não foi possível iniciar o servidor local de testes.');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), ...args], {
    cwd: projectPath, env, stdio: 'inherit', windowsHide: true,
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
} finally {
  server?.kill();
}
