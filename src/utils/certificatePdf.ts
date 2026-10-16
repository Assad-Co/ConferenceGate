import { jsPDF } from 'jspdf';

export interface CertificateData {
  title: string;
  recipientName: string;
  event: string;
  paperTitle: string;
  issuer: string;
  date: string;
  verificationHash: string;
  issuedCertificateId?: string;
}

type CertificateKind = 'abstract' | 'reviewer' | 'committee' | 'generic';

function detectKind(title: string): CertificateKind {
  const value = title.toLowerCase();
  if (value.includes('abstract')) return 'abstract';
  if (value.includes('review')) return 'reviewer';
  if (value.includes('committee')) return 'committee';
  return 'generic';
}

function subtitleFor(kind: CertificateKind) {
  if (kind === 'abstract') return 'OF ABSTRACT ACCEPTANCE';
  if (kind === 'reviewer') return 'OF REVIEWER RECOGNITION';
  if (kind === 'committee') return 'OF TECHNICAL COMMITTEE SERVICE';
  return 'OF PROFESSIONAL RECOGNITION';
}

function descriptionFor(kind: CertificateKind, cert: CertificateData) {
  if (kind === 'abstract') {
    return `In recognition that the abstract “${cert.paperTitle}” has been formally accepted for ${cert.event}. This certificate is issued upon verified abstract acceptance through ConferenceGate.`;
  }
  if (kind === 'reviewer') {
    return `In recognition of completing assigned peer-review service for ${cert.event} with professionalism and care. This certificate is issued after the review activity has been submitted and recorded as complete through ConferenceGate.`;
  }
  if (kind === 'committee') {
    return `In recognition of valuable service as a Technical Committee member for ${cert.event}. This certificate is issued after the organizer confirms that the committee assignment has been successfully completed through ConferenceGate.`;
  }
  return `${cert.paperTitle} — ${cert.event}`;
}

function formatIssueDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { day: '2-digit', month: 'long', year: 'numeric' });
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const response = await fetch('/conference-gate-logo.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function certificateId(kind: CertificateKind, verificationHash: string) {
  const prefix = kind === 'abstract' ? 'AA' : kind === 'reviewer' ? 'RV' : kind === 'committee' ? 'TC' : 'PR';
  const compact = verificationHash.replace(/^0x/, '').replace(/[^a-z0-9]/gi, '').slice(-10).toUpperCase().padStart(10, '0');
  return `CG-${prefix}-${compact}`;
}

export async function downloadCertificatePDF(cert: CertificateData) {
  const kind = detectKind(cert.title);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;
  const issueDate = formatIssueDate(cert.date);
  const id = cert.issuedCertificateId || certificateId(kind, cert.verificationHash);

  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  // Subtle lower background wave.
  doc.setFillColor(246, 248, 252);
  doc.ellipse(centerX, pageHeight + 40, pageWidth * 0.65, 170, 'F');

  // ConferenceGate blue wave header.
  doc.setFillColor(17, 130, 246);
  doc.triangle(0, 85, pageWidth * 0.48, 18, pageWidth, 118, 'F');
  doc.setFillColor(14, 93, 220);
  doc.triangle(0, 115, pageWidth * 0.56, 46, pageWidth, 150, 'F');
  doc.setFillColor(255, 255, 255);
  doc.triangle(0, 42, pageWidth * 0.34, 28, 0, 93, 'F');

  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, 'PNG', 48, 34, 165, 58, undefined, 'FAST');
    } catch {
      // Text fallback below if image decoding fails in a specific browser.
    }
  }
  if (!logo) {
    doc.setTextColor(13, 76, 155);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('CONFERENCE', 50, 58);
    doc.setTextColor(48, 160, 245);
    doc.setFontSize(22);
    doc.text('GATE', 50, 80);
  }

  doc.setTextColor(70, 70, 78);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(37);
  doc.text('CERTIFICATE', centerX, 166, { align: 'center', charSpace: 1.8 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(subtitleFor(kind), centerX, 191, { align: 'center', charSpace: 2.2 });

  doc.setTextColor(20, 54, 118);
  doc.setFontSize(11);
  doc.text('PROUDLY PRESENTED TO', centerX, 235, { align: 'center', charSpace: 2.4 });

  // Recipient name: tailored for the signed-in user's profile.
  doc.setTextColor(16, 112, 235);
  doc.setFont('times', 'italic');
  const nameSize = cert.recipientName.length > 34 ? 27 : cert.recipientName.length > 24 ? 32 : 38;
  doc.setFontSize(nameSize);
  doc.text(cert.recipientName, centerX, 283, { align: 'center' });

  doc.setTextColor(76, 82, 92);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const body = doc.splitTextToSize(descriptionFor(kind, cert), 560);
  doc.text(body, centerX, 318, { align: 'center', lineHeightFactor: 1.45 });

  // Date of issue.
  doc.setDrawColor(86, 92, 102);
  doc.setLineWidth(0.7);
  doc.line(75, 455, 250, 455);
  doc.setTextColor(67, 73, 83);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(issueDate, 162.5, 472, { align: 'center' });
  doc.setFontSize(8);
  doc.text('DATE OF ISSUE', 162.5, 486, { align: 'center', charSpace: 1.2 });

  // ConferenceGate verification stamp.
  doc.setDrawColor(17, 108, 222);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(3);
  doc.circle(centerX, 443, 43, 'FD');
  doc.setLineWidth(1.1);
  doc.circle(centerX, 443, 34, 'D');
  doc.setTextColor(17, 108, 222);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('CONFERENCEGATE', centerX, 429, { align: 'center', charSpace: 0.5 });
  doc.setFontSize(15);
  doc.text('CG', centerX, 448, { align: 'center' });
  doc.setFontSize(8);
  doc.text(cert.issuedCertificateId ? 'REGISTERED' : 'ACTIVITY', centerX, 463, { align: 'center', charSpace: 1.1 });

  // ConferenceGate signature.
  doc.setTextColor(14, 86, 180);
  doc.setFont('times', 'italic');
  doc.setFontSize(24);
  doc.text('ConferenceGate', pageWidth - 160, 443, { align: 'center' });
  doc.setDrawColor(86, 92, 102);
  doc.setLineWidth(0.7);
  doc.line(pageWidth - 245, 455, pageWidth - 75, 455);
  doc.setTextColor(67, 73, 83);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('CONFERENCEGATE', pageWidth - 160, 472, { align: 'center', charSpace: 1.1 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(cert.issuedCertificateId ? 'CERTIFICATE REGISTRY' : 'ACTIVITY RECORD', pageWidth - 160, 486, { align: 'center', charSpace: 1.0 });

  doc.setTextColor(95, 102, 112);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(cert.issuedCertificateId ? 'Verify at conferencegate.com/verify.html?id=' + id : 'ConferenceGate activity record — not independently verified', centerX, 505, { align: 'center' });
  doc.setFontSize(7.5);
  doc.text(`CERTIFICATE ID: ${id}`, centerX, 519, { align: 'center', charSpace: 0.7 });

  const safeName = cert.recipientName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const filename = `${subtitleFor(kind).replace(/^OF /, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${safeName}.pdf`;
  doc.save(filename);
}
