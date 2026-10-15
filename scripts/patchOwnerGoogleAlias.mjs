import fs from 'node:fs';

const path = 'server/auth.ts';
let source = fs.readFileSync(path, 'utf8');

const marker = 'const googleClient = process.env.GOOGLE_OAUTH_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_OAUTH_CLIENT_ID) : null;';
const helper = `const OWNER_GOOGLE_ALIAS_EMAIL_SHA256 =\n  \"e017d6df8587f3888c4388b770056d654d7671d7f7526ed82c0a53c2ea1c2041\";\n\nfunction isOwnerGoogleAliasEmail(email: string): boolean {\n  const actual = crypto.createHash(\"sha256\").update(email.trim().toLowerCase()).digest(\"hex\");\n  try {\n    return crypto.timingSafeEqual(\n      Buffer.from(actual, \"hex\"),\n      Buffer.from(OWNER_GOOGLE_ALIAS_EMAIL_SHA256, \"hex\")\n    );\n  } catch {\n    return false;\n  }\n}\n\n${marker}`;

if (!source.includes('OWNER_GOOGLE_ALIAS_EMAIL_SHA256')) {
  if (!source.includes(marker)) throw new Error('Google client marker not found');
  source = source.replace(marker, helper);
}

const oldBlock = `  let row = await dbGet<UserRow>(\"SELECT * FROM users WHERE google_id = ?\", [googleId]);\n\n  if (!row) {\n    const byEmail = await dbGet<UserRow>(\"SELECT * FROM users WHERE email = ?\", [email]);\n    if (byEmail) {\n      await dbRun(\"UPDATE users SET google_id = ? WHERE id = ?\", [googleId, byEmail.id]);\n      row = await dbGet<UserRow>(\"SELECT * FROM users WHERE id = ?\", [byEmail.id]);\n    }\n  }`;

const newBlock = `  let row: UserRow | undefined;\n\n  // The owner's Google identity may use a different email from the original rich ConferenceGate\n  // profile. Resolve that approved alias to the one owner-preview row before ordinary Google-ID\n  // or email matching. The duplicate row is preserved; only its Google identity link is released.\n  if (isOwnerGoogleAliasEmail(email)) {\n    const users = await dbAll<UserRow>(\"SELECT * FROM users\");\n    const ownerRows = users.filter((candidate) => isOwnerPreviewEmail(candidate.email));\n    if (ownerRows.length === 1) {\n      const owner = ownerRows[0];\n      await dbRun(\"UPDATE users SET google_id = NULL WHERE google_id = ? AND id <> ?\", [googleId, owner.id]);\n      await dbRun(\"UPDATE users SET google_id = ? WHERE id = ?\", [googleId, owner.id]);\n      row = await dbGet<UserRow>(\"SELECT * FROM users WHERE id = ?\", [owner.id]);\n      console.warn(\"[auth] Owner Google alias linked to existing rich owner profile.\");\n    } else {\n      console.warn(\`[auth] Owner Google alias linkage skipped: expected 1 owner row, found \${ownerRows.length}.\`);\n    }\n  }\n\n  if (!row) {\n    row = await dbGet<UserRow>(\"SELECT * FROM users WHERE google_id = ?\", [googleId]);\n  }\n\n  if (!row) {\n    const byEmail = await dbGet<UserRow>(\"SELECT * FROM users WHERE email = ?\", [email]);\n    if (byEmail) {\n      await dbRun(\"UPDATE users SET google_id = ? WHERE id = ?\", [googleId, byEmail.id]);\n      row = await dbGet<UserRow>(\"SELECT * FROM users WHERE id = ?\", [byEmail.id]);\n    }\n  }`;

if (!source.includes('[auth] Owner Google alias linked to existing rich owner profile.')) {
  if (!source.includes(oldBlock)) throw new Error('Google account-linking block not found');
  source = source.replace(oldBlock, newBlock);
}

fs.writeFileSync(path, source);
console.log('[owner-google-alias] patch applied');
