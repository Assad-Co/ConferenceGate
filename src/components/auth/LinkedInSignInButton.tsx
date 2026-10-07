import React from 'react';
import { Linkedin } from 'lucide-react';

interface LinkedInSignInButtonProps {
  text?: 'signin_with' | 'signup_with';
  onUnavailable?: () => void;
}

// Start ConferenceGate's LinkedIn OpenID Connect flow. LinkedIn authenticates identity only.
// After a successful link/sign-in ConferenceGate can match that identity to public professional
// evidence such as publications, conference roles and public bios. Private LinkedIn data is not
// accessed and the transient OAuth access token is not stored.
export const LinkedInSignInButton: React.FC<LinkedInSignInButtonProps> = ({ text = 'signin_with', onUnavailable }) => {
  const handleClick = () => {
    try {
      window.location.assign('/api/auth/linkedin/start');
    } catch {
      onUnavailable?.();
    }
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleClick}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 text-sm font-bold rounded-full transition-colors cursor-pointer"
      >
        <Linkedin className="w-4 h-4 text-[#0A66C2]" />
        {text === 'signup_with' ? 'Sign up with LinkedIn' : 'Sign in with LinkedIn'}
      </button>
      <p className="mt-2 px-2 text-center text-[10px] leading-relaxed text-slate-400">
        LinkedIn verifies your identity. ConferenceGate may then match it to public professional evidence such as publications, conference roles and public bios. Private LinkedIn data is not accessed.
      </p>
    </div>
  );
};

export default LinkedInSignInButton;
