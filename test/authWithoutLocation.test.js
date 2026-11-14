import { expect } from 'chai';
import sinon from 'sinon';
import bcrypt from 'bcryptjs';
import { loginUser } from '../src/controllers/authController.js';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';

// Model stubs isolate authentication from GPS, geocoding and external services.
describe('Password authentication ignores GPS data', () => {
  afterEach(() => sinon.restore());
  for (const role of ['user', 'counsellor']) {
    for (const coordinates of [{}, { latitude: null, longitude: '' }, { latitude: 12, longitude: 77 }, { latitude: 'unavailable', longitude: 'denied' }]) {
      it(`${role} succeeds with ${JSON.stringify(coordinates)} without writing location`, async () => {
        const user = { _id: '100000000000000000000001', role, isActive: true, password: 'hash', toJSON: () => ({ role }) };
        sinon.stub(User, 'findOne').resolves(user);
        sinon.stub(bcrypt, 'compare').resolves(true);
        sinon.stub(Session, 'updateMany').resolves({});
        sinon.stub(Session, 'findOne').resolves(null);
        sinon.stub(Session, 'create').resolves({});
        const updates = sinon.stub(User, 'findByIdAndUpdate').resolves(user);
        const res = { status: sinon.stub().returnsThis(), json: sinon.stub().returnsThis(), cookie: sinon.stub().returnsThis() };
        await loginUser({ body: { email: 'existing@example.test', password: 'Password42!', role, ...coordinates }, headers: {}, socket: {} }, res);
        expect(res.status.calledWith(200)).to.equal(true);
        expect(res.json.firstCall.args[0].success).to.equal(true);
        expect(updates.callCount).to.equal(1);
        expect(updates.firstCall.args[1]).to.deep.equal({ $set: { isOnline: true, lastSeen: null } });
      });
    }
  }
});
