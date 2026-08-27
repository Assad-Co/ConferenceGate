// Deterministic (non-LLM) extraction of concrete formatting facts from a conference's own
// submission-requirements text — the same "compute the real fact in code, never trust an LLM to
// get an exact detail right" pattern used for word-limit checking elsewhere in the app. Only ever
// returns a value when the text actually states it; callers fall back to sensible academic
// defaults for anything left null, never guessing on our end either.
export interface ParsedFormattingRequirements {
  fontFamily: string | null;
  fontSizePt: number | null;
  fontColorHex: string | null;
  lineSpacing: 'single' | 'double' | null;
}

const KNOWN_FONTS = [
  'Times New Roman',
  'Times',
  'Arial',
  'Calibri',
  'Cambria',
  'Georgia',
  'Helvetica',
  'Garamond',
  'Courier New',
  'Verdana',
  'Tahoma',
];

const NAMED_COLORS: Record<string, string> = {
  black: '000000',
  navy: '000080',
  'dark blue': '00008B',
  blue: '0000FF',
  red: 'FF0000',
};

export function parseFormattingRequirements(text: string | null | undefined): ParsedFormattingRequirements {
  const result: ParsedFormattingRequirements = {
    fontFamily: null,
    fontSizePt: null,
    fontColorHex: null,
    lineSpacing: null,
  };
  if (!text || !text.trim()) return result;

  const lower = text.toLowerCase();

  for (const font of KNOWN_FONTS) {
    if (lower.includes(font.toLowerCase())) {
      result.fontFamily = font === 'Times' ? 'Times New Roman' : font;
      break;
    }
  }

  const sizeMatch =
    text.match(/(\d{1,2})\s*[- ]?\s*(?:pt|point)\b/i) || text.match(/font\s*size\s*(?:of|is|:)?\s*(\d{1,2})/i);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1], 10);
    if (size >= 6 && size <= 72) result.fontSizePt = size;
  }

  for (const [name, hex] of Object.entries(NAMED_COLORS)) {
    const re = new RegExp(`\\b${name}\\b\\s*(text|font|colou?r)|\\b(text|font|colou?r)\\b[^.]{0,20}\\b${name}\\b`, "i");
    if (re.test(text)) {
      result.fontColorHex = hex;
      break;
    }
  }

  if (/double[- ]spaced|double\s+spacing/i.test(text)) result.lineSpacing = 'double';
  else if (/single[- ]spaced|single\s+spacing/i.test(text)) result.lineSpacing = 'single';

  return result;
}
