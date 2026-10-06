async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `ConferenceGate request failed (HTTP ${res.status})`);
  return data;
}

export async function downloadMeetingMinutesPdf(id: string): Promise<Blob> {
  const res = await fetch(`/api/meeting-minutes/${encodeURIComponent(id)}/pdf`, { credentials: 'include' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not generate the PDF meeting minutes.');
  }
  return res.blob();
}

export interface MeetingMinutesPdfSendResult {
  emailConfigured: boolean;
  recipientCount: number;
  emailSentCount: number;
  emailFailedCount: number;
  distributedAt?: string | null;
}

export async function sendMeetingMinutesPdfToMembers(id: string, externalEmails: string[] = []): Promise<MeetingMinutesPdfSendResult> {
  const res = await fetch(`/api/meeting-minutes/${encodeURIComponent(id)}/send-pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ externalEmails }),
  });
  return parseJson(res);
}

export interface MeetingMinutesGmailDraft {
  recipients: string[];
  recipientCount: number;
  subject: string;
  body: string;
}

export async function fetchMeetingMinutesGmailDraft(id: string): Promise<MeetingMinutesGmailDraft> {
  const res = await fetch(`/api/meeting-minutes/${encodeURIComponent(id)}/gmail-draft`, { credentials: 'include' });
  return parseJson(res);
}
