// Direct provider coordinator probes. No server secret or admin token accepted.
// Real media publication, revocation and teardown still require SDK/device tests.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash = value => createHash('sha256').update(value).digest('hex');
export function validate(config, env) {
  if (config.environment !== 'isolated-test' || !config.separationApprovalReference || !config.permissionSnapshotSHA256?.match(/^[a-f0-9]{64}$/)) throw new Error('Isolated app approval and permission snapshot required');
  const key = env.HUMAELI_STREAM_TEST_API_KEY;
  const production = (env.HUMAELI_STREAM_PRODUCTION_KEY_SHA256 || '').split(',').filter(Boolean);
  if (!key || !production.length || production.some(value => !/^[a-f0-9]{64}$/.test(value)) || production.includes(hash(key))) throw new Error('Distinct test key and complete production-key fingerprint inventory required');
  if (!/^audit_humaeli_[a-z0-9_-]+$/.test(config.callId) || config.callType !== 'default') throw new Error('Synthetic default call required');
  const actors = config.actors;
  if (!actors || Object.keys(actors).sort().join() !== 'A,B,C') throw new Error('Three isolated actors required');
  const ids = new Set();
  for (const [actor, fixture] of Object.entries(actors)) {
    if (!/^audit_humaeli_[a-z0-9_-]+$/.test(fixture.userId)) throw new Error('Synthetic user IDs required');
    if (ids.has(fixture.userId)) throw new Error('Actors must be distinct'); ids.add(fixture.userId);
    const token = env[`HUMAELI_STREAM_TEST_TOKEN_${actor}`];
    let claims; try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { throw new Error('Ordinary user token required'); }
    if (claims.user_id !== fixture.userId || claims.server || claims.admin || claims.role === 'admin' || claims.exp <= Date.now() / 1000 || !claims.exp) throw new Error('Valid non-admin matching user token required');
    if (actor === 'C' && (claims.call_cids || []).includes(`default:${config.callId}`)) throw new Error('Outsider token must not grant target membership');
  }
  return { keyFingerprint: hash(key), callFingerprint: hash(config.callId), operations: 6, mediaVerified: false };
}
export async function probe(config, env, request = fetch) {
  const plan = validate(config, env); const results = [];
  for (const actor of ['A', 'B', 'C']) for (const operation of ['read', 'join']) {
    const url = new URL(`https://video.stream-io-api.com/api/v2/video/call/default/${encodeURIComponent(config.callId)}${operation === 'join' ? '/join' : ''}`);
    url.searchParams.set('api_key', env.HUMAELI_STREAM_TEST_API_KEY);
    const response = await request(url, { method: operation === 'read' ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: env[`HUMAELI_STREAM_TEST_TOKEN_${actor}`], 'stream-auth-type': 'jwt', 'Content-Type': 'application/json' },
      ...(operation === 'join' ? { body: JSON.stringify({ create: false, location: 'ERR' }) } : {}) });
    // Never export response bodies: join returns SFU credentials.
    let body = {}; try { body = await response.json(); } catch { /* status remains evidence */ }
    const expected = actor === 'C' ? 'deny' : 'allow';
    const passed = expected === 'allow' ? response.status === 200 && body.call?.cid === `default:${config.callId}` : [401, 403].includes(response.status);
    results.push({ actor, operation, expected, status: response.status, passed,
      providerCode: typeof body.code === 'number' ? body.code : null,
      requestId: response.headers.get('x-request-id')?.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 100) || null });
  }
  return { ...plan, observedAt: new Date().toISOString(), coordinatorPassed: results.every(row => row.passed), results,
    releaseGate: 'INCOMPLETE_UNTIL_FULL_DEVICE_AND_REVOCATION_MATRIX', cleanup: 'Operator must end exact journaled fixture call and remove only isolated fixtures after evidence capture' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
    const result = process.argv.includes('--run-isolated-provider-probes') ? await probe(config, process.env) : { mode: 'validate-only-no-network', ...validate(config, process.env) };
    console.log(JSON.stringify(result, null, 2));
    if (result.coordinatorPassed === false) process.exitCode = 1;
  } catch { console.error('STREAM_TEST_BLOCKED: isolated manifest, key separation and ordinary fixture tokens must be verified; no token or provider body logged'); process.exitCode = 1; }
}
