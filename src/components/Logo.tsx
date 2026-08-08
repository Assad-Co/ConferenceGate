import React from 'react';

interface LogoProps {
  className?: string;
}

const DARK = '#1651c9';
const LIGHT = '#3bb0f0';

/**
 * The Conference Gate logo, rendered as inline SVG so it stays perfectly
 * crisp at any size or display density instead of scaling a raster file.
 */
export const Logo: React.FC<LogoProps> = ({ className = 'h-9 w-auto' }) => (
  <svg viewBox="0 0 600 200" className={className} role="img" aria-label="Conference Gate">
    {/* Ring */}
    <circle
      cx="96"
      cy="100"
      r="76"
      fill="none"
      stroke={DARK}
      strokeWidth="11"
      strokeLinecap="round"
      strokeDasharray="300 178"
      strokeDashoffset="-14"
      transform="rotate(-132 96 100)"
    />
    <circle
      cx="96"
      cy="100"
      r="76"
      fill="none"
      stroke={LIGHT}
      strokeWidth="11"
      strokeLinecap="round"
      strokeDasharray="118 360"
      strokeDashoffset="-316"
      transform="rotate(-132 96 100)"
    />
    <path d="M158 44 L176 51 L163 66 Z" fill={LIGHT} />

    {/* Globe */}
    <circle cx="96" cy="100" r="52" fill={LIGHT} />
    <g stroke="white" strokeWidth="2" fill="none" opacity="0.65">
      <ellipse cx="96" cy="100" rx="52" ry="20" />
      <ellipse cx="96" cy="100" rx="24" ry="52" />
      <line x1="44" y1="100" x2="148" y2="100" />
    </g>

    {/* Podium + speaker + audience */}
    <circle cx="96" cy="66" r="11" fill={DARK} />
    <path d="M78 122 L114 122 L107 92 L85 92 Z" fill={DARK} />
    <line x1="96" y1="78" x2="96" y2="92" stroke={DARK} strokeWidth="3" />
    <circle cx="68" cy="118" r="8" fill={DARK} />
    <path d="M58 142 c0 -11 8 -18 20 -18" fill="none" stroke={DARK} strokeWidth="9" strokeLinecap="round" />
    <circle cx="96" cy="124" r="8.5" fill={DARK} />
    <path d="M82 148 c0 -11 8.5 -18.5 22 -18.5 s22 7.5 22 18.5" fill="none" stroke={DARK} strokeWidth="9" strokeLinecap="round" />
    <circle cx="124" cy="118" r="8" fill={DARK} />
    <path d="M134 142 c0 -11 -8 -18 -20 -18" fill="none" stroke={DARK} strokeWidth="9" strokeLinecap="round" />

    {/* Wordmark */}
    <text
      x="192"
      y="86"
      fontFamily="Arial, Helvetica, sans-serif"
      fontWeight="700"
      fontSize="46"
      letterSpacing="2"
      fill={DARK}
    >
      CONFERENCE
    </text>
    <text
      x="192"
      y="150"
      fontFamily="Arial, Helvetica, sans-serif"
      fontWeight="700"
      fontSize="58"
      letterSpacing="2"
      fill={LIGHT}
    >
      G
    </text>
    <path
      d="M291 152 L291 130 L307 110 L323 130 L323 152"
      fill="none"
      stroke={DARK}
      strokeWidth="9"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <text
      x="333"
      y="150"
      fontFamily="Arial, Helvetica, sans-serif"
      fontWeight="700"
      fontSize="58"
      letterSpacing="2"
      fill={LIGHT}
    >
      TE
    </text>
  </svg>
);

export default Logo;
