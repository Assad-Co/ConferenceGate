import React, { useState } from 'react';
import { Navbar as LegacyNavbar } from './LegacyNavbar';
import { OrganizationDirectoryModal } from './OrganizationDirectoryModal';

type NavbarProps = React.ComponentProps<typeof LegacyNavbar>;

export const Navbar: React.FC<NavbarProps> = (props) => {
  const [organizationDirectoryOpen, setOrganizationDirectoryOpen] = useState(false);

  return (
    <>
      <LegacyNavbar
        {...props}
        onOpenOrganizationDirectory={() => setOrganizationDirectoryOpen(true)}
      />
      {organizationDirectoryOpen && (
        <OrganizationDirectoryModal onClose={() => setOrganizationDirectoryOpen(false)} />
      )}
    </>
  );
};
