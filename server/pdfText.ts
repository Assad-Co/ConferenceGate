// Conference sites routinely publish the things people most need — the call for papers, the
// programme, the registration fee table — as a PDF rather than a web page. Those were previously
// rejected outright by the content-type guard, which meant a site could be crawled perfectly and
// still yield nothing, because everything worth reading lived in a linked document.

const MAX_PDF_BYTES = 12 * 1024 * 1024;

/** Extracts the visible text from a PDF. Returns null — never throws — for an encrypted,
 *  corrupt, scanned-image, or oversized document, so a caller can treat it the same as any
 *  other page it couldn't read. */
export async function extractPdfText(buffer: ArrayBuffer): Promise<string | null> {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) return null;
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      const text = (result?.text || "")
        // The parser marks page boundaries with "-- 3 of 12 --"; they carry no conference
        // information and only confuse the extraction.
        .replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      // A scanned PDF is a stack of images with no text layer; it parses fine and returns almost
      // nothing, which is indistinguishable from an empty document. Treated as unreadable.
      return text.length > 0 ? text : null;
    } finally {
      await parser.destroy?.().catch?.(() => {});
    }
  } catch (error: any) {
    console.error(`PDF text extraction failed: ${error?.message || error}`);
    return null;
  }
}
