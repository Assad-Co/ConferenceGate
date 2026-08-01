import React from 'react';

/**
 * Icon mark: a broken circular "gate" ring (two-tone blue) wrapping a globe
 * with a delegate silhouette seated in a network "hub" base — the visual
 * shorthand for "gateway to conferences".
 */
export const LogoMark: React.FC<{ size?: number; className?: string }> = ({
  size = 40,
  className = '',
}) => {
  const clipId = React.useId();
  return (
  <svg
    viewBox="0 0 120 120"
    width={size}
    height={size}
    className={className}
    aria-hidden="true"
  >
    {/* Outer gate ring — dark blue, ~290° sweep */}
    <path
      d="M 69 111.2 A 52 52 0 1 1 111.2 69"
      fill="none"
      stroke="#1e40af"
      strokeWidth="10"
      strokeLinecap="round"
    />
    {/* Gate ring accent — light blue segment closing part of the gap */}
    <path
      d="M 108.2 79.5 A 52 52 0 0 1 79.5 108.2"
      fill="none"
      stroke="#60a5fa"
      strokeWidth="10"
      strokeLinecap="round"
    />

    {/* Globe */}
    <circle cx="60" cy="60" r="34" fill="#1e3a8a" />
    <clipPath id={clipId}>
      <circle cx="60" cy="60" r="34" />
    </clipPath>
    <g clipPath={`url(#${clipId})`} stroke="#93c5fd" strokeWidth="1.5" fill="none" opacity="0.55">
      <ellipse cx="60" cy="60" rx="34" ry="12" />
      <ellipse cx="60" cy="60" rx="12" ry="34" />
      <line x1="26" y1="60" x2="94" y2="60" />
    </g>

    {/* Delegate silhouette */}
    <circle cx="60" cy="52" r="7" fill="#ffffff" />
    <path
      d="M 47 79 Q 47 62 60 62 Q 73 62 73 79 Z"
      fill="#ffffff"
    />

    {/* Network / audience base */}
    <path
      d="M 32 96 Q 60 114 88 96"
      fill="none"
      stroke="#60a5fa"
      strokeWidth="6"
      strokeLinecap="round"
    />
    <circle cx="32" cy="96" r="4.5" fill="#bfdbfe" />
    <circle cx="60" cy="107" r="4.5" fill="#bfdbfe" />
    <circle cx="88" cy="96" r="4.5" fill="#bfdbfe" />
  </svg>
  );
};

/** Replaces the "A" in GATE with a roof/gateway pictogram, per brand mark. */
export const GateGlyph: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
    <path d="M50 6 L94 58 H74 L50 30 L26 58 H6 Z" fill="currentColor" />
    <rect x="22" y="58" width="15" height="38" fill="currentColor" />
    <rect x="63" y="58" width="15" height="38" fill="currentColor" />
  </svg>
);

interface LogoProps {
  size?: number;
  showText?: boolean;
  theme?: 'light' | 'dark';
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  size = 40,
  showText = true,
  theme = 'light',
  className = '',
}) => {
  const primaryTextColor = theme === 'dark' ? 'text-white' : 'text-slate-900';
  const accentTextColor = theme === 'dark' ? 'text-sky-300' : 'text-blue-500';

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark size={size} className="shrink-0 drop-shadow-sm" />
      {showText && (
        <div className="leading-none">
          <div className={`font-extrabold tracking-tight text-[15px] ${primaryTextColor}`}>
            CONFERENCE
          </div>
          <div className={`flex items-center font-extrabold tracking-tight text-xl ${accentTextColor}`}>
            G
            <GateGlyph className="inline-block w-[0.72em] h-[0.72em] mx-[0.02em] -translate-y-[0.02em]" />
            TE
          </div>
        </div>
      )}
    </div>
  );
};

export default Logo;
