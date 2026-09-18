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
function positionFromMessage(text, message) {
  const direct = /position\s+(\d+)/i.exec(message);
  if (direct) return Number(direct[1]);
  const lc = /line\s+(\d+)\s+column\s+(\d+)/i.exec(message);
  if (!lc) return null;
  const line = Number(lc[1]);
  const column = Number(lc[2]);
  let offset = 0;
  const lines = text.split('\n');
  for (let i = 0; i < Math.max(0, line - 1) && i < lines.length; i++) offset += lines[i].length + 1;
  return offset + Math.max(0, column - 1);
}
function stripAccidentalPrefix(text) {
  let out = text.replace(/^\uFEFF/, '');
  if (/^\s*[\[{]/.test(out)) return { text: out, stripped: 0 };

  // A previous large-file tooling response can accidentally prepend lines such as
  // "Warning: truncated output ..." before the real JSON. Recover the actual dataset root.
  const markers = [
    out.indexOf('{\n  "generatedAt"'),
    out.indexOf('{\r\n  "generatedAt"'),
    out.indexOf('{"generatedAt"'),
  ].filter((n) => n >= 0);
  const start = markers.length ? Math.min(...markers) : Math.min(
    ...[out.indexOf('{'), out.indexOf('[')].filter((n) => n >= 0)
  );
  if (!Number.isFinite(start) || start < 0) return { text: out, stripped: 0 };
  return { text: out.slice(start), stripped: start };
}

if (!fs.existsSync(FILE)) {
  console.log('[launch-dataset-repair] file absent; skipping');
} else {
  const original = fs.readFileSync(FILE, 'utf8');
  const prefix = stripAccidentalPrefix(original);
  let text = prefix.text;
  let repaired = 0;
  let ok = false;

  if (prefix.stripped > 0) {
    repaired += 1;
    console.log(`[launch-dataset-repair] stripped accidental non-JSON prefix bytes=${prefix.stripped}`);
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      JSON.parse(text);
      ok = true;
      break;
    } catch (error) {
      const message = String(error?.message || error);
      const pos = positionFromMessage(text, message);
      if (!Number.isFinite(pos)) {
        console.warn(`[launch-dataset-repair] cannot locate JSON error: ${message}`);
        break;
      }

      const prev = previousNonSpace(text, pos);
      const next = nextNonSpace(text, pos);
      const commaError = /Expected ','|after array element|after property value|Unexpected non-whitespace character/i.test(message);

      if (commaError && prev && next) {
        const prevCanEndValue = ['}', ']', '"'].includes(prev.ch) || /[0-9el]/i.test(prev.ch);
        const nextCanStartValue = ['{', '[', '"'].includes(next.ch) || /[-0-9tfn]/i.test(next.ch);
        if (prevCanEndValue && nextCanStartValue) {
          text = text.slice(0, next.index) + ',' + text.slice(next.index);
          repaired += 1;
          console.log(`[launch-dataset-repair] inserted missing comma near position ${pos}`);
          continue;
        }
      }

      // Sometimes V8 points one or two characters after the real boundary. Search a very small
      // neighborhood for a close-brace/close-array followed by the next object/property.
      if (commaError) {
        const from = Math.max(0, pos - 12);
        const to = Math.min(text.length, pos + 12);
        const window = text.slice(from, to);
        const boundary = /([}\]])(\s*)([{\[]|"[A-Za-z_])/m.exec(window);
        if (boundary) {
          const insertAt = from + boundary.index + boundary[1].length + boundary[2].length;
          if (text[insertAt - 1] !== ',') {
            text = text.slice(0, insertAt) + ',' + text.slice(insertAt);
            repaired += 1;
            console.log(`[launch-dataset-repair] repaired nearby JSON boundary around position ${pos}`);
            continue;
          }
        }
      }

      const context = text.slice(Math.max(0, pos - 35), Math.min(text.length, pos + 35)).replace(/\s+/g, ' ');
      console.warn(`[launch-dataset-repair] unsupported JSON error at ${pos}: ${message}; context=${JSON.stringify(context)}`);
      break;
    }
  }

  if (ok) {
    if (text !== original) fs.writeFileSync(FILE, text, 'utf8');
    console.log(`[launch-dataset-repair] valid=true repairs=${repaired}`);
  } else {
    // The runtime loader already has an authoritative CSV fallback. Do not leave a known-broken
    // JSON file in place where every browse request will parse it, throw, and then fall back again.
    // Quarantine only in the ephemeral Render filesystem; the repository source remains untouched.
    const csvFallback = path.join(process.cwd(), 'data', 'conferencegate-worldwide-2026-2028.csv');
    if (fs.existsSync(csvFallback)) {
      const quarantined = FILE + '.malformed';
      try { if (fs.existsSync(quarantined)) fs.unlinkSync(quarantined); } catch {}
      try {
        fs.renameSync(FILE, quarantined);
        console.warn(`[launch-dataset-repair] valid=false repairs=${repaired}; quarantined malformed JSON; CSV fallback active`);
      } catch (error) {
        console.warn(`[launch-dataset-repair] valid=false repairs=${repaired}; quarantine failed: ${error?.message || error}`);
      }
    } else {
      console.warn(`[launch-dataset-repair] valid=false repairs=${repaired}; no CSV fallback available`);
    }
  }
}
