// Turns compact harvest capture into evidence JSONL.
// Each stdin line: TITLE :: URL :: STATED :: ORG :: QUERY
// "::" is the delimiter because conference page titles routinely contain "|" and "-".
// Blank ORG becomes null. Lines starting with # are ignored. A line whose URL field is not an
// http(s) URL is rejected rather than silently written to the wrong column.
import fs from "node:fs";
const [, , outFile] = process.argv;
if (!outFile) { console.error("usage: appendHarvest.mjs <out.jsonl>"); process.exit(1); }
const out = [];
let rejected = 0;
for (const raw of fs.readFileSync(0, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const parts = line.split("::").map((p) => p.trim());
  if (parts.length !== 5) { console.error(`REJECTED (${parts.length} fields):`, line.slice(0, 110)); rejected++; continue; }
  const [title, url, stated, org, query] = parts;
  if (!/^https?:\/\/\S+$/i.test(url)) { console.error("REJECTED (bad url):", url.slice(0, 90)); rejected++; continue; }
  if (!title || !stated || !query) { console.error("REJECTED (empty field):", line.slice(0, 110)); rejected++; continue; }
  out.push(JSON.stringify({ query, title, url, stated, org: org || null }));
}
if (out.length) fs.appendFileSync(outFile, out.join("\n") + "\n");
console.log(`appended ${out.length}, rejected ${rejected} -> ${outFile}`);
if (rejected) process.exitCode = 1;
