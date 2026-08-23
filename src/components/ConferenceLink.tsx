import React from 'react';
import { Conference } from '../types';

interface ConferenceLinkProps {
  conferences: Conference[];
  conferenceId: string;
  conferenceTitle: string;
  onSelectConference: (conf: Conference) => void;
  className?: string;
}

/**
 * A conference name shown as plain text, wherever we have enough real data to actually take the
 * reader to that conference's page. Falls back to plain text if the conference can't be found
 * (e.g. it was removed) rather than linking somewhere broken.
 */
export const ConferenceLink: React.FC<ConferenceLinkProps> = ({
  conferences,
  conferenceId,
  conferenceTitle,
  onSelectConference,
  className = '',
}) => {
  const conference = conferences.find((c) => c.id === conferenceId);
  if (!conference) {
    return <span className={className}>{conferenceTitle}</span>;
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onSelectConference(conference);
      }}
      className={`hover:text-blue-600 hover:underline cursor-pointer text-left ${className}`}
    >
      {conferenceTitle}
    </button>
  );
};
