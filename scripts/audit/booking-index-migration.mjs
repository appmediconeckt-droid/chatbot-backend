import { MongoClient } from "mongodb";
import { readFile, writeFile, rename } from "node:fs/promises";
import { inspectBookingMigration, applyBookingMigration, rollbackBookingMigration } from "../../src/migrations/bookingIndexes.js";

// Rehearsal tool only. Never loads .env or accepts a remote database.
const uri = process.env.HUMAELI_MIGRATION_LOCAL_URI || "";
if (!/^mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/[A-Za-z0-9_-]+(?:\?[^#]*)?$/.test(uri)) throw new Error("A disposable local MongoDB URI is required; remote targets are refused");
const mode = process.argv[2] || "--dry-run";
const journalPath = process.argv[3];
if (!["--dry-run", "--apply", "--rollback"].includes(mode)) throw new Error("Use --dry-run, --apply or --rollback");
if (mode !== "--dry-run" && (!journalPath || process.env.HUMAELI_BOOKING_WRITES_PAUSED !== "true")) throw new Error("A journal path and explicit paused-writes acknowledgement are required");
const client = new MongoClient(uri);
try {
  await client.connect(); const db = client.db();
  let result;
  if (mode === "--dry-run") result = await inspectBookingMigration(db);
  if (mode === "--apply") {
    // Refuse to overwrite the only recovery record from an earlier attempt.
    await writeFile(journalPath, "{}\n", { flag: "wx", mode: 0o600 });
    result = await applyBookingMigration(db, { writesPaused: true, saveJournal: async journal => {
      await writeFile(`${journalPath}.tmp`, JSON.stringify(journal, null, 2) + "\n", { mode: 0o600 });
      await rename(`${journalPath}.tmp`, journalPath);
    } });
  }
  if (mode === "--rollback") result = await rollbackBookingMigration(db, JSON.parse(await readFile(journalPath, "utf8")), { writesPaused: true });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "blocked" || result.ready === false) process.exitCode = 2;
} finally { await client.close(); }
