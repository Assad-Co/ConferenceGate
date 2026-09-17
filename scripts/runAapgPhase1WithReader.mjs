// AAPG blocks plain Render fetches with HTTP 403. Phase 1 still needs to run from the
// production service, so this wrapper routes AAPG-owned pages through Jina Reader first and
// falls back to a normal fetch only if the hosted reader fails. The existing importer remains
// the authority for parsing, validation, tabs, logos, and database writes.

const nativeFetch = globalThis.fetch.bind(globalThis);
const JINA_TIMEOUT_MS = 18000;

console.log('[aapg-phase1-v3] reader-first bootstrap active');

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMarkdown(value = "") {
  const tokens = [];
  let text = String(value)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt, url) => {
      const token = `@@CGMD${tokens.length}@@`;
      tokens.push(`<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}">`);
      return token;
    })
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, label, url) => {
      const token = `@@CGMD${tokens.length}@@`;
      tokens.push(`<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`);
      return token;
    });

  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  tokens.forEach((html, index) => {
    text = text.replace(`@@CGMD${index}@@`, html);
  });
  return text;
}

function markdownToHtml(markdown = "") {
  const raw = String(markdown);
  const titleMatch = /^(?:Title:\s*|#\s+)(.+)$/im.exec(raw);
  const title = titleMatch?.[1]?.trim() || "AAPG Events";
  const contentMarker = raw.indexOf("Markdown Content:");
  const body = contentMarker >= 0 ? raw.slice(contentMarker + "Markdown Content:".length) : raw;

  const blocks = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul>${list.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    list = [];
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushList();
      const level = Math.min(6, heading[1].length);
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      continue;
    }
    flushList();
    blocks.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  flushList();

  return `<!doctype html><html><head><title>${escapeHtml(title)}</title></head><body><main>${blocks.join("\n")}</main></body></html>`;
}

function isAapgPage(input) {
  try {
    const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return host === "aapg.org" || host.endsWith(".aapg.org");
  } catch {
    return false;
  }
}

async function readViaJina(pageUrl) {
  const headers = {
    Accept: "text/plain",
    "X-Return-Format": "markdown",
  };
  if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;

  const res = await nativeFetch(`https://r.jina.ai/${pageUrl}`, {
    headers,
    signal: AbortSignal.timeout(JINA_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Jina HTTP ${res.status}`);
  const markdown = (await res.text()).trim();
  if (markdown.length < 100) throw new Error("Jina returned too little content");
  return markdownToHtml(markdown);
}

globalThis.fetch = async function conferenceGateAapgFetch(input, init) {
  const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
  if (!isAapgPage(input)) return nativeFetch(input, init);

  try {
    const html = await readViaJina(rawUrl);
    console.log(`[aapg-phase1-v3] Jina recovered ${rawUrl} chars=${html.length}`);
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "x-conferencegate-reader": "jina" },
    });
  } catch (error) {
    console.warn(`[aapg-phase1-v3] Jina failed ${rawUrl}: ${error?.message || error}; trying direct`);
  }

  try {
    const direct = await nativeFetch(input, init);
    if (!direct.ok) {
      console.warn(`[aapg-phase1-v3] direct fallback ${direct.status} ${rawUrl}`);
    }
    return direct;
  } catch (error) {
    console.warn(`[aapg-phase1-v3] all routes failed ${rawUrl}: ${error?.message || error}`);
    return new Response("AAPG page unavailable", { status: 502, headers: { "content-type": "text/plain" } });
  }
};

await import("./importAapgPhase1.mjs");
