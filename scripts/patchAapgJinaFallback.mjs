import fs from 'node:fs';

const path = 'scripts/importAapgPhase1.mjs';
let source = fs.readFileSync(path, 'utf8');

if (source.includes('[aapg-phase1-v2]')) {
  console.log('[aapg-phase1-v2] already installed');
  process.exit(0);
}

const oldBlock = `async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    return { html: await res.text(), finalUrl: res.url || url };
  } finally { clearTimeout(timer); }
}`;

if (!source.includes(oldBlock)) {
  throw new Error('[aapg-phase1-v2] fetchHtml anchor not found');
}

const newBlock = `function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function jinaMarkdownToHtml(markdown, baseUrl) {
  const lines = String(markdown || "").split(/\\r?\\n/);
  const body = lines.map((raw) => {
    const line = raw.trim();
    if (!line) return "<br>";

    const imageOnly = /^!\\[([^\\]]*)\\]\\((https?:\\/\\/[^)]+)\\)$/.exec(line);
    if (imageOnly) {
      return \`<img alt="\${escapeHtml(imageOnly[1])}" src="\${escapeHtml(imageOnly[2])}">\`;
    }

    let rendered = escapeHtml(line);
    rendered = rendered.replace(
      /!\\[([^\\]]*)\\]\\((https?:\\/\\/[^)]+)\\)/g,
      (_m, alt, src) => \`<img alt="\${escapeHtml(alt)}" src="\${escapeHtml(src)}">\`,
    );
    rendered = rendered.replace(
      /\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g,
      (_m, text, href) => \`<a href="\${escapeHtml(href)}">\${escapeHtml(text)}</a>\`,
    );

    const heading = /^(#{1,6})\\s+(.+)$/.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length);
      let headingText = escapeHtml(heading[2]);
      headingText = headingText.replace(
        /\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g,
        (_m, text, href) => \`<a href="\${escapeHtml(href)}">\${escapeHtml(text)}</a>\`,
      );
      return \`<h\${level}>\${headingText}</h\${level}>\`;
    }
    return \`<p>\${rendered}</p>\`;
  }).join("\\n");

  return \`<!doctype html><html><head><meta name="conferencegate-reader" content="jina"><base href="\${escapeHtml(baseUrl)}"></head><body><main>\${body}</main></body></html>\`;
}

async function fetchViaJina(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18000);
  try {
    const headers = {
      Accept: "text/plain",
      "X-Return-Format": "markdown",
    };
    if (process.env.JINA_API_KEY) headers.Authorization = \`Bearer \${process.env.JINA_API_KEY}\`;
    const readerUrl = \`https://r.jina.ai/\${url}\`;
    const res = await fetch(readerUrl, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(\`Jina HTTP \${res.status}\`);
    const markdown = (await res.text()).trim();
    if (markdown.length < 200) throw new Error('Jina returned too little content');
    console.log(\`[aapg-phase1-v2] Jina recovered \${url} chars=\${markdown.length}\`);
    return { html: jinaMarkdownToHtml(markdown, url), finalUrl: url, via: "jina" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchDirect(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
        Referer: "https://www.google.com/",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    const html = await res.text();
    if (html.trim().length < 200) throw new Error('direct response too small');
    return { html, finalUrl: res.url || url, via: "direct" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtml(url) {
  const host = hostOf(url);
  const aapgOwned = host === "aapg.org" || host.endsWith(".aapg.org");
  const errors = [];

  // AAPG currently returns HTTP 403 to Render's server IPs. Do not make that the primary route.
  // Jina's hosted reader is already part of ConferenceGate's configured extraction stack and
  // reaches the public page from separate infrastructure.
  if (aapgOwned) {
    try {
      return await fetchViaJina(url);
    } catch (error) {
      errors.push(error?.message || String(error));
      console.warn(\`[aapg-phase1-v2] Jina failed \${url}: \${error?.message || error}; trying direct\`);
    }
  }

  try {
    return await fetchDirect(url);
  } catch (error) {
    errors.push(error?.message || String(error));
    console.warn(\`[aapg-phase1-v2] direct failed \${url}: \${error?.message || error}\`);
  }

  if (!aapgOwned) {
    try {
      return await fetchViaJina(url);
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  throw new Error(errors.join(' -> ') || 'all fetch routes failed');
}`;

source = source.replace(oldBlock, newBlock);
fs.writeFileSync(path, source);
console.log('[aapg-phase1-v2] installed Jina-first AAPG recovery with direct/Jina fallback');
