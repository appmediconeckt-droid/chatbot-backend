import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';

// Always use a disposable standalone database; never load repository .env.
const mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', dbName: 'booking_setup_test' } });
try {
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: 'test', MONGO_URI: mongo.getUri() });
  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--require', './scripts/audit/isolated-env.cjs', './node_modules/mocha/bin/mocha.js', '--timeout', '30000', '--exit', 'test/bookingSetupPersistence.test.js', 'test/bookingIndexes.test.js', 'test/demoPaymentSafety.test.js'], { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => resolve(code ?? 1));
  });
} finally { await mongo.stop(); }
