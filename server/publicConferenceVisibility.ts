/** Keep explicitly labeled acceptance fixtures out of the public catalogue without deleting data. */
export function isPublicConference(conference: { title?: unknown; description?: unknown }): boolean {
  const title = String(conference.title ?? '').toLowerCase();
  const description = String(conference.description ?? '').toLowerCase();
  return !title.includes('synthetic launch acceptance') &&
    !(title.includes('test only') && description.includes('automated acceptance'));
}
