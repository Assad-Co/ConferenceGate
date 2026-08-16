import { jsPDF } from 'jspdf';

export interface CertificateData {
  title: string;
  recipientName: string;
  event: string;
  paperTitle: string;
  issuer: string;
  date: string;
  verificationHash: string;
}

export function downloadCertificatePDF(cert: CertificateData) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  // Outer border
  doc.setDrawColor(30, 58, 138); // blue-900
  doc.setLineWidth(3);
  doc.rect(24, 24, pageWidth - 48, pageHeight - 48);
  doc.setLineWidth(0.75);
  doc.rect(34, 34, pageWidth - 68, pageHeight - 68);

  doc.setTextColor(30, 58, 138);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('CONFERENCE GATE', centerX, 80, { align: 'center' });

  doc.setTextColor(100, 116, 139); // slate-500
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Official Certificate — Verified Digital Credential', centerX, 100, { align: 'center' });

  doc.setTextColor(15, 23, 42); // slate-900
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text(cert.title, centerX, 150, { align: 'center' });

  doc.setTextColor(71, 85, 105); // slate-600
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  doc.text('This certifies that', centerX, 190, { align: 'center' });

  doc.setTextColor(30, 58, 138);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.text(cert.recipientName, centerX, 222, { align: 'center' });

  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  const paperLines = doc.splitTextToSize(cert.paperTitle, pageWidth - 200);
  doc.text(paperLines, centerX, 250, { align: 'center' });

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(`at ${cert.event}`, centerX, 250 + paperLines.length * 18 + 14, { align: 'center' });

  const footerY = pageHeight - 90;
  doc.setDrawColor(226, 232, 240); // slate-200
  doc.setLineWidth(0.5);
  doc.line(80, footerY, pageWidth - 80, footerY);

  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Issued by: ${cert.issuer}`, 80, footerY + 22);
  doc.text(`Date: ${cert.date}`, 80, footerY + 38);
  doc.text(`Verification code: ${cert.verificationHash}`, pageWidth - 80, footerY + 22, { align: 'right' });
  doc.text('Verify at conferencegate.example/verify', pageWidth - 80, footerY + 38, { align: 'right' });

  const filename = `${cert.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
  doc.save(filename);
}
