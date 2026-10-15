import fs from 'node:fs';

const file = 'src/components/AccountSettingsModal.tsx';
let source = fs.readFileSync(file, 'utf8');

source = source.replace(
  `                {!hasPassword && googleConnected && <p className="text-xs text-slate-500">Your active Google-authenticated session authorizes this change. Email verification will be added when system email is enabled.</p>}`,
  `                {!hasPassword && (\n                  <div className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-800">\n                    Set a ConferenceGate password first. Email changes require password confirmation so an existing browser session alone cannot change your account identity.\n                  </div>\n                )}`
);

source = source.replace(
  `                <button disabled={savingEmail} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60">\n                  {savingEmail ? 'Saving…' : 'Save Email'}\n                </button>`,
  `                <button disabled={savingEmail || !hasPassword} className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-60">\n                  {savingEmail ? 'Saving…' : hasPassword ? 'Save Email' : 'Set Password First'}\n                </button>`
);

fs.writeFileSync(file, source);
console.log('[account-email-reauth] secure email-change UX applied');
