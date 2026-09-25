import assert from "node:assert/strict";
import {
  closeDb,
  databaseBackend,
  databasePathConfigured,
  databasePersistenceConfigured,
} from "../server/db";

assert.equal(databaseBackend, "turso", "Turso credentials must select the Turso runtime backend");
assert.equal(databasePathConfigured, false, "The smoke test should not require a local DATABASE_PATH");
assert.equal(databasePersistenceConfigured, true, "Turso must count as durable production persistence");

closeDb();
console.log("Turso runtime database selection smoke test passed.");
