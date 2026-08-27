// Deterministic word-count/limit parsing — the AI abstract check must never be trusted to count
// words itself (LLMs are unreliable at exact arithmetic over long text), so the real compliance
// fact is computed here in code and handed to the model as ground truth, not left for it to guess.
export interface WordLimit {
  min: number | null;
  max: number | null;
}

export function parseWordLimit(requirements: string | null | undefined): WordLimit | null {
  if (!requirements) return null;
  const text = requirements.toLowerCase();

  let m = text.match(/(\d{2,5})\s*(?:-|–|—|to)\s*(\d{2,5})\s*words?/);
  if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };

  m = text.match(/(?:max(?:imum)?|up to|no more than|not exceed(?:ing)?)\s*(\d{2,5})\s*words?/);
  if (m) return { min: null, max: parseInt(m[1], 10) };

  m = text.match(/(\d{2,5})[\s-]*words?\s*(?:limit|maximum|max)\b/);
  if (m) return { min: null, max: parseInt(m[1], 10) };

  m = text.match(/(?:at least|minimum|min\.?)\s*(\d{2,5})\s*words?/);
  if (m) return { min: parseInt(m[1], 10), max: null };

  m = text.match(/\b(\d{2,5})\s*words?\b/);
  if (m) return { min: null, max: parseInt(m[1], 10) };

  return null;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export interface WordComplianceResult {
  wordCount: number;
  limit: WordLimit | null;
  note: string | null;
}

export function checkWordCompliance(
  abstractText: string,
  requirements: string | null | undefined
): WordComplianceResult {
  const wordCount = countWords(abstractText);
  const limit = parseWordLimit(requirements);
  if (!limit) return { wordCount, limit: null, note: null };

  let note: string | null = null;
  if (limit.max != null && wordCount > limit.max) {
    const over = wordCount - limit.max;
    note = `Exceeds the stated ${limit.max}-word limit by ${over} word${over === 1 ? "" : "s"} (currently ${wordCount} words).`;
  } else if (limit.min != null && wordCount < limit.min) {
    note = `Below the stated minimum of ${limit.min} words (currently ${wordCount} words).`;
  } else if (limit.min != null && limit.max != null) {
    note = `Within the stated ${limit.min}–${limit.max} word range (currently ${wordCount} words).`;
  } else if (limit.max != null) {
    note = `Within the stated ${limit.max}-word limit (currently ${wordCount} words).`;
  } else if (limit.min != null) {
    note = `Meets the stated minimum of ${limit.min} words (currently ${wordCount} words).`;
  }

  return { wordCount, limit, note };
}
