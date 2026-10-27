/** Keep acceptance fixtures and unusable blank-title records out of the public catalogue without deleting data. */
export function isPublicConference(conference: { title?: unknown; description?: unknown }): boolean {
  const title = typeof conference.title === 'string' ? conference.title.trim().toLowerCase() : '';
  const description = typeof conference.description === 'string' ? conference.description.toLowerCase() : '';
  if (!title) return false;
  return !title.includes('synthetic launch acceptance') &&
    !(title.includes('test only') && description.includes('automated acceptance'));
}
