import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['scripts/reconcileLegacyProductionDataIfNeeded.mjs'], {
  env: {
    ...process.env,
    TURSO_DATABASE_URL: 'libsql://must-not-be-contacted.example',
    TURSO_AUTH_TOKEN: 'smoke-token',
    DATABASE_PATH: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

const exitCode = await new Promise((resolve) => child.once('exit', resolve));
if (exitCode !== 0) {
  throw new Error(`Legacy reconcile runtime guard exited ${exitCode}.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

let payload;
try {
  payload = JSON.parse(stdout.trim());
} catch {
  throw new Error(`Legacy reconcile runtime guard did not emit JSON.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
}

if (payload?.legacyProductionReconcile !== 'skipped') {
  throw new Error('Expected legacy reconciliation to be skipped when Turso is active without DATABASE_PATH.');
}
if (!String(payload?.reason || '').includes('active runtime backend')) {
  throw new Error('Expected skip reason to identify Turso as the active runtime backend.');
}

console.log(JSON.stringify({
  legacyReconcileRuntimeSmoke: 'passed',
  activeTursoSkipped: true,
  networkMigrationAvoided: true,
}));
