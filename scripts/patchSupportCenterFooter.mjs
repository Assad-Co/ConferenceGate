import fs from 'fs';

function replaceOnce(path, from, to, label) {
  const source = fs.readFileSync(path, 'utf8');
  if (source.includes(to)) return false;
  if (!source.includes(from)) throw new Error(`[support-center] could not find ${label} in ${path}`);
  fs.writeFileSync(path, source.replace(from, to));
  return true;
}

// Footer: add a compact Support column.
replaceOnce(
  'src/components/Footer.tsx',
  '        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">',
  '        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">',
  'footer grid',
);

replaceOnce(
  'src/components/Footer.tsx',
  `          {role === 'professional' && (`,
  `          <div>\n            <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4">Support</h4>\n            <ul className="space-y-2 text-xs">\n              <li><button onClick={() => onNavigateTab('faq')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">FAQ</button></li>\n              <li><button onClick={() => onNavigateTab('contact')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Ask Us</button></li>\n              <li><button onClick={() => onNavigateTab('privacy')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Privacy Policy</button></li>\n              <li><button onClick={() => onNavigateTab('terms')} className="hover:text-blue-600 transition-colors cursor-pointer text-left">Terms of Use</button></li>\n            </ul>\n          </div>\n\n          {role === 'professional' && (`,
  'support footer column',
);

// App routing: import SupportCenter and render the four pages.
replaceOnce(
  'src/App.tsx',
  `import { Footer } from './components/Footer';`,
  `import { Footer } from './components/Footer';\nimport { SupportCenter } from './components/SupportCenter';`,
  'support import',
);

replaceOnce(
  'src/App.tsx',
  `        {activeTab === 'certificates' && (\n          <CertificatesView`,
  `        {(['faq', 'contact', 'privacy', 'terms'] as const).includes(activeTab as any) && (\n          <SupportCenter\n            page={activeTab as 'faq' | 'contact' | 'privacy' | 'terms'}\n            accountEmail={authUser.email}\n            onBack={() => setActiveTab('home')}\n          />\n        )}\n\n        {activeTab === 'certificates' && (\n          <CertificatesView`,
  'support route',
);

console.log('[support-center] FAQ, Ask Us, Privacy, Terms and footer links applied');
