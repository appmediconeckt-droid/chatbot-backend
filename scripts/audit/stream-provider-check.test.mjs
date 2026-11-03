import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, probe } from './stream-provider-check.mjs';
const token = claims => `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.fixture`;
const fixture = () => {
  const config = { environment: 'isolated-test', separationApprovalReference: 'fixture-only', permissionSnapshotSHA256: 'a'.repeat(64), callType: 'default', callId: 'audit_humaeli_fixture', actors: {} };
  const env = { HUMAELI_STREAM_TEST_API_KEY: 'fixture-only-test-key', HUMAELI_STREAM_PRODUCTION_KEY_SHA256: 'b'.repeat(64) };
  for (const actor of ['A', 'B', 'C']) { const userId = `audit_humaeli_fixture_${actor.toLowerCase()}`; config.actors[actor] = { userId }; env[`HUMAELI_STREAM_TEST_TOKEN_${actor}`] = token({ user_id: userId, exp: Math.floor(Date.now() / 1000) + 300 }); }
  return { config, env };
};
test('validation performs no network and refuses unknown app separation', () => {
  const { config, env } = fixture(); assert.equal(validate(config, env).operations, 6);
  delete env.HUMAELI_STREAM_PRODUCTION_KEY_SHA256; assert.throws(() => validate(config, env));
});
test('admin and target-member outsider tokens are refused', () => {
  for (const extra of [{ server: true }, { role: 'admin' }, { call_cids: ['default:audit_humaeli_fixture'] }]) {
    const { config, env } = fixture(); env.HUMAELI_STREAM_TEST_TOKEN_C = token({ user_id: config.actors.C.userId, exp: Date.now() / 1000 + 300, ...extra }); assert.throws(() => validate(config, env));
  }
});
test('ordinary A/B allow and C deny are recorded without response bodies', async () => {
  const { config, env } = fixture(); let calls = 0;
  const result = await probe(config, env, async (url, options) => {
    calls++; assert.equal(url.hostname, 'video.stream-io-api.com');
    if (options.method === 'POST') assert.equal(JSON.parse(options.body).create, false);
    return { status: calls <= 4 ? 200 : 403, headers: new Headers(), json: async () => ({ call: { cid: `default:${config.callId}` }, secret: 'must-not-export', code: 17 }) };
  });
  assert.equal(calls, 6); assert.equal(result.coordinatorPassed, true); assert.equal(result.mediaVerified, false); assert.ok(!JSON.stringify(result).includes('must-not-export'));
});
test('outsider success or ambiguous 404 never passes authorization gate', async () => {
  for (const status of [200, 404]) {
    const { config, env } = fixture(); const result = await probe(config, env, async () => ({ status, headers: new Headers(), json: async () => ({}) }));
    assert.equal(result.coordinatorPassed, false);
  }
});
