import fs from 'node:fs';

const path = 'server/linkedinConferenceActivityBootstrap.ts';
let source = fs.readFileSync(path, 'utf8');

const classifyAnchor = 'function classifyPosts(posts: any[], requestedUrl: string) {';
if (!source.includes('function extractPostYear(post: Record<string, any>): number | null {')) {
  const helper = `function extractPostYear(post: Record<string, any>): number | null {
  const values = [
    post.postedAt,
    post.publishedAt,
    post.createdAt,
    post.date,
    post.postDate,
    post.postedDate,
    post.timestamp,
    post.postedAtTimestamp,
  ];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      const direct = value.match(/\\b(20(?:1\\d|2\\d|3\\d))\\b/)?.[1];
      if (direct) return Number(direct);
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return new Date(parsed).getUTCFullYear();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const millis = value < 10_000_000_000 ? value * 1000 : value;
      const year = new Date(millis).getUTCFullYear();
      if (year >= 2010 && year <= new Date().getUTCFullYear() + 2) return year;
    }
  }
  return null;
}

`;
  const index = source.indexOf(classifyAnchor);
  if (index === -1) throw new Error('[linkedin-role-year] classifyPosts anchor not found');
  source = source.slice(0, index) + helper + source.slice(index);
}

const before = '    const year = extractYear(content);';
const after = '    const year = extractYear(content) || extractPostYear(post);';
if (!source.includes(after)) {
  if (!source.includes(before)) throw new Error('[linkedin-role-year] year extraction anchor not found');
  source = source.replace(before, after);
}

fs.writeFileSync(path, source);
console.log('[linkedin-role-year] LinkedIn post timestamp now supplies conference year when post text omits it');
