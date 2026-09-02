export interface JinaResult { ok: boolean; html: string; error: string | null }

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Read a public page through Jina only after the direct route failed or was too thin. */
export async function readWithJina(url: string): Promise<JinaResult> {
  if (process.env.DISCOVERY_JINA_ENABLED !== "1") return { ok: false, html: "", error: "disabled" };
  try {
    const headers: Record<string, string> = { Accept: "text/plain" };
    if (process.env.JINA_API_KEY) headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
    const response = await fetch(`https://r.jina.ai/${url}`, { headers, signal: AbortSignal.timeout(20_000) });
    const text = await response.text();
    if (!response.ok || text.trim().length < 200) return { ok: false, html: "", error: `http_${response.status}` };
    const title = /^(?:Title:\s*|#\s+)(.+)$/im.exec(text)?.[1]?.trim() || "";
    return { ok: true, html: `<main>${title ? `<h1>${escapeHtml(title)}</h1>` : ""}<pre>${escapeHtml(text)}</pre></main>`, error: null };
  } catch (error: any) {
    return { ok: false, html: "", error: error?.name === "TimeoutError" ? "timeout" : String(error?.message || error) };
  }
}

