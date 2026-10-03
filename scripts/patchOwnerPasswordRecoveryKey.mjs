import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

function patchOwnerRecoveryKey() {
  const authPath = resolve(process.cwd(), 'server/auth.ts');
  const source = readFileSync(authPath, 'utf8');
  const broken = 'return `owner_password_reset_used_\\${digest.slice(0, 40)}`;';
  const fixed = 'return `owner_password_reset_used_${digest.slice(0, 40)}`;';

  if (source.includes(fixed)) {
    console.log('[owner-recovery-patch] Recovery key interpolation is already correct.');
    return;
  }
  if (!source.includes(broken)) {
    throw new Error('[owner-recovery-patch] Expected recovery-key pattern was not found; refusing to patch an unknown source state.');
  }

  writeFileSync(authPath, source.replace(broken, fixed), 'utf8');
  console.log('[owner-recovery-patch] Fixed per-token owner recovery key derivation.');
}

function mountAuthRecoveryRouter() {
  const serverPath = resolve(process.cwd(), 'server.ts');
  let source = readFileSync(serverPath, 'utf8');
  const importLine = 'import { authRecoveryRouter } from "./server/authRecovery";';
  const importAnchor = 'import { authRouter, verifySessionToken, COOKIE_NAME, initAuthSecret } from "./server/auth";';
  const mountLine = '  app.use("/api/auth", authRecoveryRouter);';
  const mountAnchor = '  app.use("/api/auth", authRouter);';
  let changed = false;

  if (!source.includes(importLine)) {
    if (!source.includes(importAnchor)) {
      throw new Error('[auth-recovery-patch] Could not find the auth import anchor in server.ts.');
    }
    source = source.replace(importAnchor, `${importAnchor}\n${importLine}`);
    changed = true;
  }

  if (!source.includes(mountLine)) {
    if (!source.includes(mountAnchor)) {
      throw new Error('[auth-recovery-patch] Could not find the auth mount anchor in server.ts.');
    }
    source = source.replace(mountAnchor, `${mountAnchor}\n${mountLine}`);
    changed = true;
  }

  if (changed) {
    writeFileSync(serverPath, source, 'utf8');
    console.log('[auth-recovery-patch] Mounted the Phase 11.3 account recovery router.');
  } else {
    console.log('[auth-recovery-patch] Account recovery router is already mounted.');
  }
}

function patchWorkerDatabase(file, mode) {
  const filePath = resolve(process.cwd(), file);
  let source = readFileSync(filePath, 'utf8');
  const tursoMarker = "const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();";
  if (source.includes(tursoMarker)) {
    console.log(`[worker-db-patch] ${file} already uses the runtime database backend.`);
    return;
  }

  if (mode === 'marketplace') {
    const broken = `const dbPath = path.resolve(\n  process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')\n);\nfs.mkdirSync(path.dirname(dbPath), { recursive: true });\nconst db = createClient({ url: 'file:' + dbPath });`;
    const fixed = `const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();\nconst tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();\nconst dbPath = path.resolve(\n  process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')\n);\nif (tursoUrl && !tursoToken) throw new Error('TURSO_DATABASE_URL is configured but TURSO_AUTH_TOKEN is missing.');\nif (!tursoUrl) fs.mkdirSync(path.dirname(dbPath), { recursive: true });\nconst db = tursoUrl\n  ? createClient({ url: tursoUrl, authToken: tursoToken })\n  : createClient({ url: 'file:' + dbPath });\nconst databaseLabel = tursoUrl ? 'turso' : dbPath;`;
    if (!source.includes(broken)) throw new Error(`[worker-db-patch] Could not find marketplace DB bootstrap in ${file}.`);
    source = source.replace(broken, fixed).replace('database: dbPath,', 'database: databaseLabel,');
  } else {
    const broken = `  const localPath = path.resolve(\n    process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')\n  );\n  fs.mkdirSync(path.dirname(localPath), { recursive: true });\n  const db = createClient({ url: 'file:' + localPath });`;
    const fixed = `  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();\n  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();\n  const localPath = path.resolve(\n    process.env.DATABASE_PATH?.trim() || path.join(process.cwd(), 'data', 'app.db')\n  );\n  if (tursoUrl && !tursoToken) throw new Error('TURSO_DATABASE_URL is configured but TURSO_AUTH_TOKEN is missing.');\n  if (!tursoUrl) fs.mkdirSync(path.dirname(localPath), { recursive: true });\n  const db = tursoUrl\n    ? createClient({ url: tursoUrl, authToken: tursoToken })\n    : createClient({ url: 'file:' + localPath });`;
    if (!source.includes(broken)) throw new Error(`[worker-db-patch] Could not find sponsor watch DB bootstrap in ${file}.`);
    source = source.replace(broken, fixed);
  }

  writeFileSync(filePath, source, 'utf8');
  console.log(`[worker-db-patch] ${file} now follows Turso when production Turso is configured.`);
}

function patchWebEnrichmentOwnership() {
  const filePath = resolve(process.cwd(), 'scripts/runBackgroundBootstrap.mjs');
  let source = readFileSync(filePath, 'utf8');
  const guard = `  if (process.env.ENABLE_WEB_ENRICHMENT_LOOP !== '1') {\n    console.log('[background-bootstrap] web enrichment loop disabled; scheduled automation owns the discovery pipeline.');\n    return;\n  }\n\n`;
  if (source.includes(guard)) {
    console.log('[background-bootstrap-patch] Web enrichment ownership guard is already present.');
    return;
  }
  const anchor = "  console.log('[background-bootstrap] starting continuous conference enrichment loop');";
  if (!source.includes(anchor)) throw new Error('[background-bootstrap-patch] Could not find enrichment loop anchor.');
  source = source.replace(anchor, guard + anchor);
  writeFileSync(filePath, source, 'utf8');
  console.log('[background-bootstrap-patch] Scheduled automation now owns discovery unless ENABLE_WEB_ENRICHMENT_LOOP=1.');
}

function patchAutomationCommand() {
  const packagePath = resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  const target = 'node scripts/automationEntry.mjs';
  if (pkg?.scripts?.automation === target) {
    console.log('[automation-patch] Guarded automation entrypoint already configured.');
    return;
  }
  if (!pkg?.scripts?.automation) throw new Error('[automation-patch] package.json has no automation script.');
  pkg.scripts.automation = target;
  writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log('[automation-patch] npm run automation now uses the guarded entrypoint.');
}

try {
  patchOwnerRecoveryKey();
  mountAuthRecoveryRouter();
  patchWorkerDatabase('scripts/refreshMarketplaceActionAlerts.mjs', 'marketplace');
  patchWorkerDatabase('scripts/refreshSponsorWatchlistAlerts.mjs', 'watchlist');
  patchWebEnrichmentOwnership();
  patchAutomationCommand();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
