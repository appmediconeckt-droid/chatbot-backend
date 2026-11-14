import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
// Build 21 now preserves permission-backed features; authorization must still fail closed.
import { expect } from 'chai';
import sinon from 'sinon';
import express from 'express';
import request from 'supertest';
import calls from '../src/routes/callRoutes.js';
import video from '../src/routes/videoRoutes.js';
import location from '../src/routes/locationRoutes.js';
import notifications from '../src/routes/notificationRoutes.js';
import { sendPushNotification } from '../src/services/pushNotificationService.js';
import { messaging } from '../src/config/firebaseAdmin.js';
import { installSocketSessionValidation } from '../src/services/socketSession.js';
const app=express(); app.use(express.json());
app.use('/api/call',calls); app.use('/api/video',video); app.use('/api/location',location); app.use('/api/notifications',notifications);
describe('Restored feature authorization boundaries', () => {
  afterEach(() => sinon.restore());
  for (const [method,path] of [['post','/api/call/initiate'],['get','/api/video/stream/token'],['post','/api/location/update'],['post','/api/notifications/register-token']]) {
    it(`${path} still requires authentication`, async () => { expect((await request(app)[method](path).send({})).status).to.equal(401); });
  }
  it('restores Firebase delivery with private iOS previews and opaque routing data', async () => {
    const send=sinon.stub(messaging,'send').resolves('synthetic-message');
    await sendPushNotification({ token:'synthetic-device',platform:'ios',title:'Private title',body:'Clinical text',data:{ type:'CHAT_MESSAGE',chatId:'opaque-chat',content:'Clinical text',senderName:'Private name' } });
    expect(send.calledOnce).to.equal(true); const payload=send.firstCall.args[0];
    expect(JSON.stringify(payload)).not.to.include('Clinical text'); expect(JSON.stringify(payload)).not.to.include('Private name');
    expect(payload.data.chatId).to.equal('opaque-chat'); expect(payload.notification.title).to.equal('Humaeli');
  });
  for (const role of ['user','counsellor']) it(`${role}: active sessions can reach restored media signaling handlers`, async () => {
    sinon.stub(Session, 'exists').resolves({ _id: 'session-fixture' });
    sinon.stub(User, 'findById').resolves({ isActive: true, role });
    let intercept, cleanup;
    const socket = { sessionId: 'session-fixture', userId: 'user-fixture', userRole: role, tokenExpiresAt: Date.now()/1000+60, use(fn){intercept=fn;}, once(_name,fn){cleanup=fn;}, disconnect: sinon.spy() };
    installSocketSessionValidation(socket);
    try {
      for (const event of ['join-call','call-offer','offer','answer','ice-candidate']) {
        const next = sinon.spy(); await intercept([event, { callId: 'fixture' }], next);
        expect(next.calledOnce).to.equal(true); expect(next.firstCall.args).to.have.length(0);
      }
      expect(socket.disconnect.called).to.equal(false);
    } finally { cleanup(); }
  });
  it('revoked socket sessions cannot signal after restoration', async () => {
    let intercept,cleanup;
    const socket={ use(fn){intercept=fn;},once(_name,fn){cleanup=fn;},disconnect:sinon.spy(),tokenExpiresAt:0 };
    installSocketSessionValidation(socket); const next=sinon.spy(); await intercept(['call-offer',{}],next);
    expect(next.firstCall.args[0].message).to.equal('AUTH_SESSION_INACTIVE'); expect(socket.disconnect.called).to.equal(true); cleanup();
  });
});
