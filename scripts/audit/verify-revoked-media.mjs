// Read-only post-change verification. Never revokes or modifies a resource.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
export async function verifyDeniedMedia(manifest, request = fetch) {
  if (!manifest?.changeApprovalReference || !manifest.providerRevocationReceiptReference || manifest.aliasInventoryReviewed !== true || !/^[a-zA-Z0-9_-]+$/.test(manifest.cloudName || '') || !Array.isArray(manifest.resources) || manifest.resources.length !== 2 || new Set(manifest.resources.map(resource => resource.providerAssetFingerprint)).size !== 2) throw new Error('Exact approved two-resource receipt and reviewed alias inventory required');
  const results = [];
  for (const resource of manifest.resources) {
    if (!/^[a-f0-9]{64}$/.test(resource.providerAssetFingerprint || '') || !Array.isArray(resource.urls) || !resource.urls.length) throw new Error('Resource identity and full URL inventory required');
    for (const value of resource.urls) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || url.username || url.password || url.search || url.hash || /\/s--[^/]+--\//.test(url.pathname) || !url.pathname.startsWith(`/${manifest.cloudName}/`)) throw new Error('Only exact unsigned tenant Cloudinary URLs accepted; custom CDN needs separate reviewed adapter');
      let status = null, error = null;
      try {
        const response = await request(url, { method: 'GET', redirect: 'manual', headers: { Range: 'bytes=0-0', 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
        status = response.status;
        // Status alone suffices for denial; never retain private response bytes.
        await response.body?.cancel();
      } catch { error = 'network_unavailable'; }
      results.push({ assetFingerprint: resource.providerAssetFingerprint, urlFingerprint: createHash('sha256').update(value).digest('hex'), status, denied: [401, 403, 404, 410].includes(status), error });
    }
  }
  return { observedAt: new Date().toISOString(), mode: 'read-only-post-approved-change', status: results.every(row => row.denied) ? 'PASS_OBSERVED_INVENTORIED_URLS' : 'BLOCKED_PUBLIC_OR_UNVERIFIED_URL', results,
    limits: ['Company approval and receipt authenticity must be verified by the operator', 'Only reviewed inventoried URLs at this timestamp; does not certify unknown aliases, browser caches or protected-copy retention', 'Repeat after propagation and from an independent network before final security closure'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv.includes('--verify-approved-change')) throw new Error('Post-change verification flag required');
    const result = await verifyDeniedMedia(JSON.parse(await readFile(process.argv[2], 'utf8')));
    console.log(JSON.stringify(result, null, 2)); if (!result.status.startsWith('PASS_')) process.exitCode = 1;
  } catch { console.error('VERIFICATION_BLOCKED: reviewed two-resource manifest and approved change receipt required'); process.exitCode = 1; }
}
