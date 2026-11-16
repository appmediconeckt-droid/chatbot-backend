import { expect } from 'chai';
import { registrationEligibility } from '../src/services/registrationEligibility.js';
import { approvedRegistration } from './fixtures/registrationConsent.js';
const now = new Date('2026-11-16T12:00:00Z');
const check = body => { const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } }; return { record: registrationEligibility(body, res, 'email', now), res }; };
describe('Approved new-account eligibility', () => {
  for (const age of [undefined, null, '', 17, 151, -1, 18.5, true, {}, [], [18], '18abc', 'Infinity']) it(`rejects malformed or ineligible age ${JSON.stringify(age)}`, () => {
    expect(check({ ...approvedRegistration, age }).record).to.equal(null);
  });
  for (const termsAccepted of [false, 'false', 1, '1', {}, undefined]) it(`requires explicit consent ${JSON.stringify(termsAccepted)}`, () => {
    expect(check({ ...approvedRegistration, termsAccepted }).res.body.code).to.equal('TERMS_CONSENT_REQUIRED');
  });
  it('uses server timestamp, channel, version and canonical hash, ignoring supplied consent records', () => {
    const { record } = check({ ...approvedRegistration, registrationConsent: { acceptedAt: 'fake', version: 'fake' } });
    expect(record.consent.acceptedAt).to.equal(now); expect(record.consent.channel).to.equal('email');
    expect(record.consent.version).to.equal(approvedRegistration.termsVersion);
  });
  it('accepts the exact eighteenth birthday and multipart true', () => {
    expect(check({ ...approvedRegistration, termsAccepted: 'true', dateOfBirth: '2008-11-16' }).record.age).to.equal(18);
  });
  for (const dateOfBirth of ['2008-11-17', '2020-02-30', '2000-01-01junk', '2030-01-01', '2000-13-01']) it(`DOB cannot be bypassed with adult age: ${dateOfBirth}`, () => {
    expect(check({ ...approvedRegistration, dateOfBirth }).record).to.equal(null);
  });
});
