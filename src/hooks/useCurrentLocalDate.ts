import { useEffect, useState } from 'react';

function localIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the viewer's current local calendar date and refreshes it while the page stays open.
 * Conference attendance eligibility is a calendar rule, so using local date avoids an event
 * appearing a day early/late around UTC midnight.
 */
export function useCurrentLocalDate(): string {
  const [today, setToday] = useState(localIsoDate);

  useEffect(() => {
    const refresh = () => {
      const next = localIsoDate();
      setToday((current) => (current === next ? current : next));
    };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  return today;
}
