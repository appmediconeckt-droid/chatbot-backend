import { expect } from 'chai';
import { detectCrisis, generateCrisisResponse } from '../src/services/crisisDetectionService.js';
describe('Crisis response accuracy', () => {
 it('detects direct immediate self-harm language', () => expect(detectCrisis('I want to kill myself').level).to.equal('critical'));
 for (const level of ['critical', 'high']) it(`${level} support never fabricates emergency dispatch or callback`, () => {
  const response = generateCrisisResponse(level);
  expect(response).to.match(/local emergency services|emergency department/);
  expect(response).to.match(/cannot/);
  expect(response).not.to.match(/connecting you|reach out to you shortly|\d{7,}/i);
 });
});
