import fs from 'node:fs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('server/auth.ts', (source) => {
  if (!source.includes('authRouter.get("/me/account"')) {
    const anchor = 'authRouter.get("/me", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {';
    const insert = `authRouter.get("/me/account", requireAuth, asyncHandler(async (req: AuthedRequest, res) => {\n  const row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]);\n  if (!row) return res.status(401).json({ error: "Not authenticated" });\n  res.json({\n    email: row.email,\n    hasPassword: Boolean(row.password_hash),\n    googleConnected: Boolean(row.google_id),\n  });\n}));\n\nauthRouter.patch("/me/email", requireAuth, authRateLimit, asyncHandler(async (req: AuthedRequest, res) => {\n  const row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]);\n  if (!row) return res.status(401).json({ error: "Not authenticated" });\n  if (isOwnerPreviewEmail(row.email)) {\n    return res.status(403).json({ error: "Owner account email changes are protected to prevent loss of owner access." });\n  }\n  const newEmail = typeof req.body?.newEmail === "string" ? req.body.newEmail.trim().toLowerCase() : "";\n  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";\n  if (!EMAIL_RE.test(newEmail)) return res.status(400).json({ error: "A valid new email is required." });\n  if (newEmail === row.email.toLowerCase()) return res.status(400).json({ error: "That is already your account email." });\n  const existing = await dbGet<{ id: string }>("SELECT id FROM users WHERE email = ?", [newEmail]);\n  if (existing && existing.id !== row.id) return res.status(409).json({ error: "An account with this email already exists." });\n  if (!row.password_hash) {\n    return res.status(403).json({ error: "Set a ConferenceGate password first, then use it to confirm an email change." });\n  }\n  if (!currentPassword || !bcrypt.compareSync(currentPassword, row.password_hash)) {\n    return res.status(401).json({ error: "Current password is incorrect." });\n  }\n  await dbRun("UPDATE users SET email = ? WHERE id = ?", [newEmail, row.id]);\n  res.json({ email: newEmail });\n}));\n\nauthRouter.patch("/me/password", requireAuth, authRateLimit, asyncHandler(async (req: AuthedRequest, res) => {\n  const row = await dbGet<UserRow>("SELECT * FROM users WHERE id = ?", [req.userId]);\n  if (!row) return res.status(401).json({ error: "Not authenticated" });\n  const currentPassword = typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";\n  const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";\n  if (newPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });\n  if (row.password_hash && (!currentPassword || !bcrypt.compareSync(currentPassword, row.password_hash))) {\n    return res.status(401).json({ error: "Current password is incorrect." });\n  }\n  if (!row.password_hash && !row.google_id && !row.linkedin_id) {\n    return res.status(403).json({ error: "A connected sign-in method is required before setting a password." });\n  }\n  const passwordHash = bcrypt.hashSync(newPassword, 10);\n  await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, row.id]);\n  res.json({ ok: true, hasPassword: true });\n}));\n\n`;
    if (!source.includes(anchor)) throw new Error('Account settings patch: /me anchor not found');
    source = source.replace(anchor, insert + anchor);
  }
  return source;
});

patchFile('src/api/auth.ts', (source) => {
  if (!source.includes('export interface AccountSettingsInfo')) {
    const anchor = 'export interface ProfileUpdatePayload {';
    const insert = `export interface AccountSettingsInfo {\n  email: string;\n  hasPassword: boolean;\n  googleConnected: boolean;\n}\n\n`;
    if (!source.includes(anchor)) throw new Error('Account settings patch: api type anchor not found');
    source = source.replace(anchor, insert + anchor);
  }
  if (!source.includes('export async function fetchAccountSettings')) {
    const anchor = 'export async function updateProfile(payload: ProfileUpdatePayload): Promise<AuthUser> {';
    const insert = `export async function fetchAccountSettings(): Promise<AccountSettingsInfo> {\n  const res = await fetch('/api/auth/me/account', { credentials: 'include' });\n  return parseResponse(res);\n}\n\nexport async function updateAccountEmail(payload: { newEmail: string; currentPassword?: string }): Promise<{ email: string }> {\n  const res = await fetch('/api/auth/me/email', {\n    method: 'PATCH',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify(payload),\n  });\n  return parseResponse(res);\n}\n\nexport async function updateAccountPassword(payload: { currentPassword?: string; newPassword: string }): Promise<{ ok: boolean; hasPassword: boolean }> {\n  const res = await fetch('/api/auth/me/password', {\n    method: 'PATCH',\n    headers: { 'Content-Type': 'application/json' },\n    credentials: 'include',\n    body: JSON.stringify(payload),\n  });\n  return parseResponse(res);\n}\n\n`;
    if (!source.includes(anchor)) throw new Error('Account settings patch: api function anchor not found');
    source = source.replace(anchor, insert + anchor);
  }
  return source;
});

patchFile('src/components/UserProfileView.tsx', (source) => {
  if (!source.includes("import { AccountSettingsModal } from './AccountSettingsModal';")) {
    const anchor = "import { ProfessionalPreferencesModal } from './ProfessionalPreferencesModal';";
    source = source.replace(anchor, anchor + "\nimport { AccountSettingsModal } from './AccountSettingsModal';");
  }
  if (!source.includes('  Settings,')) {
    source = source.replace('  RefreshCw,\n', '  RefreshCw,\n  Settings,\n');
  }
  if (!source.includes('const [isAccountSettingsOpen, setIsAccountSettingsOpen]')) {
    source = source.replace(
      '  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);',
      '  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);\n  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false);'
    );
  }
  if (!source.includes('<span>Account Settings</span>')) {
    const anchor = `            {variant === 'professional' && onEditProfessionalPreferences && (`;
    const button = `            {currentUserEmail && (\n              <button\n                onClick={() => setIsAccountSettingsOpen(true)}\n                className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs rounded-xl shadow-xs border border-slate-200 transition-colors cursor-pointer flex items-center gap-2"\n              >\n                <Settings className="w-4 h-4" />\n                <span>Account Settings</span>\n              </button>\n            )}\n`;
    if (!source.includes(anchor)) throw new Error('Account settings patch: profile button anchor not found');
    source = source.replace(anchor, button + anchor);
  }
  if (!source.includes('<AccountSettingsModal')) {
    const anchor = '      {onEditProfile && (';
    const modal = `      <AccountSettingsModal\n        isOpen={isAccountSettingsOpen}\n        onClose={() => setIsAccountSettingsOpen(false)}\n        currentEmail={currentUserEmail || ''}\n        ownerPreview={ownerPreview}\n      />\n\n`;
    if (!source.includes(anchor)) throw new Error('Account settings patch: modal conditional anchor not found');
    source = source.replace(anchor, modal + anchor);
  }
  return source;
});

console.log('[patchAccountSettings] Account settings API, modal wiring, and profile button ensured.');
