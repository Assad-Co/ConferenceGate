// A small, forgiving HTML parser.
//
// Microdata and RDFa are defined in terms of element nesting — an itemprop belongs to the nearest
// enclosing itemscope — and the deterministic extractor needs the same thing to read "the value
// next to the label Venue:". Regular expressions cannot express nesting, so this builds a real
// tree. It is deliberately small rather than standards-complete: it handles the malformed markup
// conference sites actually ship (unclosed <p>, stray </div>, attributes without quotes) and
// stops there.
//
// No dependency is added for this. The project already ships an extraction pipeline with no HTML
// parser; introducing one here for the discovery engine alone would be a new install for every
// deployment of an app that otherwise needs none.

export interface HtmlNode {
  type: "element" | "text";
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlNode | null;
  text: string;
}

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

const RAW_TEXT_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

/** Block-level elements. Starting one closes an open paragraph or heading, exactly as a browser
 *  does — which is what keeps an unclosed <h1> on a sloppily built conference site from
 *  swallowing the rest of the page as its own text. */
const BLOCK_LEVEL = new Set([
  "address", "article", "aside", "blockquote", "details", "div", "dl", "dt", "dd", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hgroup", "hr", "li", "main", "menu", "nav", "ol", "p", "pre", "section", "table", "ul",
]);
const CLOSED_BY_BLOCK = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6"]);

/** Elements that implicitly close an open element of the same or a related kind. */
const IMPLICIT_CLOSERS: Record<string, Set<string>> = {
  li: new Set(["li"]),
  p: new Set(["p"]),
  dt: new Set(["dt", "dd"]),
  dd: new Set(["dt", "dd"]),
  tr: new Set(["tr", "td", "th"]),
  td: new Set(["td", "th"]),
  th: new Set(["td", "th"]),
  option: new Set(["option"]),
  thead: new Set(["thead", "tbody", "tfoot"]),
  tbody: new Set(["thead", "tbody", "tfoot"]),
  tfoot: new Set(["thead", "tbody", "tfoot"]),
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", eacute: "é", egrave: "è",
  agrave: "à", ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä", szlig: "ß", copy: "©",
  reg: "®", trade: "™", deg: "°", euro: "€", pound: "£", yen: "¥", times: "×", middot: "·",
  bull: "•", laquo: "«", raquo: "»", sup2: "²", frac12: "½", minus: "−",
};

export function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function makeElement(tag: string, attrs: Record<string, string>, parent: HtmlNode | null): HtmlNode {
  return { type: "element", tag, attrs, children: [], parent, text: "" };
}

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:\s+[^<>]*?)?)(\/?)>/g;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!raw.trim()) return attrs;
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** Parses a document into a tree. Never throws: unparseable markup yields whatever was readable. */
export function parseHtml(html: string): HtmlNode {
  const root = makeElement("#root", {}, null);
  let current = root;
  let cursor = 0;

  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, " ")
    .replace(/<![^>]*>/g, " ");

  const pushText = (raw: string) => {
    if (!raw) return;
    const text = decodeEntities(raw);
    if (!text.trim()) return;
    current.children.push({ type: "text", tag: "#text", attrs: {}, children: [], parent: current, text });
  };

  TAG_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_RE.exec(stripped))) {
    const [full, closing, rawTag, rawAttrs, selfClosing] = match;
    pushText(stripped.slice(cursor, match.index));
    cursor = match.index + full.length;
    const tag = rawTag.toLowerCase();

    if (closing) {
      // Walk up to the nearest matching open element; a stray close tag is ignored.
      let node: HtmlNode | null = current;
      while (node && node.tag !== tag) node = node.parent;
      if (node?.parent) current = node.parent;
      continue;
    }

    const attrs = parseAttributes(rawAttrs || "");

    if (BLOCK_LEVEL.has(tag)) {
      let node: HtmlNode | null = current;
      while (node && node !== root && CLOSED_BY_BLOCK.has(node.tag)) {
        current = node.parent || root;
        node = node.parent;
      }
    }

    const closers = IMPLICIT_CLOSERS[tag];
    if (closers) {
      let node: HtmlNode | null = current;
      while (node && node !== root && closers.has(node.tag)) {
        current = node.parent || root;
        node = node.parent;
      }
    }

    const element = makeElement(tag, attrs, current);
    current.children.push(element);

    if (VOID_ELEMENTS.has(tag) || selfClosing) continue;

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = stripped.slice(cursor);
      const closeMatch = closeRe.exec(rest);
      // An unclosed <title> or <script> must not swallow the whole document: with no closing tag
      // anywhere, take only as far as the next tag starts.
      const raw = closeMatch
        ? rest.slice(0, closeMatch.index)
        : rest.slice(0, rest.search(/<[a-zA-Z/]/) === -1 ? rest.length : rest.search(/<[a-zA-Z/]/));
      // script/style content is kept verbatim: JSON-LD lives inside a <script> and must not be
      // entity-decoded or whitespace-collapsed before JSON.parse sees it.
      element.children.push({ type: "text", tag: "#text", attrs: {}, children: [], parent: element, text: raw });
      cursor += raw.length + (closeMatch ? closeMatch[0].length : 0);
      TAG_RE.lastIndex = cursor;
      continue;
    }

    current = element;
  }
  pushText(stripped.slice(cursor));
  return root;
}

const NON_CONTENT_TAGS = new Set(["script", "style", "noscript", "template", "svg", "iframe"]);
/** Boilerplate wrappers: excluded when reading a page's prose, per section 46. */
const CHROME_TAGS = new Set(["nav", "header", "footer", "aside", "form"]);

export function textOf(node: HtmlNode, options: { skipChrome?: boolean } = {}): string {
  if (node.type === "text") return node.text;
  if (NON_CONTENT_TAGS.has(node.tag)) return "";
  if (options.skipChrome && CHROME_TAGS.has(node.tag)) return "";
  const parts: string[] = [];
  for (const child of node.children) {
    const text = textOf(child, options);
    if (text) parts.push(text);
  }
  const joined = parts.join(" ");
  return joined.replace(/\s+/g, " ").trim();
}

export function* walk(node: HtmlNode): Generator<HtmlNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

export function findAll(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode[] {
  const out: HtmlNode[] = [];
  for (const node of walk(root)) {
    if (node.type === "element" && predicate(node)) out.push(node);
  }
  return out;
}

export function findFirst(root: HtmlNode, predicate: (node: HtmlNode) => boolean): HtmlNode | null {
  for (const node of walk(root)) {
    if (node.type === "element" && predicate(node)) return node;
  }
  return null;
}

export function byTag(root: HtmlNode, ...tags: string[]): HtmlNode[] {
  const wanted = new Set(tags.map((t) => t.toLowerCase()));
  return findAll(root, (node) => wanted.has(node.tag));
}

export function attr(node: HtmlNode, name: string): string | null {
  const value = node.attrs[name.toLowerCase()];
  return value === undefined ? null : value;
}

/** `<meta name=... content=...>` and `<meta property=... content=...>` in one lookup. */
export function metaContent(root: HtmlNode, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const node of byTag(root, "meta")) {
    const key = (node.attrs.name || node.attrs.property || node.attrs.itemprop || "").toLowerCase();
    if (key === wanted) {
      const content = node.attrs.content?.trim();
      if (content) return content;
    }
  }
  return null;
}

export function documentTitle(root: HtmlNode): string | null {
  const title = findFirst(root, (node) => node.tag === "title");
  const text = title ? textOf(title).trim() : "";
  return text || null;
}

/** The `<link rel="canonical">` target, resolved against the page URL. */
export function canonicalLink(root: HtmlNode, baseUrl: string): string | null {
  for (const node of byTag(root, "link")) {
    if ((node.attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical")) {
      const href = node.attrs.href?.trim();
      if (!href) continue;
      try {
        return new URL(href, baseUrl).href;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function absoluteUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value || typeof value !== "string" || !value.trim()) return null;
  try {
    const resolved = new URL(value.trim(), baseUrl);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    return resolved.href;
  } catch {
    return null;
  }
}

/** Readable page prose with navigation, headers, footers and forms removed. */
export function mainText(root: HtmlNode, limit = 20000): string {
  const body = findFirst(root, (node) => node.tag === "body") || root;
  const main = findFirst(body, (node) => node.tag === "main" || node.attrs.role === "main");
  return textOf(main || body, { skipChrome: !main }).slice(0, limit);
}
