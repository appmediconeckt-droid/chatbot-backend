import { expect } from 'chai';
import sinon from 'sinon';
import { updateLocation } from '../src/controllers/locationController.js';
import User from '../src/models/userModel.js';
const response = () => ({ status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis() });
describe('Explicit-only location update validation', () => {
  afterEach(() => sinon.restore());
  for (const coordinates of [{ latitude: null, longitude: null }, { latitude: '', longitude: '' }, { latitude: false, longitude: true }, { latitude: [], longitude: [] }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: 181 }, { latitude: 12, longitude: 77, event: 'login' }, { latitude: 12, longitude: 77, event: 'signup' }, { latitude: 12, longitude: 77, event: { $ne: null } }]) {
    it(`rejects invalid or automatic input ${JSON.stringify(coordinates)}`, async () => {
      const update = sinon.stub(User, 'findByIdAndUpdate');
      const outbound = sinon.stub(globalThis, 'fetch'); const res = response();
      await updateLocation({ body: coordinates, user: { _id: '100000000000000000000001' } }, res);
      expect(res.status.calledWith(400)).to.equal(true);
      expect(update.called).to.equal(false); expect(outbound.called).to.equal(false);
    });
  }
  it('preserves legitimate zero coordinates and bounded manual history', async () => {
    const outbound = sinon.stub(globalThis, 'fetch').resolves({ ok: true, json: async () => ({ display_name: 'Synthetic address', address: { city: 'Fixture city' } }) });
    const update = sinon.stub(User, 'findByIdAndUpdate').returns({ select: async () => ({ _id: '100000000000000000000001', role: 'user', locationData: { current: { coordinates: [0, 0] } } }) });
    const res = response();
    await updateLocation({ body: { latitude: 0, longitude: 0, event: 'manual' }, user: { _id: '100000000000000000000001' }, headers: {}, socket: {} }, res);
    expect(res.status.calledWith(200)).to.equal(true); expect(outbound.calledOnce).to.equal(true);
    expect(update.firstCall.args[1].$push['locationData.history'].$slice).to.equal(-20);
    expect(update.firstCall.args[1].$set['locationData.current'].coordinates).to.deep.equal([0, 0]);
  });
});
