import { Router } from 'express';
import { GoogleGenAI } from '@google/genai';

export const semanticMatchingRouter = Router();
type Candidate = { key: string; text: string };
const MAX_CANDIDATES = 30;
const MAX_TEXT = 650;
const normalize = (vector: number[]) => {
  const magnitude = Math.hypot(...vector);
  return magnitude ? vector.map(value => value / magnitude) : vector;
};
const cosine = (left: number[], right: number[]) =>
  left.length === right.length ? left.reduce((sum, value, index) => sum + value * right[index], 0) : 0;

/** Server-side trained-model ranking. API key never reaches the browser. */
semanticMatchingRouter.post('/semantic-rank', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) { res.status(503).json({ error: 'Semantic model unavailable', available: false }); return; }
  const interests = req.body?.interests;
  const candidates: unknown = req.body?.candidates;
  if (typeof interests !== 'string' || !interests.trim() || interests.length > 300 ||
    !Array.isArray(candidates) || candidates.length > MAX_CANDIDATES ||
    candidates.some(item => !item || typeof item.key !== 'string' || item.key.length > 500 ||
      typeof item.text !== 'string' || item.text.length > MAX_TEXT)) {
    res.status(400).json({ error: 'Invalid semantic ranking request' }); return;
  }
  try {
    const model = new GoogleGenAI({ apiKey });
    const texts = [interests, ...(candidates as Candidate[]).map(item => item.text)];
    const response = await model.models.embedContent({ model: 'gemini-embedding-001', contents: texts });
    const embeddings = response.embeddings?.map(item => normalize(item.values || [])) || [];
    if (embeddings.length !== texts.length || embeddings.some(values => !values.length)) throw new Error('Embedding response incomplete');
    const scores = (candidates as Candidate[]).map((item, index) => ({
      key: item.key, score: cosine(embeddings[0], embeddings[index + 1]),
    }));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ model: 'gemini-embedding-001', scores, available: true });
  } catch (error) {
    console.error('[semantic-rank] embedding failed:', error instanceof Error ? error.message : 'unknown');
    res.status(503).json({ error: 'Semantic model temporarily unavailable', available: false });
  }
});
