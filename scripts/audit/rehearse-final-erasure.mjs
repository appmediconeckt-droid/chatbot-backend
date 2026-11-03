// Executable design rehearsal, NEVER a production deletion executor.
// Owns its disposable database; accepts no URI, account or production rules.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1' } });
const client = new MongoClient(mongo.getUri());
const cases = [];
try {
  await client.connect();
  const db = client.db(`audit_final_erasure_${randomUUID().replaceAll('-', '')}`);
  const records = db.collection('synthetic_records'), jobs = db.collection('synthetic_jobs');
  const categories = ['identity', 'clinical', 'financial', 'shared_message', 'private_media', 'safety', 'ai_history'];
  const receipts = { apple: 'synthetic_revoked', stream: 'synthetic_erased', cloudinary: 'synthetic_erased', backups: 'synthetic_reconciled' };
  async function fixture(role) {
    const id = `fixture_${randomUUID()}`;
    await records.insertMany(categories.map(category => ({ account: id, category, payload: 'synthetic only', role })));
    await jobs.insertOne({ _id: id, status: 'synthetic_pending', checkpoints: [] });
    return id;
  }
  const policy = () => ({ version: 'SYNTHETIC_ONLY', approval: 'fixture-not-company-approval', holdReviewed: true, activeHold: false,
    rules: Object.fromEntries(categories.map(category => [category, 'erase'])), receipts: { ...receipts } });
  async function execute(id, plan, crashAfter = '') {
    assert.match(db.databaseName, /^audit_final_erasure_/); assert.match(id, /^fixture_/);
    assert.equal(plan?.version, 'SYNTHETIC_ONLY', 'Missing synthetic policy');
    assert.equal(plan.approval, 'fixture-not-company-approval');
    assert.equal(plan.holdReviewed, true, 'Hold review required'); assert.equal(plan.activeHold, false, 'Active hold blocks purge');
    assert.deepEqual(Object.keys(plan.rules).sort(), [...categories].sort(), 'Full category disposition required');
    for (const rule of Object.values(plan.rules)) assert.ok(['erase', 'retain_restricted'].includes(rule), 'Unknown disposition');
    assert.deepEqual(plan.receipts, receipts, 'Provider/backup receipts required');
    for (const category of categories) {
      const session = client.startSession();
      try {
        await session.withTransaction(async () => {
          const job = await jobs.findOne({ _id: id }, { session });
          assert.ok(job, 'Durable request required');
          if (job.checkpoints.includes(category)) return;
          // Atomic resource action + checkpoint: a restart cannot replay a
          // partially acknowledged purge. Production adapters need the same
          // guarantee or idempotent external receipts, not this toy schema.
          if (plan.rules[category] === 'erase') await records.deleteMany({ account: id, category }, { session });
          else await records.updateMany({ account: id, category }, { $set: { restricted: true, ruleVersion: plan.version } }, { session });
          await jobs.updateOne({ _id: id }, { $addToSet: { checkpoints: category } }, { session });
        });
      } finally { await session.endSession(); }
      if (crashAfter === category) throw new Error('synthetic interruption');
    }
    const remaining = await records.find({ account: id }).toArray();
    assert.ok(remaining.every(row => plan.rules[row.category] === 'retain_restricted' && row.restricted));
    const job = await jobs.findOne({ _id: id }); assert.equal(job.checkpoints.length, categories.length);
    await jobs.updateOne({ _id: id }, { $set: { status: remaining.length ? 'synthetic_completed_with_retention' : 'synthetic_completed_erased', policyVersion: plan.version, receipts: plan.receipts } });
    return remaining.length;
  }
  const check = async (name, fn) => { await fn(); cases.push({ name, status: 'PASS' }); };
  for (const role of ['user', 'consultant']) await check(`${role}: all synthetic categories erased, unrelated account preserved, replay idempotent`, async () => {
    const id = await fixture(role), other = await fixture(role);
    assert.equal(await execute(id, policy()), 0); assert.equal(await execute(id, policy()), 0);
    assert.equal(await records.countDocuments({ account: other }), categories.length);
    assert.equal((await jobs.findOne({ _id: id })).status, 'synthetic_completed_erased');
  });
  for (const [name, modify] of [
    ['missing policy', p => { p.version = ''; }], ['missing approval', p => { p.approval = ''; }],
    ['unreviewed holds', p => { p.holdReviewed = false; }], ['active legal hold', p => { p.activeHold = true; }],
    ['unknown category', p => { delete p.rules.clinical; }], ['unsupported anonymization', p => { p.rules.identity = 'anonymize'; }],
    ['provider incomplete', p => { delete p.receipts.stream; }], ['backups incomplete', p => { delete p.receipts.backups; }],
  ]) await check(`${name}: no erasure or completion`, async () => {
    const id = await fixture('user'), p = policy(); modify(p);
    await assert.rejects(execute(id, p)); assert.equal(await records.countDocuments({ account: id }), categories.length);
    assert.equal((await jobs.findOne({ _id: id })).status, 'synthetic_pending');
  });
  await check('approved synthetic retention stays restricted and is reported distinctly', async () => {
    const id = await fixture('user'), p = policy(); p.rules.clinical = 'retain_restricted'; p.rules.financial = 'retain_restricted';
    assert.equal(await execute(id, p), 2); assert.equal((await jobs.findOne({ _id: id })).status, 'synthetic_completed_with_retention');
  });
  await check('restart after committed purge resumes durable checkpoints', async () => {
    const id = await fixture('consultant'); await assert.rejects(execute(id, policy(), 'clinical'));
    assert.equal((await jobs.findOne({ _id: id })).status, 'synthetic_pending');
    assert.equal(await records.countDocuments({ account: id }), categories.length - 2);
    assert.equal(await execute(id, policy()), 0);
  });
  await check('competing synthetic executors reconcile one checkpoint per category', async () => {
    const id = await fixture('user'); await Promise.all([execute(id, policy()), execute(id, policy())]);
    assert.equal((await jobs.findOne({ _id: id })).checkpoints.length, categories.length);
    assert.equal(await records.countDocuments({ account: id }), 0);
  });
  console.log(JSON.stringify({ mode: 'disposable-synthetic-design-rehearsal', productionCompletionVerified: false, cases,
    limits: ['Separate rehearsal, not imported by application or worker', 'Real model ownership/dependencies, anonymization, receipt authenticity, hold changes, leases, provider/backup erasure and Apple revocation still need approved production adapters and end-to-end tests', 'Fixture rules and receipts are invented test data, never company policy'] }, null, 2));
} finally { await client.close(); await mongo.stop(); }
