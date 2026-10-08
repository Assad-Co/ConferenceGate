import React, { useState } from 'react';
import { Building2 } from 'lucide-react';
import { Navbar as LegacyNavbar } from './LegacyNavbar';
import { OrganizationDirectoryModal } from './OrganizationDirectoryModal';

type NavbarProps = React.ComponentProps<typeof LegacyNavbar>;

export const Navbar: React.FC<NavbarProps> = (props) => {
  const [organizationDirectoryOpen, setOrganizationDirectoryOpen] = useState(false);

  return (
    <>
      <LegacyNavbar {...props} />
      <button
        type="button"
        onClick={() => setOrganizationDirectoryOpen(true)}
        className="fixed bottom-5 right-5 z-30 inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3.5 py-2.5 text-xs font-bold text-blue-900 shadow-lg hover:bg-blue-50 cursor-pointer"
        title="Organization Directory & Reputation"
      >
        <Building2 className="h-4 w-4" />
        <span className="hidden sm:inline">Organizations</span>
      </button>
      {organizationDirectoryOpen && (
        <OrganizationDirectoryModal onClose={() => setOrganizationDirectoryOpen(false)} />
      )}
    </>
  );
};
