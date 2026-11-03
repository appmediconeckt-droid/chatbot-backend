// Preload before application imports. Never load repository .env credentials.
process.env.AUDIT_ISOLATED_ENV = 'true';
const dotenv = require('dotenv');
dotenv.config = () => ({ parsed: {} });
const { generateKeyPairSync } = require('node:crypto');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'isolated-audit', client_email: 'fixture@isolated-audit.iam.gserviceaccount.com', private_key: privateKey });
const mongoose = require('mongoose');
const connect = mongoose.connect.bind(mongoose);
mongoose.connect = (uri, ...args) => {
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(String(uri))) throw new Error('Audit refuses external database connections');
  return connect(uri, ...args);
};
// Tests may stub these methods, but an unstubbed outbound request fails closed.
for (const protocol of ['node:http', 'node:https']) {
  const client = require(protocol);
  const original = client.request;
  client.request = function (target, ...args) {
    const host = typeof target === 'string' || target instanceof URL ? new URL(target).hostname : target?.hostname || target?.host || 'localhost';
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) throw new Error('Audit refuses external HTTP requests');
    return original.call(this, target, ...args);
  };
}
const fetch = globalThis.fetch;
globalThis.fetch = (url, ...args) => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) throw new Error('Audit refuses external fetch requests');
  return fetch(url, ...args);
};
