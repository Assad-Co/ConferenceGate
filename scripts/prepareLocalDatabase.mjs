import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
if (tursoUrl) {
  console.log(JSON.stringify({
    databasePrepare: 'skipped',
    backend: 'turso',
    localPreparationSkipped: true,
  }));
  process.exit(0);
}

const aliasPath = path.join(cwd, 'data', 'app.db');
const configured = process.env.DATABASE_PATH?.trim();
const targetPath = path.resolve(configured || aliasPath);

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.mkdirSync(path.dirname(aliasPath), { recursive: true });

if (path.resolve(aliasPath) !== targetPath) {
  let aliasStat = null;
  try { aliasStat = fs.lstatSync(aliasPath); } catch {}

  if (aliasStat?.isSymbolicLink()) {
    const currentTarget = path.resolve(path.dirname(aliasPath), fs.readlinkSync(aliasPath));
    if (currentTarget !== targetPath) fs.unlinkSync(aliasPath);
  } else if (aliasStat) {
    if (!fs.existsSync(targetPath) && aliasStat.isFile()) {
      fs.copyFileSync(aliasPath, targetPath);
      console.log('[db-prepare] Copied existing local SQLite file into configured persistent path.');
    }
    fs.rmSync(aliasPath, { force: true });
  }

  if (!fs.existsSync(aliasPath)) {
    fs.symlinkSync(targetPath, aliasPath);
  }
}

if (!configured && process.env.NODE_ENV === 'production') {
  console.warn(
    '[db-prepare] DATABASE_PATH is not set. Starting with temporary local SQLite at data/app.db; ' +
    'attach a Render disk and set DATABASE_PATH=/var/data/conferencegate.db for persistence.'
  );
}

console.log(JSON.stringify({
  databasePrepare: 'ready',
  backend: 'sqlite',
  persistentPathConfigured: Boolean(configured),
  temporaryLocalStorage: !configured,
  alias: path.relative(cwd, aliasPath),
  target: configured ? targetPath : path.relative(cwd, targetPath),
}));
