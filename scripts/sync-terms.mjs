// Run from backend: node scripts/sync-terms.mjs /absolute/MyApp /absolute/chatbot
// No publication action. Clients receive exact canonical source bytes.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { terms, contentHash, contentText } from '../src/legal/terms.js';
if (terms.content !== contentText(terms) || terms.contentSha256 !== contentHash(terms)) throw new Error('Canonical Terms integrity check failed');
const fallbackApproval = JSON.parse(readFileSync(new URL('../src/legal/mobile-fallback-approval.json', import.meta.url)));
if (fallbackApproval.status !== 'owner_approved_mobile' || fallbackApproval.version !== terms.version || fallbackApproval.contentSha256 !== terms.contentSha256) throw new Error('No matching mobile fallback approval record');
const [mobile, web] = process.argv.slice(2);
if (!mobile || !web) throw new Error('Provide mobile and website checkout paths');
const source = readFileSync(new URL('../src/legal/versions/terms-1.1.json', import.meta.url));
// Only the existing mobile-approved version is bundled; website never falls
// back to this copy while unified publication approval is pending.
mkdirSync(resolve(mobile, 'src/content'), { recursive: true });
writeFileSync(resolve(mobile, 'src/content/termsDocument.json'), source);
mkdirSync(resolve(web, 'test/fixtures'), { recursive: true });
writeFileSync(resolve(web, 'test/fixtures/terms-1.1.json'), source);
console.log(`Terms ${terms.version}: ${terms.contentSha256}; clients synchronized, publication unchanged`);
