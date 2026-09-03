// The hosted-reader route, and the only place the engine talks to Jina.
//
// It is deliberately thin. The HTTP call itself already existed in server/jinaReader.ts — the
// extraction pipeline has used it for a while — so this does not open a second connection to the
// same service with its own timeout, its own header handling and its own idea of what a failure
// is. It adds the two things a *discovery* crawl needs on top: an explicit opt-in flag, because
// this route costs money where the direct fetch does not, and a conversion from the reader's
// markdown into something the extractors can actually read.
//
// Deciding *when* to come here is not this module's job — see readPage.ts, which only reaches for
// it once a direct fetch has failed or come back too thin, and only within a per-run cap.

import { isJinaConfigured, jinaReadPageDetailed } from "../jinaReader";

export interface JinaResult {
  ok: boolean;
  html: string;
  error: string | null;
}

/** Opt-in: a paid route stays off until someone says otherwise, whatever else is configured. */
export function isJinaFallbackEnabled(): boolean {
  return process.env.DISCOVERY_JINA_ENABLED === "1" && isJinaConfigured();
}

/**
 * Wraps reader markdown in just enough HTML for the extractors to work on it.
 *
 * Not cosmetic. The deterministic extractor reads labels out of a parsed tree and needs a title
 * element to find a conference's name at all, and it finds "Abstract deadline: 3 March" by
 * looking at list items and headings. Flattening the markdown into one text blob would throw all
 * of that away; keeping its structure means a page rescued by the reader is extracted the same
 * way as any other. Structured data is gone either way — markdown has no <script> — which is
 * exactly why this route is second and not first.
 */
export function markdownToDocument(markdown: string): string {
  const titleMatch = /^(?:Title:\s*|#\s+)(.+)$/im.exec(markdown);
  const title = titleMatch ? titleMatch[1].trim() : "";
  const bodyStart = markdown.indexOf("Markdown Content:");
  const body = bodyStart === -1 ? markdown : markdown.slice(bodyStart + "Markdown Content:".length);

  const escape = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const html = body
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
      if (heading) {
        const level = Math.min(6, heading[1].length);
        return `<h${level}>${escape(heading[2])}</h${level}>`;
      }
      if (/^[-*]\s+/.test(trimmed)) {
        const items = trimmed
          .split(/\n/)
          .filter((line) => /^[-*]\s+/.test(line.trim()))
          .map((line) => `<li>${escape(line.trim().replace(/^[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${escape(trimmed)}</p>`;
    })
    .join("\n");

  return `<!DOCTYPE html><html><head><title>${escape(title)}</title><meta name="og:title" content="${escape(title)}"></head><body><main>${
    title ? `<h1>${escape(title)}</h1>` : ""
  }${html}</main></body></html>`;
}

/** Reads a public page through the hosted reader. Never throws: the caller falls through. */
export async function readWithJina(url: string): Promise<JinaResult> {
  if (!isJinaFallbackEnabled()) {
    return {
      ok: false,
      html: "",
      error: process.env.DISCOVERY_JINA_ENABLED === "1" ? "reader_disabled" : "disabled",
    };
  }
  const result = await jinaReadPageDetailed(url);
  const markdown = result.markdown;
  if (!markdown) return { ok: false, html: "", error: result.error || "reader_returned_nothing" };
  // Below this the reader has not really read anything either, and saying so is more useful than
  // handing back a document with three words in it.
  if (markdown.trim().length < 200) return { ok: false, html: "", error: "reader_returned_too_little" };
  return { ok: true, html: markdownToDocument(markdown), error: null };
}
