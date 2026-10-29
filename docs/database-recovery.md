# Database recovery rehearsal

Run the full rehearsal on an isolated GitHub Actions worker, never as a second
application inside the live Render service. A large export/restore and another
application can exhaust the live instance's memory even when the database itself
is durable and healthy.

1. Create a fresh branch of `conferencegate` in the existing Turso organization.
   Keep production connected to its existing database.
2. With the account owner's approval, create a short-lived **read-only** token
   scoped to that backup branch. Configure encrypted repository secrets
   `RECOVERY_DATABASE_URL` and `RECOVERY_READ_TOKEN`. Do not use a production
   read/write token. Do not place tokens in code, logs, issues, or documents.
3. Run **Isolated Database Restore Rehearsal** manually from `main`. It first
   validates synthetic fixtures, then reads the branch through Turso's `/dump`
   endpoint and restores the SQL into a new private SQLite file.
4. Require a successful full integrity check, no foreign-key violations, and a
   successful isolated application boot. The test exercises authentication,
   private API protection, messages, unread/read state, notification isolation,
   paid-role registration restrictions, and preservation of pre-existing core
   records. All fixture writes go to the restored local copy.
5. The recovered application receives no database/provider credentials and
   external fetches are blocked. No database, SQL dump, runtime log or customer
   record artifact is uploaded. Private temporary data is deleted at job end.
   Public workflow output contains only bounded operational results.
6. Let the short-lived token expire and retain the provider-hosted backup branch
   according to the owner's retention policy. Remove expired recovery secrets
   if they will not be reused. The workflow has no schedule and cannot change
   the production database connection.

An incomplete browser download is not a usable backup. For a SQLite file, verify
that its size is consistent with the page size and page count in the file header,
then require database integrity and application checks. SQL exports must contain
their final committed transaction and restore completely; a plausible file size
alone is insufficient.

A provider-hosted branch and an ephemeral test export do not establish an
independent off-provider retention policy. That requires a separately approved
storage destination, access controls, and retention plan. Production cutover is
a separate owner-authorized action, with a rollback plan and a verified snapshot.
