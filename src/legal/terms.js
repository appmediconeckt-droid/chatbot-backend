import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const publication = JSON.parse(readFileSync(new URL('./publication.json', import.meta.url)));
// A deliberate allowlist prevents manifest paths from reading arbitrary files.
export const terms = JSON.parse(readFileSync(new URL('./versions/terms-1.0.json', import.meta.url)));
export const contentText = document => [document.introduction, ...document.sections.flatMap(section => [section.title, ...section.paragraphs])].join('\n\n');
export const contentHash = document => createHash('sha256').update(contentText(document)).digest('hex');
export function isPublished(document, release) {
  return release.status === 'published' && release.version === document.version &&
    typeof release.approvalReference === 'string' && release.approvalReference.trim().length > 0 &&
    release.approvedContentSha256 === contentHash(document) &&
    document.contentSha256 === release.approvedContentSha256 && document.content === contentText(document);
}
