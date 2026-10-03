const sourceUrl = process.env.TURSO_DATABASE_URL?.trim() || '';
const destinationPath = process.env.DATABASE_PATH?.trim() || '';

if (!sourceUrl) {
  console.log(JSON.stringify({
    legacyProductionReconcile: 'skipped',
    reason: 'TURSO_DATABASE_URL is not configured',
  }));
  process.exit(0);
}

if (!destinationPath) {
  console.log(JSON.stringify({
    legacyProductionReconcile: 'skipped',
    reason: 'Turso is the active runtime backend; no explicit SQLite migration target is configured',
  }));
  process.exit(0);
}

await import('./reconcileLegacyProductionData.mjs');
