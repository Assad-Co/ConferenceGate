import React from 'react';

export const KudosRibbon: React.FC<{ color: string; dark: string }> = ({ color, dark }) => (
  <svg viewBox="0 0 160 44" className="w-40 h-auto" role="img" aria-label="Kudos">
    <path d="M6 8 L20 22 L6 36 L20 22 Z" fill={dark} />
    <path d="M154 8 L140 22 L154 36 L140 22 Z" fill={dark} />
    <rect x="16" y="6" width="128" height="32" rx="4" fill={color} />
    <text
      x="80"
      y="28"
      textAnchor="middle"
      fontFamily="Georgia, 'Times New Roman', serif"
      fontStyle="italic"
      fontWeight="700"
      fontSize="19"
      fill="rgba(0,0,0,0.15)"
    >
      Kudos!
    </text>
    <text
      x="80"
      y="27"
      textAnchor="middle"
      fontFamily="Georgia, 'Times New Roman', serif"
      fontStyle="italic"
      fontWeight="700"
      fontSize="19"
      fill="#ffffff"
    >
      Kudos!
    </text>
  </svg>
);

const Confetti: React.FC<{ color: string; alt?: string }> = ({ color, alt = '#f59e0b' }) => (
  <>
    <rect x="14" y="10" width="5" height="9" rx="1.5" fill={color} opacity="0.8" transform="rotate(20 16 14)" />
    <rect x="140" y="16" width="5" height="9" rx="1.5" fill={alt} opacity="0.8" transform="rotate(-18 142 20)" />
    <circle cx="148" cy="52" r="3" fill={color} opacity="0.7" />
    <circle cx="10" cy="58" r="2.5" fill={alt} opacity="0.7" />
    <rect x="128" y="72" width="5" height="9" rx="1.5" fill={color} opacity="0.7" transform="rotate(30 130 76)" />
  </>
);

export const SponsorshipAcceptedIllustration: React.FC = () => (
  <svg viewBox="0 0 160 96" className="w-32 h-auto">
    <Confetti color="#10b981" alt="#6ee7b7" />
    <rect x="46" y="42" width="68" height="42" rx="7" fill="#10b981" />
    <rect x="66" y="30" width="28" height="16" rx="5" fill="none" stroke="#10b981" strokeWidth="4" />
    <rect x="46" y="56" width="68" height="8" fill="#059669" />
    <circle cx="80" cy="60" r="5" fill="#a7f3d0" />
    <circle cx="118" cy="30" r="15" fill="#f59e0b" stroke="white" strokeWidth="3" />
    <path
      d="M118 21 L120.4 27 L127 27.6 L122 31.8 L123.6 38.2 L118 34.6 L112.4 38.2 L114 31.8 L109 27.6 L115.6 27 Z"
      fill="white"
    />
  </svg>
);

export const BestOrganizerIllustration: React.FC = () => {
  const leaves = [-55, -35, -15, 15, 35, 55];
  return (
    <svg viewBox="0 0 160 96" className="w-32 h-auto">
      <Confetti color="#f59e0b" alt="#fcd34d" />
      {leaves.map((deg) => (
        <ellipse
          key={`l-${deg}`}
          cx="80"
          cy="34"
          rx="6"
          ry="11"
          fill="#d97706"
          opacity="0.85"
          transform={`rotate(${deg} 80 80) translate(0 -32)`}
        />
      ))}
      <path
        d="M58 24 h44 v10 c0 14 -10 22 -22 22 s-22 -8 -22 -22 z"
        fill="#f59e0b"
        stroke="white"
        strokeWidth="2.5"
      />
      <path d="M58 26 c-10 0 -14 6 -14 12 s6 10 14 10" fill="none" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
      <path d="M102 26 c10 0 14 6 14 12 s-6 10 -14 10" fill="none" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
      <rect x="76" y="55" width="8" height="10" fill="#d97706" />
      <rect x="66" y="65" width="28" height="7" rx="2" fill="#d97706" />
      <path d="M52 20 l3 3 M108 20 l-3 3 M80 12 v5" stroke="#fcd34d" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
};
