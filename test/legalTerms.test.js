import { expect } from 'chai';
import express from 'express';
import request from 'supertest';
import { terms, publication, contentHash, contentText, isPublished } from '../src/legal/terms.js';
import { createLegalRouter } from '../src/routes/legalRoutes.js';
const approved = { status: 'published', version: terms.version, approvedContentSha256: terms.contentSha256, approvalReference: 'test fixture only' };
const appFor = release => { const app = express(); app.use('/api/legal', createLegalRouter(terms, release)); return app; };
describe('canonical Terms publication boundary', () => {
  it('keeps the current release unpublished without unified company approval', async () => {
    expect(publication.status).to.equal('pending_company_approval');
    const response = await request(appFor(publication)).get('/api/legal/terms');
    expect(response.status).to.equal(503);
    expect(response.headers['cache-control']).to.equal('no-store');
    expect(response.text).not.to.include(terms.introduction);
    expect(response.text).not.to.include('approvalReference');
  });
  it('serves the complete approved fixture publicly, with stable metadata and cache revalidation', async () => {
    const app = appFor(approved);
    const response = await request(app).get('/api/legal/terms');
    expect(response.status).to.equal(200);
    expect(response.body.content).to.equal(contentText(terms));
    expect(response.body.contentSha256).to.equal(contentHash(terms));
    expect(response.body.sections).to.have.length(15);
    expect(response.body.sections[6].title).to.include('Consultant');
    expect(response.body.version).to.equal('1.0');
    expect(response.body).not.to.have.property('approvalReference');
    expect(response.headers['cache-control']).to.include('max-age=300');
    const cached = await request(app).get('/api/legal/terms').set('If-None-Match', response.headers.etag);
    expect(cached.status).to.equal(304);
  });
  it('rejects missing approval and content changes under the same approval hash', () => {
    expect(isPublished(terms, { ...approved, approvalReference: '' })).to.equal(false);
    expect(isPublished(terms, { ...approved, version: '2.0' })).to.equal(false);
    expect(isPublished({ ...terms, content: 'changed' }, approved)).to.equal(false);
    expect(isPublished({ ...terms, introduction: 'changed' }, approved)).to.equal(false);
  });
  for (const method of ['post', 'put', 'patch', 'delete']) it(`rejects ${method} by anonymous and ordinary authenticated clients`, async () => {
    for (const authorization of ['', 'Bearer ordinary-user-fixture']) {
      const response = await request(appFor(approved))[method]('/api/legal/terms').set('Authorization', authorization).send({ content: 'rewrite' });
      expect(response.status).to.equal(405);
    }
  });
});
