// Explicit read-only investigation. No app imports, provider admin API or writes.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

if (!process.argv.includes('--read-only-production-inventory')) throw new Error('Explicit read-only selection required');
const env = dotenv.parse(await readFile('.env', 'utf8'));
const hash = value => createHash('sha256').update(String(value)).digest('hex');
const client = new MongoClient(env.MONGO_URI, { monitorCommands: true, maxPoolSize: 1, serverSelectionTimeoutMS: 15000, readPreference: 'secondaryPreferred' });
const commands = new Set(); client.on('commandStarted', event => commands.add(event.commandName));
const selections = [
  ['messages', 'consultationAttachment', 'attachmentUrl'],
  ['users', 'professionalCertificate', 'certifications.documentUrl', 'certifications'],
  ['prescriptions', 'prescriptionPDF', 'pdf.url'],
  ['prescriptions', 'signatureSnapshot', 'psychiatristSnapshot.prescriptionSignature'],
  ['prescriptions', 'sealSnapshot', 'psychiatristSnapshot.prescriptionSeal'],
];
async function providerIdentity(value) {
  try {
    const url = new URL(value), parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname !== 'res.cloudinary.com' || parts[0] !== env.CLOUDINARY_CLOUD_NAME || parts[2] !== 'upload') return { providerIdentity: 'not_cloudinary_upload' };
    const version = parts.findIndex((part, index) => index > 2 && /^v\d+$/.test(part));
    if (version < 0) return { providerIdentity: 'versioned_identity_requires_operator_mapping' };
    let publicId = parts.slice(version + 1).join('/');
    if (parts[1] !== 'raw') publicId = publicId.replace(/\.[^/.]+$/, '');
    const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(parts[0])}/resources/${encodeURIComponent(parts[1])}/upload/${encodeURIComponent(publicId)}`;
    const response = await fetch(endpoint, { headers: { Authorization: `Basic ${Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString('base64')}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return { providerIdentity: 'not_resolved', providerMetadataHTTPStatus: response.status };
    const data = await response.json();
    return { providerIdentity: data.asset_id ? 'resolved_read_only_admin_metadata' : 'not_resolved', providerAssetFingerprint: data.asset_id ? hash(`${parts[0]}:${data.asset_id}`) : null,
      providerResourceType: data.resource_type, providerDeliveryType: data.type, providerByteCount: data.bytes, providerFormat: data.format,
      providerAccessMode: data.access_mode || 'not_explicit', providerAccessControlRuleCount: Array.isArray(data.access_control) ? data.access_control.length : 0 };
  } catch { return { providerIdentity: 'metadata_unavailable' }; }
}
async function probe(value) {
  let url; try { url = new URL(value); } catch { return { exposure: 'invalid_reference' }; }
  const allowedHost = url.hostname === 'humaeli.com' || (url.hostname === 'res.cloudinary.com' && decodeURIComponent(url.pathname.split('/')[1]) === env.CLOUDINARY_CLOUD_NAME);
  if (url.protocol !== 'https:' || !allowedHost || url.username || url.password) return { exposure: 'not_probed_tenant_allowlist' };
  try {
    // No auth, no cookies, no redirects. Never persist bytes or URL. Inspect a
    // bounded prefix for credential markers; partial inspection is not a full scan.
    const response = await fetch(url, { headers: { Range: 'bytes=0-65535' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    let size = 0; const chunks = []; const reader = response.body?.getReader();
    if (reader) { try { while (size < 65536) { const { done, value: bytes } = await reader.read(); if (done) break; const part = bytes.subarray(0, 65536 - size); chunks.push(part); size += part.length; } } finally { await reader.cancel(); } }
    const prefix = Buffer.concat(chunks).toString('latin1');
    const privateKeyMarker = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(prefix);
    const publicCertificateMarker = /-----BEGIN CERTIFICATE-----/.test(prefix);
    const type = String(response.headers.get('content-type') || '').split(';')[0];
    return { httpStatus: response.status, contentType: type, inspectedPrefixBytes: size,
      detectedPrefixType: prefix.startsWith('%PDF-') ? 'pdf' : /^\s*(?:<!doctype html|<html)/i.test(prefix) ? 'html' : Buffer.concat(chunks).subarray(0, 3).toString('hex') === 'ffd8ff' ? 'jpeg' : 'other_or_empty',
      exposure: [200, 206].includes(response.status) && size > 0 ? 'unauthenticated_bytes_accessible' : [401, 403, 404, 410].includes(response.status) ? 'denied_at_observed_url' : 'unresolved_response',
      privateKeyMarker, publicCertificateMarker, inspectionScope: 'bounded_prefix_not_full_credential_or_document_review' };
  } catch { return { exposure: 'network_probe_unavailable' }; }
}
try {
  await client.connect(); const db = client.db(); const references = []; const cache = new Map();
  for (const [collection, category, field, unwind] of selections) {
    const pipeline = unwind ? [{ $unwind: { path: `$${unwind}`, includeArrayIndex: 'itemIndex' } }] : [];
    pipeline.push({ $project: { source: '$_id', itemIndex: 1, url: `$${field}`, patientId: 1, psychiatristId: 1, senderId: 1, chatId: 1, embeddedPDFType: { $type: '$pdf.data' } } }, { $match: { url: { $type: 'string', $ne: '' } } });
    for (const row of await db.collection(collection).aggregate(pipeline, { maxTimeMS: 15000 }).toArray()) {
      if (category !== 'professionalCertificate' && !/^https:\/\/res\.cloudinary\.com\/[^/]+\/(image|raw|video)\/upload\//i.test(row.url)) continue;
      const assetFingerprint = hash(row.url);
      if (!cache.has(assetFingerprint)) cache.set(assetFingerprint, { ...await probe(row.url), ...await providerIdentity(row.url) });
      const parsed = (() => { try { return new URL(row.url); } catch { return null; } })();
      const pathname = parsed?.pathname || '';
      references.push({ referenceFingerprint: hash(`${collection}:${row.source}:${field}:${row.itemIndex ?? ''}`), collection, field, category, assetFingerprint,
        sourceRecordFingerprint: hash(`${collection}:${row.source}`),
        ownershipFieldsPresent: category === 'professionalCertificate' ? true : collection === 'messages' ? Boolean(row.senderId && row.chatId) : Boolean(row.patientId && row.psychiatristId && row.chatId),
        ...(category === 'prescriptionPDF' ? { hasEmbeddedPDFBinary: row.embeddedPDFType === 'binData' } : {}),
        declaredPurpose: category === 'professionalCertificate' ? 'professional_qualification_document_not_an_Apple_signing_certificate_field' : 'sensitive_service_media',
        urlExtension: pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase() || 'unknown',
        referenceHost: parsed?.hostname || 'invalid',
        reservedExampleHost: /^(?:[^.]+\.)*(?:example\.(?:com|org|net)|example|test|invalid|localhost)$/.test(parsed?.hostname || ''),
        credentialContainerExtension: /\.(?:p12|pfx|p8|pem|key|jks|keystore)$/i.test(pathname), ...cache.get(assetFingerprint) });
    }
  }
  console.log(JSON.stringify({ mode: 'read-only-bounded-unauthenticated-probe', observedAt: new Date().toISOString(), references, uniqueURLCount: cache.size,
    observedCommandNames: [...commands].sort(), applicationWriteCommands: [...commands].filter(name => !['aggregate', 'hello', 'ping', 'endSessions'].includes(name)),
    limitations: ['Fingerprints identify exact database references without exporting IDs or URLs; rerun restricted resolver for migration', 'URL fingerprints are not authoritative provider asset IDs; version/alias deduplication and ownership remain required', 'No originals saved, no copies migrated, no ACL or CDN invalidation changes', 'No private key marker in a prefix does not exclude encrypted containers, later bytes, embedded images or unscanned history'] }, null, 2));
} catch { console.error('READ_ONLY_CLASSIFICATION_UNAVAILABLE'); process.exitCode = 1; }
finally { await client.close(); }
