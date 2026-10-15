import fs from 'node:fs';

const config = fs.readFileSync('vite.config.ts', 'utf8');

const required = [
  "return 'react-vendor'",
  "return 'ui-vendor'",
  "return 'document-vendor'",
  'manualChunks(id)',
];

for (const marker of required) {
  if (!config.includes(marker)) {
    throw new Error(`Bundle chunking audit failed: missing ${marker}`);
  }
}

console.log('Bundle chunking configuration audit passed.');
