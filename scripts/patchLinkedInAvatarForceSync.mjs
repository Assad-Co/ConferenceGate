import fs from 'node:fs';

const path = 'server/linkedinProfileBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

const oldSql = [
  "       avatar = CASE",
  "         WHEN COALESCE(TRIM(avatar), '') = '' OR avatar LIKE 'data:image/svg+xml%' THEN ?",
  "         ELSE avatar",
  "       END",
].join('\n');

const newSql = [
  "       avatar = CASE",
  "         WHEN ? IS NOT NULL THEN ?",
  "         ELSE avatar",
  "       END",
].join('\n');

if (!source.includes(newSql)) {
  const index = source.indexOf(oldSql);
  if (index === -1) {
    throw new Error('[linkedin-avatar-force-sync] avatar SQL anchor not found');
  }
  source = source.slice(0, index) + newSql + source.slice(index + oldSql.length);
}

const oldParams = [
  "      about ? about.slice(0, 600) : null,",
  "      profileAvatar,",
  "      userId,",
].join('\n');

const newParams = [
  "      about ? about.slice(0, 600) : null,",
  "      profileAvatar,",
  "      profileAvatar,",
  "      userId,",
].join('\n');

if (!source.includes(newParams)) {
  const index = source.indexOf(oldParams);
  if (index === -1) {
    throw new Error('[linkedin-avatar-force-sync] avatar parameter anchor not found');
  }
  source = source.slice(0, index) + newParams + source.slice(index + oldParams.length);
}

fs.writeFileSync(path, source);
console.log('[linkedin-avatar-force-sync] verified LinkedIn person photo now replaces stale auto-imported avatar on explicit refresh');
