import express from 'express';
import { terms, publication, isPublished } from '../legal/terms.js';

// No HTTP editing/publishing endpoint. Only reviewed repository changes by
// authorized maintainers can publish; ordinary accounts cannot alter content.
export function createLegalRouter(document = terms, release = publication) {
  const router = express.Router();
  router.route('/terms').get((req, res) => {
    if (!isPublished(document, release)) {
      res.set('Cache-Control', 'no-store');
      return res.status(503).json({ code: 'TERMS_NOT_PUBLISHED', message: 'Terms & Conditions are not currently available. Please contact support@humaeli.com.' });
    }
    res.set('Cache-Control', 'public, max-age=300, must-revalidate');
    res.set('ETag', `"terms-${document.contentSha256}"`);
    // Explicit fields prevent approval records/internal notes leaking publicly.
    const { documentType, version, effectiveDate, title, introduction, sections, content, contentSha256 } = document;
    return res.json({ documentType, version, effectiveDate, title, introduction, sections, content, contentSha256, status: 'published' });
  }).all((req, res) => res.status(405).set('Allow', 'GET, HEAD').json({ code: 'METHOD_NOT_ALLOWED' }));
  return router;
}
export default createLegalRouter();
