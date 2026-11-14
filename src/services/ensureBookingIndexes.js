import { REQUIRED_BOOKING_INDEXES, bookingIndexesReady } from './appointmentIndexes.js';
import { inspectBookingMigration } from '../migrations/bookingIndexes.js';

// Share initialization between simultaneous requests, but recheck indexes on
// subsequent bookings so a dropped constraint never silently disables safety.
const initializing = new WeakMap();

export async function ensureBookingIndexes(collection) {
  if (initializing.has(collection)) return initializing.get(collection);
  const task = (async () => {
    let indexes;
    try {
      indexes = await collection.indexes();
    } catch (error) {
      if (error.code !== 26) throw error; // NamespaceNotFound on a fresh database
      indexes = [];
    }
    if (bookingIndexesReady(indexes)) return;
    const plan = await inspectBookingMigration(collection.conn.db);
    if (!plan.ready) {
      const error = new Error('Appointment index setup requires data reconciliation');
      error.code = 'BOOKING_INDEX_CONFLICT';
      error.blockers = plan.blockers;
      throw error;
    }
    // Index builds are idempotent across server instances. MongoDB refuses a
    // unique build if concurrent writes introduced duplicates during preflight.
    for (const name of plan.plannedIndexes) {
      const { key, ...options } = REQUIRED_BOOKING_INDEXES.find(index => index.name === name);
      await collection.createIndex(key, options);
    }
    if (!bookingIndexesReady(await collection.indexes())) {
      throw new Error('Appointment index verification failed');
    }
  })();
  initializing.set(collection, task);
  try {
    await task;
  } finally {
    initializing.delete(collection);
  }
}
