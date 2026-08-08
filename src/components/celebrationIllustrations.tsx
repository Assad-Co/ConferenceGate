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

export const AbstractAcceptedIllustration: React.FC = () => (
  <svg viewBox="0 0 160 96" className="w-32 h-auto">
    <Confetti color="#3b82f6" alt="#60a5fa" />
    <rect x="28" y="22" width="96" height="56" rx="8" fill="#eff6ff" stroke="#93c5fd" strokeWidth="1.5" />
    <line x1="52" y1="22" x2="52" y2="78" stroke="#93c5fd" strokeWidth="1.5" strokeDasharray="3 3" />
    <circle cx="40" cy="34" r="2.5" fill="#93c5fd" />
    <rect x="64" y="34" width="48" height="4" rx="2" fill="#bfdbfe" />
    <rect x="64" y="44" width="40" height="4" rx="2" fill="#bfdbfe" />
    <rect x="64" y="54" width="44" height="4" rx="2" fill="#bfdbfe" />
    <rect x="64" y="64" width="30" height="4" rx="2" fill="#bfdbfe" />
    <circle cx="118" cy="26" r="16" fill="#2563eb" stroke="white" strokeWidth="3" />
    <path d="M110 26.5 L116 32 L127 19" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ReviewerMilestoneIllustration: React.FC = () => (
  <svg viewBox="0 0 160 96" className="w-32 h-auto">
    <Confetti color="#8b5cf6" alt="#c4b5fd" />
    <rect x="42" y="18" width="66" height="72" rx="7" fill="#f5f3ff" stroke="#c4b5fd" strokeWidth="1.5" />
    <rect x="60" y="10" width="30" height="14" rx="4" fill="#7c3aed" />
    <g fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="55" cy="38" r="4.5" />
      <path d="M53 38 L54.5 39.5 L57.5 36" />
    </g>
    <rect x="65" y="35" width="34" height="4" rx="2" fill="#ddd6fe" />
    <g fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="55" cy="54" r="4.5" />
      <path d="M53 54 L54.5 55.5 L57.5 52" />
    </g>
    <rect x="65" y="51" width="34" height="4" rx="2" fill="#ddd6fe" />
    <g fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="55" cy="70" r="4.5" />
      <path d="M53 70 L54.5 71.5 L57.5 68" />
    </g>
    <rect x="65" y="67" width="24" height="4" rx="2" fill="#ddd6fe" />
    <circle cx="120" cy="66" r="20" fill="#6d28d9" stroke="white" strokeWidth="3" />
    <path d="M110 66 L117 73 L131 57" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CommitteeAppointmentIllustration: React.FC = () => {
  const leaves = [-50, -30, -10, 10, 30, 50];
  return (
    <svg viewBox="0 0 160 96" className="w-32 h-auto">
      <Confetti color="#14b8a6" alt="#5eead4" />
      {leaves.map((deg) => (
        <ellipse
          key={`l-${deg}`}
          cx="80"
          cy="34"
          rx="6"
          ry="12"
          fill="#0d9488"
          opacity="0.85"
          transform={`rotate(${deg} 80 78) translate(0 -34)`}
        />
      ))}
      <circle cx="80" cy="50" r="24" fill="#14b8a6" stroke="white" strokeWidth="3" />
      <path d="M69 41 h22 v8 h-8 v13 h-6 v-13 h-8 z" fill="white" />
    </svg>
  );
};

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

export const AchievementIllustration: React.FC = () => {
  const petals = Array.from({ length: 12 }, (_, i) => i * 30);
  return (
    <svg viewBox="0 0 160 96" className="w-32 h-auto">
      <Confetti color="#0ea5e9" alt="#7dd3fc" />
      <g transform="translate(80 46)">
        {petals.map((deg) => (
          <circle key={deg} cx="0" cy="-26" r="8" fill="#38bdf8" opacity="0.85" transform={`rotate(${deg})`} />
        ))}
        <circle cx="0" cy="0" r="21" fill="#0284c7" stroke="white" strokeWidth="3" />
        <path
          d="M0 -10 L2.9 -3.5 L10 -3 L4.5 2 L6 9 L0 5 L-6 9 L-4.5 2 L-10 -3 L-2.9 -3.5 Z"
          fill="white"
        />
      </g>
    </svg>
  );
};
