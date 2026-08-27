import { Document, Packer, Paragraph, TextRun, AlignmentType, LineRuleType } from 'docx';
import { parseFormattingRequirements } from './parseFormattingRequirements';

export interface AbstractDraftData {
  conferenceTitle: string;
  title: string;
  authors: string;
  abstractText: string;
  /** The real, extracted submission requirements text for this conference, if any — used only to
   * derive real formatting (font/size/color/spacing) to apply to the document itself. Never
   * printed as a note in the file, since a downloaded draft should look like a real, submittable
   * abstract rather than carry Conference Gate's own disclaimers. */
  requirementsNote?: string | null;
}

const DEFAULT_FONT = 'Times New Roman';
const DEFAULT_SIZE_PT = 12;
const DEFAULT_COLOR_HEX = '000000';

// Builds the actual Document object — split out from the download side effect below so the real
// formatting logic (font/size/color/spacing derived from the conference's own requirements text)
// can be tested directly without a browser DOM.
export function buildAbstractDraftDocument(data: AbstractDraftData): Document {
  const { fontFamily, fontSizePt, fontColorHex, lineSpacing } = parseFormattingRequirements(data.requirementsNote);
  const font = fontFamily || DEFAULT_FONT;
  const bodySize = (fontSizePt || DEFAULT_SIZE_PT) * 2; // docx sizes are in half-points
  const color = fontColorHex || DEFAULT_COLOR_HEX;
  const spacing =
    lineSpacing === 'double'
      ? { line: 480, lineRule: LineRuleType.AUTO }
      : lineSpacing === 'single'
      ? { line: 240, lineRule: LineRuleType.AUTO }
      : undefined;

  const bodyParagraphs = (data.abstractText || '(no abstract text yet)')
    .split(/\n+/)
    .filter((p) => p.trim())
    .map(
      (paragraph) =>
        new Paragraph({
          children: [new TextRun({ text: paragraph, font, size: bodySize, color })],
          spacing: { ...spacing, after: 200 },
        })
    );

  return new Document({
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 200 },
            children: [
              new TextRun({ text: data.title || 'Untitled Abstract', bold: true, font, size: bodySize + 4, color }),
            ],
          }),
          ...(data.authors.trim()
            ? [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 300 },
                  children: [new TextRun({ text: data.authors, italics: true, font, size: bodySize, color })],
                }),
              ]
            : []),
          new Paragraph({
            spacing: { after: 150 },
            children: [new TextRun({ text: 'Abstract', bold: true, font, size: bodySize, color })],
          }),
          ...bodyParagraphs,
        ],
      },
    ],
  });
}

// Generates a genuine, editable .docx (not a PDF disguised as one) so the author can keep working
// on it in Word/Google Docs after downloading. Formatting (font, size, color, line spacing) is
// pulled from the conference's own real requirements text when it states one, falling back to a
// standard academic-abstract look otherwise — never inventing a specific rule the conference
// itself didn't state.
export async function downloadAbstractDraftDocx(data: AbstractDraftData): Promise<void> {
  const doc = buildAbstractDraftDocument(data);
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(data.title || 'abstract-draft').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.docx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
