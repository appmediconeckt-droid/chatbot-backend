import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeniedMedia } from './verify-revoked-media.mjs';
const fixture = () => ({ cloudName: 'synthetic-only', changeApprovalReference: 'SYNTHETIC_ONLY', providerRevocationReceiptReference: 'SYNTHETIC_ONLY', aliasInventoryReviewed: true, resources: ['a', 'b'].map(letter => ({ providerAssetFingerprint: letter.repeat(64), urls: [`https://res.cloudinary.com/synthetic-only/image/upload/v1/${letter}.jpg`, `https://res.cloudinary.com/synthetic-only/image/upload/w_100/${letter}.jpg`] })) });
test('missing change evidence makes no provider request', async () => {
  const manifest = fixture(); delete manifest.providerRevocationReceiptReference;
  await assert.rejects(verifyDeniedMedia(manifest, () => { throw new Error('must not call'); }));
});
test('all original and derivative URLs must deny', async () => {
  let calls = 0; const result = await verifyDeniedMedia(fixture(), async () => ({ status: ++calls === 4 ? 200 : 404, body: { cancel: async () => {} } }));
  assert.equal(calls, 4); assert.equal(result.status, 'BLOCKED_PUBLIC_OR_UNVERIFIED_URL');
});
test('redirects and network failure never count as denial', async () => {
  for (const response of [async () => ({ status: 302 }), async () => { throw new Error('fixture'); }]) assert.equal((await verifyDeniedMedia(fixture(), response)).status, 'BLOCKED_PUBLIC_OR_UNVERIFIED_URL');
});
test('denial receipts contain no raw URLs or bytes', async () => {
  const result = await verifyDeniedMedia(fixture(), async () => ({ status: 403, body: { cancel: async () => {} } }));
  assert.equal(result.status, 'PASS_OBSERVED_INVENTORIED_URLS'); assert.ok(!JSON.stringify(result).includes('https://'));
});
test('unreviewed host, signed URL and foreign tenant are refused', async () => {
  for (const url of ['https://example.test/a', 'https://res.cloudinary.com/foreign/image/upload/a.jpg', 'https://res.cloudinary.com/synthetic-only/image/upload/a.jpg?token=secret', 'https://res.cloudinary.com/synthetic-only/image/upload/s--signed--/v1/a.jpg']) {
    const manifest = fixture(); manifest.resources[0].urls = [url]; await assert.rejects(verifyDeniedMedia(manifest));
  }
});
