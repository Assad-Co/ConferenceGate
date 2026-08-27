import { jsPDF } from 'jspdf';

export interface AbstractDraftData {
  conferenceTitle: string;
  title: string;
  authors: string;
  abstractText: string;
  /** The real, extracted submission requirements text for this conference, if any — printed at
   * the foot of the draft as a reminder to check before uploading. Never invented; omitted
   * entirely when the source page didn't state any. */
  requirementsNote?: string | null;
}

// Generates a clean, standard single-column academic abstract layout as a starting point for the
// author to review against the conference's own real requirements — never claims to guarantee
// compliance with arbitrary formatting rules we can't structurally verify, which is why the real
// requirements text (when known) is printed on the document itself rather than silently applied.
export function downloadAbstractDraftPDF(data: AbstractDraftData) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 72; // 1 inch
  const contentWidth = pageWidth - marginX * 2;
  const centerX = pageWidth / 2;
  let y = 90;

  doc.setFont('times', 'bold');
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(data.title || 'Untitled Abstract', contentWidth);
  doc.text(titleLines, centerX, y, { align: 'center' });
  y += titleLines.length * 20 + 16;

  if (data.authors.trim()) {
    doc.setFont('times', 'normal');
    doc.setFontSize(12);
    const authorLines = doc.splitTextToSize(data.authors, contentWidth);
    doc.text(authorLines, centerX, y, { align: 'center' });
    y += authorLines.length * 16 + 24;
  }

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 24;

  doc.setFont('times', 'bold');
  doc.setFontSize(12);
  doc.text('Abstract', marginX, y);
  y += 18;

  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  const bodyLines = doc.splitTextToSize(data.abstractText || '', contentWidth);
  for (const line of bodyLines) {
    if (y > pageHeight - 100) {
      doc.addPage();
      y = 72;
    }
    doc.text(line, marginX, y);
    y += 16;
  }

  if (data.requirementsNote) {
    if (y > pageHeight - 140) {
      doc.addPage();
      y = 72;
    }
    y += 20;
    doc.setDrawColor(200, 200, 200);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 20;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(180, 83, 9); // amber-700
    doc.text(`Check against ${data.conferenceTitle}'s real requirements before uploading:`, marginX, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const reqLines = doc.splitTextToSize(data.requirementsNote, contentWidth);
    for (const line of reqLines) {
      if (y > pageHeight - 60) {
        doc.addPage();
        y = 72;
      }
      doc.text(line, marginX, y);
      y += 12;
    }
  }

  const filename = `${(data.title || 'abstract-draft').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
  doc.save(filename);
}
