import React from 'react';

interface LogoProps {
  className?: string;
}

/** The official Conference Gate logo image, used unmodified everywhere. */
export const Logo: React.FC<LogoProps> = ({ className = 'h-9 w-auto' }) => (
  <img src="/conference-gate-logo.png" alt="Conference Gate" className={className} />
);

export default Logo;
