import { spawn } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

// A newly started disposable database is the only permitted target. Never use
// the caller's MONGO_URI or load .env. Run suites separately because they close
// the global Mongoose connection and maintain independent test lifecycle state.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { NODE_ENV: 'test', ACCESS_SECRET: 'isolated-persistence-access-fixture', REFRESH_SECRET: 'isolated-persistence-refresh-fixture', ACCESS_TOKEN_SECRET: 'isolated-persistence-access-fixture', REFRESH_TOKEN_SECRET: 'isolated-persistence-refresh-fixture' });
let failed = false;
for (const file of ['chatExpiry', 'googleAuthChatFlow', 'demoPaymentPersistence', 'loginChallengeIntegration', 'securityPersistence', 'releaseGateVerification']) {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, ip: '127.0.0.1' } });
  try {
    const uri = mongo.getUri(`audit_${file}`);
    // The legacy connectDB helper expects the users namespace to exist before
    // inspecting indexes. Create that prerequisite only in this disposable DB.
    const client = await MongoClient.connect(uri);
    await client.db().createCollection('users');
    await client.close();
    console.log(`Running disposable persistence suite: ${file}`);
    const status = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--require', './scripts/audit/isolated-env.cjs', './node_modules/mocha/bin/mocha.js', '--timeout', '30000', '--exit', `test/${file}.test.js`], { env: { ...env, MONGO_URI: uri }, stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', code => resolve(code));
    });
    failed ||= status !== 0;
  } finally { await mongo.stop(); }
}
process.exit(failed ? 1 : 0);
