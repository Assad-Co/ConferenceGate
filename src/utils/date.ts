const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const parseIsoDate = (iso: string): { year: number; month: number; day: number } => {
  const [year, month, day] = iso.split('-').map(Number);
  return { year, month, day };
};

/** "2026-06-25" -> "Jun 25, 2026" */
export const formatDate = (iso: string): string => {
  const { year, month, day } = parseIsoDate(iso);
  return `${MONTHS_SHORT[month - 1]} ${day}, ${year}`;
};

/** "2026-06-25" -> "JUN" */
export const formatMonthShort = (iso: string): string => MONTHS_SHORT[parseIsoDate(iso).month - 1].toUpperCase();

/** "2026-06-25" -> 25 */
export const formatDay = (iso: string): number => parseIsoDate(iso).day;

/**
 * Human-friendly date range for conference announcements.
 * Same month/year: "Jun 25 – 28, 2026"
 * Same year, diff month: "Jun 25 – Jul 2, 2026"
 * Diff year: "Dec 30, 2025 – Jan 2, 2026"
 */
export const formatDateRange = (startIso: string, endIso: string): string => {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);

  if (startIso === endIso) return formatDate(startIso);

  if (start.year === end.year && start.month === end.month) {
    return `${MONTHS_SHORT[start.month - 1]} ${start.day} – ${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    return `${MONTHS_SHORT[start.month - 1]} ${start.day} – ${MONTHS_SHORT[end.month - 1]} ${end.day}, ${start.year}`;
  }
  return `${formatDate(startIso)} – ${formatDate(endIso)}`;
};

/** Inclusive day count between two ISO dates. */
export const conferenceDurationDays = (startIso: string, endIso: string): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diff = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / msPerDay);
  return diff + 1;
};
