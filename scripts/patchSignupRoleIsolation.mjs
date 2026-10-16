import fs from 'node:fs';
import './patchKudosProfile.mjs';

function patchFile(path, patcher) {
  const before = fs.readFileSync(path, 'utf8');
  const after = patcher(before);
  if (after !== before) fs.writeFileSync(path, after);
}

patchFile('src/App.tsx', (source) => {
  const oldHandler = `  const handleRoleChange = (role: UserRole) => {\n    setActiveRole(role);\n    if (role === 'Organizer') setActiveTab('organizer');\n    else if (role === 'Reviewer') setActiveTab('reviewer');\n    else if (role === 'Sponsor') setActiveTab('sponsor');\n    else if (role === 'Professional') setActiveTab('discover');`;
  const newHandler = `  const handleRoleChange = (role: UserRole) => {\n    // The role chosen at signup is the account boundary. Only the owner-preview account may\n    // switch between top-level roles for internal QA. Reviewer remains a Professional sub-feature.\n    if (authUser && !authUser.ownerPreview) {\n      const accountRole = AUTH_ROLE_TO_USER_ROLE[authUser.role];\n      const allowed = authUser.role === 'professional'\n        ? role === 'Professional' || role === 'Reviewer'\n        : role === accountRole;\n      if (!allowed) {\n        setActiveRole(accountRole);\n        setActiveTab(authUser.role === 'organizer' ? 'organizer' : authUser.role === 'sponsor' ? 'sponsor' : 'home');\n        return;\n      }\n    }\n    setActiveRole(role);\n    if (role === 'Organizer') setActiveTab('organizer');\n    else if (role === 'Reviewer') setActiveTab('reviewer');\n    else if (role === 'Sponsor') setActiveTab('sponsor');\n    else if (role === 'Professional') setActiveTab('discover');`;
  if (!source.includes('The role chosen at signup is the account boundary')) {
    if (!source.includes(oldHandler)) throw new Error('[role-isolation] App role handler anchor not found');
    source = source.replace(oldHandler, newHandler);
  }
  return source;
});

patchFile('src/components/LegacyNavbar.tsx', (source) => {
  if (!source.includes('const accountRoleLabel =')) {
    source = source.replace(
      "  const role = (activeRole || currentRole || 'Professional').toLowerCase();",
      "  const role = (activeRole || currentRole || 'Professional').toLowerCase();\n  const accountRoleLabel = ownerPreview ? role : (accountRole || role);"
    );
  }

  source = source.replace(
    '                onClick={toggleRoleMenu}',
    '                onClick={ownerPreview ? toggleRoleMenu : undefined}'
  );
  source = source.replace(
    '                <span className="hidden md:inline capitalize text-blue-700 font-bold">{role}</span>',
    '                <span className="hidden md:inline capitalize text-blue-700 font-bold">{accountRoleLabel}</span>'
  );
  source = source.replace(
    '                <span className="md:hidden uppercase text-blue-700 font-bold">{role.charAt(0)}</span>',
    '                <span className="md:hidden uppercase text-blue-700 font-bold">{accountRoleLabel.charAt(0)}</span>'
  );
  source = source.replace(
    '                <ChevronDown className="w-3 h-3 md:w-3.5 md:h-3.5 text-slate-400" />',
    '                {ownerPreview && <ChevronDown className="w-3 h-3 md:w-3.5 md:h-3.5 text-slate-400" />}'
  );
  source = source.replace(
    '              {roleMenuOpen && roleMenuPos && (',
    '              {ownerPreview && roleMenuOpen && roleMenuPos && ('
  );
  return source;
});

console.log('[role-isolation] signup role locked; owner preview remains multi-role');
