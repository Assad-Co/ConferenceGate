import fs from 'node:fs';

// Run after legacy patches so labels are associated with the final generated form controls.
for (const [file, prefix] of [
  ['src/components/auth/AuthScreen.tsx', 'auth'],
  ['src/components/EditProfileModal.tsx', 'profile'],
  ['src/components/ProfessionalPreferencesModal.tsx', 'preferences'],
]) {
  let source = fs.readFileSync(file, 'utf8');
  let index = 0;
  source = source.replace(/<label(?![^>]*htmlFor)([^>]*)>([\s\S]*?)<\/label>((?:(?!<label)[\s\S])*?)<(input|textarea)\b/g,
    (_match, attributes, label, gap, tag) => {
      const id = `cg-${prefix}-${index++}`;
      return `<label htmlFor="${id}"${attributes}>${label}</label>${gap}<${tag} id="${id}"`;
    });
  if (prefix !== 'auth') {
    if (!source.includes("import { useAccessibleDialog }")) {
      source = "import { useAccessibleDialog } from '../hooks/useAccessibleDialog';\n" + source;
      source = source.replace('  if (!isOpen) return null;', '  const dialogRef = useAccessibleDialog(isOpen, onClose);\n  if (!isOpen) return null;');
      source = source.replace('<div className="fixed inset-0', `<div ref={dialogRef} role="dialog" aria-modal="true" aria-label="${prefix === 'profile' ? 'Edit Profile' : 'Professional Matching Profile'}" tabIndex={-1} className="fixed inset-0`);
    }
    source = source.replace('<button onClick={onClose}', '<button aria-label="Close dialog" type="button" onClick={onClose}');
  }
  fs.writeFileSync(file, source);
}

// Keep all navigation actions reachable with adequately sized touch targets on narrow screens.
const file = 'src/components/LegacyNavbar.tsx';
let nav = fs.readFileSync(file, 'utf8');
nav = nav.replace('flex items-center h-14 min-w-0 overflow-hidden', 'flex flex-wrap md:flex-nowrap items-center min-h-14 min-w-0');
nav = nav.replace('flex flex-1 min-w-0 items-center justify-center gap-0 sm:gap-0.5 md:gap-1 h-14', 'order-3 md:order-none w-full md:w-auto flex md:flex-1 min-w-0 items-center justify-around sm:justify-center gap-0 sm:gap-0.5 md:gap-1 h-14');
nav = nav.replace('min-w-[28px] sm:min-w-[34px]', 'min-w-[44px] sm:min-w-[44px]');
nav = nav.replace('flex items-center gap-0.5 sm:gap-1 md:gap-1.5 shrink-0', 'ml-auto flex items-center gap-0.5 sm:gap-1 md:gap-1.5 shrink-0');
if (!nav.includes('aria-controls="cg-account-menu"')) nav = nav.replace('ref={roleTriggerRef}', 'ref={roleTriggerRef} aria-label="Account menu" aria-expanded={roleMenuOpen} aria-controls="cg-account-menu"');
if (!nav.includes('id="cg-account-menu"')) nav = nav.replace('ref={roleMenuRef}', 'ref={roleMenuRef} id="cg-account-menu"');
nav = nav.replace('className="flex items-center gap-0.5 px-1', 'className="min-h-11 min-w-11 flex items-center justify-center gap-0.5 px-1');
nav = nav.replaceAll('className="p-1 sm:p-1.5 md:p-2 text-slate-600', 'className="min-h-11 min-w-11 flex items-center justify-center p-1 sm:p-1.5 md:p-2 text-slate-600');
nav = nav.replace('className="flex items-center gap-2 cursor-pointer"', 'className="min-h-11 min-w-11 flex items-center justify-center gap-2 cursor-pointer"');
fs.writeFileSync(file, nav);
console.log('[launch-accessibility] final form labels, modal focus and mobile navigation applied');

const discoveryFile = 'src/components/DiscoveryEngineAdvanced.tsx';
let discovery = fs.readFileSync(discoveryFile, 'utf8');
discovery = discovery.replace('{displayedStored.length} match{displayedStored.length', '{allStored.length} match{allStored.length');
fs.writeFileSync(discoveryFile, discovery);
