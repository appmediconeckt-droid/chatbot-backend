import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
// Tests requiring a real database are separate manual gates. Every selected test
// uses model stubs; no .env file, provider credential or external DB is available.
const excluded = new Set(['chatExpiry.test.js', 'googleAuthChatFlow.test.js', 'demoPaymentPersistence.test.js', 'loginChallengeIntegration.test.js', 'securityPersistence.test.js', 'releaseGateVerification.test.js']);
const files = readdirSync('test').filter(name => name.endsWith('.test.js') && !excluded.has(name)).map(name => `test/${name}`);
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { NODE_ENV: 'test', ACCESS_SECRET: 'isolated-audit-access-fixture', REFRESH_SECRET: 'isolated-audit-refresh-fixture', ACCESS_TOKEN_SECRET: 'isolated-audit-access-fixture', REFRESH_TOKEN_SECRET: 'isolated-audit-refresh-fixture' });
const result = spawnSync(process.execPath, ['--require', './scripts/audit/isolated-env.cjs', './node_modules/mocha/bin/mocha.js', '--require', './scripts/audit/isolated-hooks.mjs', '--timeout', '10000', '--exit', ...files], { env, stdio: 'inherit' });
console.log(`Excluded ${excluded.size} persistence suites; run only with a disposable local MongoDB.`);
process.exit(result.status ?? 1);
