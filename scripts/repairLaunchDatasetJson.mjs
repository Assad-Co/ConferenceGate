import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(process.cwd(), 'data', 'conferencegate-worldwide-2026-2028.json');

function previousNonSpace(text, index) {
  for (let i = Math.max(0, index - 1); i >= 0; i--) if (!/\s/.test(text[i])) return { ch: text[i], index: i };
  return null;
}
function nextNonSpace(text, index) {
  for (let i = Math.max(0, index); i < text.length; i++) if (!/\s/.test(text[i])) return { ch: text[i], index: i };
  return null;
}

if (!fs.existsSync(FILE)) {
  console.log('[launch-dataset-repair] file absent; skipping');
} else {
  let text = fs.readFileSync(FILE, 'utf8');
  let repaired = 0;
  let ok = false;

  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      JSON.parse(text);
      ok = true;
      break;
    } catch (error) {
      const message = String(error?.message || error);
      const match = /position\s+(\d+)/i.exec(message);
      if (!match) {
        console.warn(`[launch-dataset-repair] cannot locate JSON error: ${message}`);
        break;
      }
      const pos = Number(match[1]);
      const prev = previousNonSpace(text, pos);
      const next = nextNonSpace(text, pos);
      const commaError = /Expected ',' or '[}\]]'|Expected ',' or '[}\]]' after|Expected ',' or '\]'/i.test(message)
        || /Expected ',' or '\}'/i.test(message)
        || /after array element/i.test(message)
        || /after property value/i.test(message);

      if (commaError && prev && next && ['}', ']'].includes(prev.ch) && ['{', '[', '"'].includes(next.ch)) {
        text = text.slice(0, next.index) + ',' + text.slice(next.index);
        repaired += 1;
        console.log(`[launch-dataset-repair] inserted missing comma near original position ${pos}`);
        continue;
      }

      // A common generated-dataset corruption is two object properties placed next to each other
      // without a comma. The parser points at the opening quote of the second property.
      if (commaError && prev && next && ['"', '0','1','2','3','4','5','6','7','8','9','e','l'].includes(prev.ch) && next.ch === '"') {
        text = text.slice(0, next.index) + ',' + text.slice(next.index);
        repaired += 1;
        console.log(`[launch-dataset-repair] inserted missing property comma near original position ${pos}`);
        continue;
      }

      console.warn(`[launch-dataset-repair] unsupported JSON error at ${pos}: ${message}`);
      break;
    }
  }

  if (ok) {
    if (repaired > 0) fs.writeFileSync(FILE, text, 'utf8');
    console.log(`[launch-dataset-repair] valid=true repairs=${repaired}`);
  } else {
    console.warn(`[launch-dataset-repair] valid=false repairs=${repaired}`);
  }
}
