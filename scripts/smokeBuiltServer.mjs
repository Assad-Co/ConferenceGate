import { spawn } from 'node:child_process';

const port = Number(process.env.SMOKE_PORT || 3107);
const child = spawn(process.execPath, ['dist/server.cjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: 'test',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += String(chunk); });
child.stderr.on('data', (chunk) => { stderr += String(chunk); });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        'Server exited before becoming healthy.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.status === 'ok' && body?.database === 'ready') return body;
    } catch {
      // Server is still starting.
    }
    await sleep(500);
  }
  throw new Error(
    'Timed out waiting for /api/health.\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr
  );
}

try {
  const health = await waitForHealth();
  console.log(JSON.stringify({ smoke: 'passed', health }));
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(3000),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
