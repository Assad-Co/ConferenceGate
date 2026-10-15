import fs from 'fs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('server.ts', (source) => {
  if (!source.includes('import { supportRouter, initSupportSchema } from "./server/support";')) {
    const anchor = 'import { postsRouter } from "./server/posts";';
    if (!source.includes(anchor)) throw new Error('[support-tickets] server import anchor missing');
    source = source.replace(anchor, anchor + '\nimport { supportRouter, initSupportSchema } from "./server/support";');
  }
  if (!source.includes('await initSupportSchema();')) {
    const anchor = '  await initProfessionalTrustSchema();';
    if (!source.includes(anchor)) throw new Error('[support-tickets] schema anchor missing');
    source = source.replace(anchor, anchor + '\n  await initSupportSchema();');
  }
  if (!source.includes('app.use("/api/support", supportRouter);')) {
    const anchor = '  app.use("/api/messages", messagesRouter);';
    if (!source.includes(anchor)) throw new Error('[support-tickets] route anchor missing');
    source = source.replace(anchor, anchor + '\n\n  // Persisted in-app support requests; does not depend on outbound email delivery.\n  app.use("/api/support", supportRouter);');
  }
  return source;
});

patchFile('src/components/SupportCenter.tsx', (source) => {
  if (!source.includes("const [supportSending, setSupportSending]")) {
    source = source.replace(
      "  const [message, setMessage] = useState('');",
      "  const [message, setMessage] = useState('');\n  const [supportSending, setSupportSending] = useState(false);\n  const [supportTicketId, setSupportTicketId] = useState<string | null>(null);\n  const [supportError, setSupportError] = useState<string | null>(null);"
    );
  }

  const oldHandler = `  const sendEmail = (event: React.FormEvent) => {\n    event.preventDefault();\n    const subject = \`[ConferenceGate Support] \${topic}\`;\n    const body = [\n      \`Name: \${name || 'Not provided'}\`,\n      \`Email: \${email || 'Not provided'}\`,\n      \`Topic: \${topic}\`,\n      '',\n      message,\n    ].join('\\n');\n    window.location.href = \`mailto:support@conferencegate.com?subject=\${encodeURIComponent(subject)}&body=\${encodeURIComponent(body)}\`;\n  };`;
  const newHandler = `  const sendEmail = async (event: React.FormEvent) => {\n    event.preventDefault();\n    if (supportSending) return;\n    setSupportSending(true);\n    setSupportError(null);\n    setSupportTicketId(null);\n    try {\n      const res = await fetch('/api/support/requests', {\n        method: 'POST',\n        headers: { 'Content-Type': 'application/json' },\n        credentials: 'include',\n        body: JSON.stringify({ name, email, topic, message }),\n      });\n      const data = await res.json().catch(() => ({}));\n      if (!res.ok) throw new Error(data.error || 'Could not submit your request.');\n      setSupportTicketId(String(data.id || 'submitted'));\n      setMessage('');\n    } catch (error) {\n      setSupportError(error instanceof Error ? error.message : 'Could not submit your request.');\n    } finally {\n      setSupportSending(false);\n    }\n  };`;
  if (source.includes(oldHandler)) source = source.replace(oldHandler, newHandler);

  source = source.replace(
    'Complete the form and your email application will open with the message addressed to support@conferencegate.com.',
    'Submit your request directly to ConferenceGate Support. The request is saved securely in ConferenceGate even if email delivery is temporarily unavailable.'
  );

  if (!source.includes('supportTicketId &&')) {
    const anchor = `          <form onSubmit={sendEmail} className="space-y-4">`;
    const insert = `          {supportTicketId && (\n            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">\n              Request received. Reference: <span className="font-bold">{supportTicketId}</span>\n            </div>\n          )}\n          {supportError && (\n            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{supportError}</div>\n          )}\n`;
    if (!source.includes(anchor)) throw new Error('[support-tickets] support form anchor missing');
    source = source.replace(anchor, insert + anchor);
  }

  source = source.replace(
    '<button type="submit" className="inline-flex items-center gap-2 rounded-full bg-blue-900 hover:bg-blue-950 text-white font-bold text-sm px-6 py-2.5 cursor-pointer"><Mail className="w-4 h-4" /> Email Support</button>',
    '<button type="submit" disabled={supportSending} className="inline-flex items-center gap-2 rounded-full bg-blue-900 hover:bg-blue-950 disabled:opacity-50 text-white font-bold text-sm px-6 py-2.5 cursor-pointer"><Mail className="w-4 h-4" /> {supportSending ? \'Submitting…\' : \'Submit Request\'}</button>'
  );
  return source;
});

console.log('[support-tickets] persisted Ask Us requests wired');
