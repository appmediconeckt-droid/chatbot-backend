import UserBlock from '../src/models/UserBlock.js';
import { expect } from 'chai';
import mongoose from 'mongoose';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import sinon from 'sinon';
import { StreamChat } from 'stream-chat';
import User from '../src/models/userModel.js';
import Session from '../src/models/sessionModel.js';
import Call from '../src/models/Call.js';
import Notification from '../src/models/Notification.js';
import AccountDeletionJob from '../src/models/AccountDeletionJob.js';
import video from '../src/routes/videoRoutes.js';
import calls from '../src/routes/callRoutes.js';
import location from '../src/routes/locationRoutes.js';
import notifications from '../src/routes/notificationRoutes.js';
import authRoutes from '../src/routes/authRoutes.js';
import { createNotification } from '../src/services/notificationService.js';
import { messaging } from '../src/config/firebaseAdmin.js';
import { requestAccountDeletion } from '../src/services/accountDeletionService.js';
const local=process.env.AUDIT_ISOLATED_ENV==='true' && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(process.env.MONGO_URI||'');
(local ? describe : describe.skip)('Restored Build 21 HTTP integration (disposable MongoDB only)', function(){
 this.timeout(30000);
 const app=express(); app.use(express.json()); app.use('/api/video',video); app.use('/api/call',calls); app.use('/api/location',location); app.use('/api/notifications',notifications); app.use('/api/auth',authRoutes);
 let user,consultant,outsider,tokens;
 before(async()=>{ await mongoose.connect(process.env.MONGO_URI); await Promise.all([User.init(),Session.init(),Call.init(),Notification.init(),AccountDeletionJob.init()]); });
 after(async()=>{ await mongoose.disconnect(); delete process.env.STREAM_API_KEY; delete process.env.STREAM_API_SECRET; });
 beforeEach(async()=>{
  for(const model of Object.values(mongoose.models)) await model.deleteMany({});
  const fixture=role=>({ fullName:'Synthetic fixture',email:`${new mongoose.Types.ObjectId()}@example.test`,role,authProvider:'google',googleId:String(new mongoose.Types.ObjectId()),isActive:true,isOnline:true,profileCompleted:true,qualification:'Fixture',experience:0,location:'Fixture city',locationData:{current:{type:'Point',coordinates:[0,0]},history:[]} });
  [user,consultant,outsider]=await User.create([fixture('user'),fixture('counsellor'),fixture('user')]); tokens={};
  for(const account of [user,consultant,outsider]){const session=await Session.create({userId:account._id,refreshToken:`fixture-${account._id}`});tokens[String(account._id)]=jwt.sign({userId:String(account._id),role:account.role,sessionId:String(session._id)},process.env.ACCESS_SECRET,{expiresIn:600});}
 });
 afterEach(()=>sinon.restore());
 const auth=(req,account)=>req.set('Authorization',`Bearer ${tokens[String(account._id)]}`);
 for(const role of ['user','counsellor']){
  it(`${role}: explicit location persists only for the authenticated account and admin routes remain restricted`,async()=>{
   const account=role==='user'?user:consultant;
   sinon.stub(globalThis,'fetch').resolves({ok:true,json:async()=>({display_name:'Synthetic place',address:{city:'Fixture'}})});
   const response=await auth(request(app).post('/api/location/update'),account).send({latitude:12,longitude:77,event:'manual',userId:outsider._id});
   expect(response.status).to.equal(200);expect(response.body.data.userId).to.equal(String(account._id));
   const stored=await User.findById(account._id);expect(stored.locationData.current.coordinates).to.deep.equal([77,12]);expect(stored.locationData.history).to.have.length(1);
   expect((await User.findById(outsider._id)).locationData.history).to.have.length(0);
   expect((await auth(request(app).post('/api/location/update'),account).send({latitude:12,longitude:77,event:'login'})).status).to.equal(400);
   expect((await auth(request(app).get('/api/location/admin/all'),account)).status).to.equal(403);
  });
  it(`${role}: notification tokens and inbox operations enforce ownership`,async()=>{
   const account=role==='user'?user:consultant;
   const post=body=>auth(request(app).post('/api/notifications/register-token'),account).send(body);
   expect((await post({userId:outsider._id,fcmToken:'fixture',platform:'ios'})).status).to.equal(403);
   expect((await post({fcmToken:{$ne:null},platform:'ios'})).status).to.equal(400);
   expect((await post({fcmToken:'fixture',platform:'unexpected'})).status).to.equal(400);
   await User.updateOne({_id:outsider._id},{$set:{fcmToken:'same-device'}});
   expect((await post({userId:account._id,fcmToken:'same-device',platform:'ios'})).status).to.equal(200);
   expect((await User.findById(account._id)).fcmToken).to.equal('same-device');expect((await User.findById(outsider._id)).fcmToken).to.equal(null);
   const send=sinon.stub(messaging,'send').resolves('fixture-message');
   expect((await auth(request(app).post('/api/notifications/test'),account).send({token:'unowned-device'})).status).to.equal(403);
   expect(send.called).to.equal(false);
   expect((await auth(request(app).post('/api/notifications/test'),account).send({token:'same-device',platform:'ios'})).status).to.equal(200);
   expect(send.calledOnce).to.equal(true); send.resetHistory();
   const notice=await createNotification({recipientId:account._id,type:'message',title:'Fixture',message:'Private fixture',data:{chatId:'opaque',content:'Private fixture'}});
   expect(send.calledOnce).to.equal(true);expect(JSON.stringify(send.firstCall.args[0])).not.to.include('Private fixture');
   const list=await auth(request(app).get('/api/notifications'),account);expect(list.status).to.equal(200);expect(list.body.notifications.map(n=>n._id)).to.include(String(notice._id));
   expect((await auth(request(app).patch(`/api/notifications/${notice._id}/read`),outsider)).status).to.equal(404);
   expect((await auth(request(app).patch(`/api/notifications/${notice._id}/read`),account)).status).to.equal(200);
   expect((await auth(request(app).delete(`/api/notifications/${notice._id}`),outsider)).status).to.equal(404);
   expect((await auth(request(app).delete(`/api/notifications/${notice._id}`),account)).status).to.equal(200);
   expect((await auth(request(app).post('/api/auth/logout'),account)).status).to.equal(200);
   expect((await User.findById(account._id)).fcmToken).to.equal(null);
  });
 }
 it('video initiation, receiver acceptance, details, scoped token renewal and end integrate without bypassing authorization',async()=>{
  const created=await auth(request(app).post('/api/video/calls/initiate'),user).send({receiverId:consultant._id,receiverType:'counsellor',callType:'audio'});
  expect(created.status,JSON.stringify(created.body)).to.equal(201);const callId=created.body.callId||created.body.call?.id||created.body.call?.callId;
  expect(callId).to.be.a('string');
  expect((await auth(request(app).get('/api/video/stream/token').query({callId}),user)).status).to.equal(403);
  expect((await auth(request(app).get(`/api/video/calls/${callId}/details`),outsider)).status).to.equal(403);
  expect((await auth(request(app).put(`/api/video/calls/${callId}/accept`),user).send({acceptorId:user._id})).status).to.equal(403);
  const block=await UserBlock.create({blockerId:consultant._id,blockedId:user._id,enabled:true});
  expect((await auth(request(app).put(`/api/video/calls/${callId}/accept`),consultant).send({acceptorId:consultant._id,acceptorType:'counsellor'})).status).to.equal(403);
  await UserBlock.deleteOne({_id:block._id});
  const accepted=await auth(request(app).put(`/api/video/calls/${callId}/accept`),consultant).send({acceptorId:consultant._id,acceptorType:'counsellor'});
  expect(accepted.status,JSON.stringify(accepted.body)).to.equal(200);
  const details=await auth(request(app).get(`/api/video/calls/${callId}/details`),user);expect(details.body.call.status).to.equal('active');expect(details.body.call.acceptedAt).to.be.a('string');
  process.env.STREAM_API_KEY='synthetic-stream-key';process.env.STREAM_API_SECRET='synthetic-stream-secret';
  sinon.stub(StreamChat,'getInstance').returns({upsertUsers:sinon.stub().resolves({})});
  for(const account of [user,consultant]){const response=await auth(request(app).get('/api/video/stream/token').query({callId}),account);expect(response.status,JSON.stringify(response.body)).to.equal(200);const claims=jwt.verify(response.body.token,'synthetic-stream-secret');expect(claims.call_cids).to.deep.equal([`default:${callId}`]);expect(claims.exp-claims.iat).to.equal(300);}
  expect((await auth(request(app).get('/api/video/stream/token').query({callId}),outsider)).status).to.equal(403);
  expect((await auth(request(app).get(`/api/video/calls/history/${user._id}`),outsider)).status).to.equal(403);
  expect((await auth(request(app).put(`/api/video/calls/${callId}/end`),user).send({userId:outsider._id})).status).to.equal(403);
  expect((await auth(request(app).put(`/api/video/calls/${callId}/end`),user).send({userId:user._id})).status).to.equal(200);
  expect((await auth(request(app).get('/api/video/stream/token').query({callId}),user)).status).to.equal(403);
 });
 it('deletion revokes restored feature access without erasing retained records or sending notifications',async()=>{
  await User.updateOne({_id:user._id},{$set:{fcmToken:'old-token'}});await requestAccountDeletion(user);
  for(const endpoint of ['/api/video/stream/token','/api/notifications','/api/call/active/current']) expect((await auth(request(app).get(endpoint),user)).status).to.equal(401);
  expect((await auth(request(app).post('/api/location/update'),user).send({latitude:12,longitude:77,event:'manual'})).status).to.equal(401);
  const send=sinon.stub(messaging,'send');expect(await createNotification({recipientId:user._id,type:'message',title:'Fixture',message:'Fixture'})).to.equal(null);expect(send.called).to.equal(false);expect(await User.findById(user._id)).not.to.equal(null);
 });
});
