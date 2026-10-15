import fs from 'fs';

const file = 'server/activity.ts';
let source = fs.readFileSync(file, 'utf8');

const oldBlock = `export async function createNotification(\n  userId: string,\n  type: string,\n  title: string,\n  message: string,\n  actionUrl: string | null = null\n) {\n  await dbRun(\n    "INSERT INTO notifications (id, user_id, type, title, message, action_url) VALUES (?, ?, ?, ?, ?, ?)",\n    [\`ntf_\${crypto.randomUUID()}\`, userId, type, title, message, actionUrl]\n  );\n}`;

const newBlock = `export async function createNotification(\n  userId: string,\n  type: string,\n  title: string,\n  message: string,\n  actionUrl: string | null = null\n) {\n  // Protect users from accidental duplicate alerts caused by retries/double-triggered UI actions.\n  // The window is deliberately short so genuinely repeated events later remain visible.\n  const duplicate = await dbGet<{ id: string }>(\n    \`SELECT id FROM notifications\n      WHERE user_id=? AND type=? AND title=? AND message=?\n        AND COALESCE(action_url, '')=COALESCE(?, '')\n        AND created_at >= datetime('now', '-2 minutes')\n      LIMIT 1\`,\n    [userId, type, title, message, actionUrl]\n  );\n  if (duplicate) return;\n\n  await dbRun(\n    "INSERT INTO notifications (id, user_id, type, title, message, action_url) VALUES (?, ?, ?, ?, ?, ?)",\n    [\`ntf_\${crypto.randomUUID()}\`, userId, type, title, message, actionUrl]\n  );\n}`;

if (!source.includes(newBlock)) {
  if (!source.includes(oldBlock)) throw new Error('[notification-dedup] patched createNotification anchor missing');
  source = source.replace(oldBlock, newBlock);
  fs.writeFileSync(file, source);
}

console.log('[notification-dedup] short-window duplicate notification guard applied');
