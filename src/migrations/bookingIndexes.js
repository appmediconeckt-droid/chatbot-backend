import { REQUIRED_BOOKING_INDEXES, bookingIndexesReady } from "../services/appointmentIndexes.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const matches = (actual, expected) => actual?.unique === true && same(actual.key, expected.key) && same(actual.partialFilterExpression, expected.partialFilterExpression);
const active = { status: { $in: ["pending", "confirmed"] } };

async function duplicateGroups(collection, match, fields) {
  return collection.aggregate([
    { $match: match },
    { $group: { _id: Object.fromEntries(fields.map(field => [field, `$${field}`])), count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: "groups" },
  ]).toArray().then(rows => rows[0]?.groups || 0);
}

// Read-only preflight: no record repair, normalization, collection creation,
// index replacement or implicit choice of which appointment should win.
export async function inspectBookingMigration(db) {
  const hello = await db.admin().command({ hello: 1 });
  const collection = db.collection("appointments");
  const exists = await db.listCollections({ name: "appointments" }, { nameOnly: true }).hasNext();
  const indexes = exists ? await collection.indexes() : [];
  const blockers = [];
  if (!hello.setName && hello.msg !== "isdbgrid") blockers.push("TRANSACTION_CAPABLE_DATABASE_REQUIRED");
  const duplicates = exists ? {
    counselorStarts: await duplicateGroups(collection, active, ["counselor", "date"]),
    patientStarts: await duplicateGroups(collection, active, ["patient", "date"]),
    requestKeys: await duplicateGroups(collection, { requestKey: { $type: "string" } }, ["patient", "requestKey"]),
  } : { counselorStarts: 0, patientStarts: 0, requestKeys: 0 };
  if (Object.values(duplicates).some(count => count > 0)) blockers.push("DUPLICATE_RESOLUTION_APPROVAL_REQUIRED");
  const malformedActive = exists ? await collection.countDocuments({ ...active, $or: [
    { counselor: { $not: { $type: "objectId" } } },
    { patient: { $not: { $type: "objectId" } } },
    { date: { $not: { $type: "date" } } },
  ] }) : 0;
  if (malformedActive) blockers.push("ACTIVE_RECORD_REPAIR_APPROVAL_REQUIRED");
  const noncanonicalActive = exists ? await collection.countDocuments({ status: { $regex: "^(pending|confirmed)$", $options: "i", $nin: ["pending", "confirmed"] } }) : 0;
  if (noncanonicalActive) blockers.push("STATUS_NORMALIZATION_APPROVAL_REQUIRED");
  for (const expected of REQUIRED_BOOKING_INDEXES) {
    const existing = indexes.find(index => index.name === expected.name);
    if (existing && !matches(existing, expected)) blockers.push(`INDEX_DEFINITION_CONFLICT:${expected.name}`);
  }
  return { ready: blockers.length === 0, alreadyApplied: bookingIndexesReady(indexes), blockers, duplicates, malformedActive, noncanonicalActive,
    databaseName: db.databaseName, collection: "appointments", originalIndexNames: indexes.map(index => index.name),
    plannedIndexes: REQUIRED_BOOKING_INDEXES.filter(index => !indexes.some(existing => existing.name === index.name)).map(index => index.name) };
}

export async function applyBookingMigration(db, { writesPaused = false, saveJournal = async () => {} } = {}) {
  if (!writesPaused) throw new Error("Booking writes must be paused before index migration");
  const plan = await inspectBookingMigration(db);
  if (!plan.ready) return { status: "blocked", plan };
  const journal = { version: 1, databaseName: db.databaseName, collection: "appointments", originalIndexNames: plan.originalIndexNames, plannedIndexes: plan.plannedIndexes, createdIndexes: [], status: "prepared" };
  // Persist intent BEFORE any index operation, allowing recovery after a crash.
  await saveJournal(structuredClone(journal));
  for (const name of journal.plannedIndexes) {
    const spec = REQUIRED_BOOKING_INDEXES.find(index => index.name === name);
    const { key, ...options } = spec;
    try {
      await db.collection("appointments").createIndex(key, options);
      journal.createdIndexes.push(name); journal.status = "applying";
      await saveJournal(structuredClone(journal));
    } catch (error) {
      journal.status = "interrupted";
      await saveJournal(structuredClone(journal));
      throw error;
    }
  }
  const indexes = await db.collection("appointments").indexes();
  if (!bookingIndexesReady(indexes)) throw new Error("Booking index postflight failed");
  journal.status = "verified"; await saveJournal(structuredClone(journal));
  return { status: "verified", journal };
}

// Rollback never reverts appointment records or removes a pre-existing index.
// Bookings remain paused: dropping constraints is not permission to run an old
// unsafe booking implementation while data/index problems are investigated.
export async function rollbackBookingMigration(db, journal, { writesPaused = false } = {}) {
  if (!writesPaused || journal?.databaseName !== db.databaseName || journal.collection !== "appointments" || journal.version !== 1) throw new Error("Rollback context does not match paused booking database");
  if (!Array.isArray(journal.plannedIndexes) || !Array.isArray(journal.originalIndexNames)) throw new Error("A persisted pre-migration journal is required");
  if (new Set(journal.plannedIndexes).size !== journal.plannedIndexes.length || journal.plannedIndexes.some(name => !REQUIRED_BOOKING_INDEXES.some(index => index.name === name) || journal.originalIndexNames.includes(name))) throw new Error("Rollback refuses a pre-existing or unknown index");
  const snapshot = await db.collection("appointments").indexes();
  for (const name of journal.plannedIndexes) {
    const expected = REQUIRED_BOOKING_INDEXES.find(index => index.name === name);
    const current = snapshot.find(index => index.name === name);
    if (current && !matches(current, expected)) throw new Error("Index changed after migration; operator reconciliation required");
  }
  const dropped = [];
  for (const name of [...journal.plannedIndexes].reverse()) {
    const expected = REQUIRED_BOOKING_INDEXES.find(index => index.name === name);
    if (!expected || journal.originalIndexNames.includes(name)) throw new Error("Rollback refuses a pre-existing or unknown index");
    const current = (await db.collection("appointments").indexes()).find(index => index.name === name);
    if (!current) continue;
    if (!matches(current, expected)) throw new Error("Index changed after migration; operator reconciliation required");
    await db.collection("appointments").dropIndex(name); dropped.push(name);
  }
  return { status: "rolled_back_writes_still_paused", dropped };
}
