// Read-only account inspection: never import app/models/workers or run migrations.
// Usage: node scripts/audit/inspect-deleted-account.mjs --read-only-production
// Supply the account email on stdin, keeping it out of shell history/arguments.
import { readFile } from 'node:fs/promises';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const email = input.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Valid email required on stdin');
const production = process.argv.includes('--read-only-production');
const uri = process.env.HUMAELI_INSPECTION_MONGO_URI || (production ? dotenv.parse(await readFile('.env', 'utf8')).MONGO_URI : '');
if (!uri || (!production && !/^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(uri))) throw new Error('Explicit database selection required');
const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1, readPreference: 'primary', monitorCommands: true });
const commands = new Set();
client.on('commandStarted', event => commands.add(event.commandName));
try {
  await client.connect(); const db = client.db();
  const users = await db.collection('users').find({ $or: [{ email }, { googleEmail: email }] }, { projection: { _id: 1, role: 1, isActive: 1, authProvider: 1, createdAt: 1, updatedAt: 1 } }).toArray();
  for (const user of users) {
    user.passwordConfigured = Boolean(await db.collection('users').countDocuments({ _id: user._id, password: { $type: 'string', $ne: '' } }));
    user.googleLinked = Boolean(await db.collection('users').countDocuments({ _id: user._id, googleId: { $type: 'string', $ne: '' } }));
  }
  const jobs = await db.collection('accountdeletionjobs').find({ $or: [{ completionEmail: email }, { _id: { $in: users.map(user => user._id) } }] }, { projection: { _id: 1, status: 1, policyVersion: 1, createdAt: 1, updatedAt: 1, retentionUntil: 1, accessRevokedAt: 1, localCleanupVerifiedAt: 1, completedAt: 1, blockers: 1, lastErrorCode: 1, completionNoticeSentAt: 1, nextAttemptAt: 1, cleanupTracking: 1 } }).toArray();
  const ids = [...new Map([...users, ...jobs].map(item => [String(item._id), item._id])).values()];
  const counts = {};
  const selections = [
    ['users', { _id: { $in: ids } }], ['sessions', { userId: { $in: ids } }], ['refreshtokens', { userId: { $in: ids } }],
    ['chats', { $or: [{ userId: { $in: ids } }, { counselorId: { $in: ids } }] }],
    ['appointments', { $or: [{ patient: { $in: ids } }, { counselor: { $in: ids } }] }],
    ['privateassets', { ownerId: { $in: ids } }], ['messages', { senderId: { $in: ids } }],
    ['loginchallenges', { _id: { $in: ids } }],
    ['prescriptions', { $or: [{ patientId: { $in: ids } }, { psychiatristId: { $in: ids } }] }],
    ['calls', { $or: [{ callerId: { $in: ids } }, { receiverId: { $in: ids } }] }],
    ['transactions', { $or: [{ userId: { $in: ids } }, { counselorId: { $in: ids } }] }],
    ['counselorearnings', { $or: [{ userId: { $in: ids } }, { counselorId: { $in: ids } }] }],
  ];
  for (const [name, filter] of selections) counts[name] = await db.collection(name).countDocuments(filter);
  counts.activeSessions = await db.collection('sessions').countDocuments({ userId: { $in: ids }, isActive: true });
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), mode: 'read-only', matchedUsers: users, matchedJobs: jobs, counts, commands: [...commands].sort(), limitation: 'Jobs whose completion email was erased cannot be linked to this email without the original account/request ID. Counts cover matched IDs only.' }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ readOnlyInspectionFailed: true, errorType: error.name, code: error.code || null }));
  process.exitCode = 1;
} finally { await client.close(); }
