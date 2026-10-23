import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Synthetic fixture only. The native phase receives bytes produced by the browser
// storage implementation, then the browser reads the native phase's real output.
const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = join(root, '.cache', 'mission-3', 'parity');
const input = join(directory, 'browser-recovery.sqlite');
const output = join(directory, 'native-archive.json');
const localBin = join(root, '.cache', 'rust', 'toolchain', 'bin');
const localCargo = join(localBin, process.platform === 'win32' ? 'cargo.exe' : 'cargo');
const cargo = existsSync(localCargo) ? localCargo : 'cargo';
const env = {
  ...process.env,
  STUDYSPACE_PARITY_INPUT: input,
  STUDYSPACE_PARITY_OUTPUT: output,
  ...(existsSync(localCargo) ? {
    CARGO_HOME: join(root, '.cache', 'rust', 'cargo'),
    PATH: `${localBin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
  } : {}),
};

async function run(command, args, phaseEnv = env) {
  const child = spawn(command, args, { cwd: root, env: phaseEnv, stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  if (code !== 0) throw new Error(`A verificação de paridade terminou com código ${code}.`);
}

await mkdir(directory, { recursive: true });
await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/services/storage/recovery.test.ts', '-t', 'produz o checkpoint SQLite real'], { ...env, STUDYSPACE_PARITY_STAGE: 'produce' });
// Truncate the output before running Rust: a stale successful result must never
// make the final phase pass if the native bridge did not actually write a backup.
await writeFile(output, '');
await run(cargo, [
  'test', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--offline',
  ...(process.platform === 'win32' ? ['--target', 'x86_64-pc-windows-msvc'] : []),
  '--lib', 'recovery::tests::browser_recovery_roundtrips_through_native_empty_destination',
  '--', '--exact', '--nocapture', '--ignored',
]);
JSON.parse(await readFile(output, 'utf8'));
await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/services/storage/recovery.test.ts', '-t', 'restaura a saída realmente produzida pelo Rust'], { ...env, STUDYSPACE_PARITY_STAGE: 'consume' });
process.stdout.write('Paridade navegador → checkpoint SQLite → destino nativo vazio → manifesto v7 e materiais → navegador: aprovada.\n');
