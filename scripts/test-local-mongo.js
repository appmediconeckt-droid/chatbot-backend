// Run the entire suite without connecting to the database configured in .env.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
let mongo;
try {
  mongo = await MongoMemoryServer.create({
    instance: { ip: '127.0.0.1', dbName: 'humaeli_test' },
  });
  const child = spawn(process.execPath, [
    'node_modules/mocha/bin/mocha.js', '--timeout', '10000', '--exit',
    '--require', '@babel/register', 'test/**/*.test.js', ...process.argv.slice(2),
  ], {
    cwd: projectRoot,
    env: { ...process.env, NODE_ENV: 'test', MONGO_URI: mongo.getUri() },
    stdio: 'inherit',
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => resolve(code ?? 1));
    });
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
} catch (error) {
  console.error('Local MongoDB test run failed:', error.message);
  process.exitCode = 1;
} finally {
  await mongo?.stop();
}
