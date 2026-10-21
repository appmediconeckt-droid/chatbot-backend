// End-to-end HTTP checks against review:local only. No production URL accepted.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import mongoose from 'mongoose';
import User from '../src/models/userModel.js';
import Transaction from '../src/models/transactionModel.js';
import CounselorEarning from '../src/models/CounselorEarning.js';
import Chat from '../src/models/Chat.js';
import Message from '../src/models/Message.js';
import UserBlock from '../src/models/UserBlock.js';
import AbuseReport from '../src/models/AbuseReport.js';
import AIConsent from '../src/models/AIConsent.js';
import Session from '../src/models/sessionModel.js';
const base = 'http://127.0.0.1:5006';
const runtimePath = '/tmp/humaeli-local-review-runtime.json';
const runtime = JSON.parse(readFileSync(runtimePath, 'utf8'));
if (!/^mongodb:\/\/127\.0\.0\.1:/.test(runtime.mongoUri)) throw new Error('Disposable localhost database required');
const rows = [];
const check = (feature, ok, evidence) => { rows.push({ feature, status: ok ? 'PASS' : 'FAIL', evidence }); if (!ok) throw new Error(`${feature}: ${evidence}`); };
const http = async (method, path, token, body) => {
 const response = await fetch(`${base}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(70000) });
 const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { html: text.includes('<html') }; }
 return { status: response.status, data };
};
const login = async (email, role) => {
 const result = await http('POST', '/api/auth/login', null, { email, role, password: 'AuditLocal!2026Only' });
 check(`${role} password login (${email})`, result.status === 200 && Boolean(result.data.accessToken), `HTTP ${result.status}`);
 return result.data;
};
const provider = () => JSON.parse(readFileSync(runtimePath, 'utf8'));
const id = email => runtime.accounts.find(a => a.email === email).id;
try {
 await mongoose.connect(runtime.mongoUri);
 // Reset only this disposable API fixture set so reruns do not affect either
 // simulator's separate UI account or rely on a login bypass endpoint.
 await Session.updateMany({ userId: { $in: runtime.accounts.filter(a => /audit\.api\.|audit\.admin@|audit\.delete\.|appstore\./.test(a.email)).map(a => a.id) } }, { $set: { isActive: false } });
 const fixtureUserId = id('audit.api.user@example.test');
 await Promise.all([Chat.deleteMany({ userId: fixtureUserId }), Message.deleteMany({ senderId: fixtureUserId }), UserBlock.deleteMany({ blockerId: fixtureUserId }), AbuseReport.deleteMany({ reporterId: fixtureUserId }), AIConsent.deleteMany({ userId: fixtureUserId })]);
 const user = await login('audit.api.user@example.test', 'user');
 const consultant = await login('audit.api.consultant@example.test', 'counsellor');
 const admin = await login('audit.admin@example.test', 'admin');
 let u = user.accessToken, c = consultant.accessToken;
 for (const [name, token] of [['User', u], ['Consultant', c]]) {
  const result = await http('GET', '/api/auth/me', token);
  check(`${name} own profile`, result.status === 200, `HTTP ${result.status}`);
 }
 let result = await http('GET', '/api/auth/counsellors', u);
 check('Consultant directory', result.status === 200, `HTTP ${result.status}`);
 result = await http('PATCH', `/api/auth/update/${id('audit.api.user@example.test')}`, u, { demoPaymentsEnabled: true, walletBalance: 999999, fullName: 'Local API Audit User' });
 const owner = await User.findById(id('audit.api.user@example.test'));
 check('Profile update cannot enable simulation or fabricate funds', result.status === 200 && owner.demoPaymentsEnabled === false && owner.walletBalance === 0, `HTTP ${result.status}; server-managed fields unchanged`);
 result = await http('GET', '/api/wallet/data', u);
 check('Ordinary wallet has no financial balance', result.status === 200 && result.data.paymentMode === 'free' && result.data.balance === 0 && result.data.simulationEnabled === false, `HTTP ${result.status}; free mode, balance 0`);
 result = await http('POST', '/api/wallet/demo-payment', u, { amount: 100, requestId: 'public_spoof_001', demoPaymentsEnabled: true });
 check('Ordinary account cannot activate demo top-ups', result.status === 403, `HTTP ${result.status}`);
 for (const route of ['create-order','verify-payment','reconcile-payment']) {
  result = await http('POST', `/api/wallet/${route}`, u, { amount: 100 });
  check(`Real payment operation ${route}`, result.status === 403 && result.data.code === 'REAL_PAYMENTS_DISABLED', `HTTP ${result.status}; no provider work`);
 }
 result = await http('POST', '/api/wallet/withdraw', c, { amount: 100 });
 check('Consultant withdrawals disabled', result.status === 403, `HTTP ${result.status}`);
 const date = new Date(Date.now() + 86400000).toISOString();
 const counselorId = id('audit.api.consultant@example.test');
 result = await http('POST', '/api/appointments', u, { counselorId, date, paymentMode: 'free' });
 check('Free appointment booking', result.status === 201 && result.data.paymentMode === 'free' && result.data.paymentStatus === 'not_required' && !result.data.paymentTransactionId, `HTTP ${result.status}; pending, no payment transaction`);
 const appointmentId = result.data._id;
 result = await http('PATCH', `/api/appointments/${appointmentId}/status`, u, { status: 'confirmed' });
 check('User cannot self-confirm booking', result.status === 403, `HTTP ${result.status}`);
 result = await http('PATCH', `/api/appointments/${appointmentId}/status`, c, { status: 'confirmed' });
 check('Assigned Consultant confirms booking', result.status === 200 && result.data.appointment.status === 'confirmed', `HTTP ${result.status}`);
 result = await http('PATCH', `/api/appointments/${appointmentId}/status`, u, { status: 'canceled' });
 check('User cancels own future appointment', result.status === 200 && result.data.appointment.status === 'canceled', `HTTP ${result.status}`);
 result = await http('PATCH', `/api/appointments/${appointmentId}/status`, c, { status: 'confirmed' });
 check('Canceled appointment cannot be re-confirmed', result.status === 409, `HTTP ${result.status}`);
 result = await http('POST', '/api/chat/start', u, { counselorId });
 check('Free chat request without wallet money', result.status === 200 && result.data.chat?.paidMode === false && result.data.chat?.paymentStatus === 'free' && result.data.chat?.amount === 0, `HTTP ${result.status}`);
 const chatId = result.data.chat.id || result.data.chat._id;
 result = await http('PATCH', `/api/chat/accept/${chatId}`, c, {});
 check('Consultant accepts free chat', result.status === 200, `HTTP ${result.status}`);
 result = await http('POST', `/api/chat/chat/${chatId}/message`, u, { content: 'Synthetic local audit message' });
 check('User sends a message', result.status === 200 || result.status === 201, `HTTP ${result.status}`);
 const message = result.data.message;
 const messageId = message?.id || message?._id;
 result = await http('GET', `/api/chat/chat/${chatId}/messages`, c);
 check('Consultant receives message history', result.status === 200 && JSON.stringify(result.data).includes('Synthetic local audit message'), `HTTP ${result.status}`);
 result = await http('POST', `/api/chat/safety/${chatId}/report`, u, { reason: 'spam', details: 'Disposable local moderation test' });
 check('Participant report creation', result.status === 201, `HTTP ${result.status}`);
 const reportId = result.data.reportId || result.data.report?._id;
 result = await http('GET', '/api/chat/moderation/reports', u);
 check('Ordinary user denied admin moderation', result.status === 403, `HTTP ${result.status}`);
 result = await http('GET', '/api/chat/moderation/reports', admin.accessToken);
 check('Admin report queue', result.status === 200 && result.data.reports.length > 0, `HTTP ${result.status}`);
 const reportedId = reportId || result.data.reports[0]._id;
 result = await http('GET', `/api/chat/moderation/reports/${reportedId}`, admin.accessToken);
 check('Admin can review report context', result.status === 200, `HTTP ${result.status}`);
 const moderationMessageId = messageId || result.data.messages.find(m => m.content === 'Synthetic local audit message')?._id;
 result = await http('PATCH', `/api/chat/moderation/reports/${reportedId}/messages/${moderationMessageId}`, admin.accessToken, { hidden: true });
 check('Admin hides reported content', result.status === 200, `HTTP ${result.status}`);
 result = await http('PATCH', `/api/chat/moderation/reports/${reportedId}`, admin.accessToken, { status: 'resolved' });
 check('Admin resolves report', result.status === 200, `HTTP ${result.status}`);
 result = await http('PUT', `/api/chat/safety/${chatId}/block`, u, { blocked: true });
 check('User blocks Consultant', result.status === 200, `HTTP ${result.status}`);
 result = await http('POST', `/api/chat/chat/${chatId}/message`, c, { content: 'This must be blocked' });
 check('Block enforced on messages', result.status === 403, `HTTP ${result.status}`);
 await http('PUT', `/api/chat/safety/${chatId}/block`, u, { blocked: false });
 check('Free workflows create no money or earnings', await Transaction.countDocuments({ userId: id('audit.api.user@example.test') }) === 0 && await CounselorEarning.countDocuments({ counselorId }) === 0, 'No transactions or earnings for ordinary accounts');
 const before = provider().openaiRequests;
 result = await http('POST', '/api/ai-chat/send-message', u, { message: 'Synthetic message with no consent' });
 check('Server refuses AI before consent', result.status === 403 && result.data.code === 'AI_CONSENT_REQUIRED' && provider().openaiRequests === before, `HTTP ${result.status}; provider request count unchanged`);
 result = await http('POST', '/api/ai/consent', u, { accepted: false, consentVersion: 'openai-ai-v1' });
 check('No implicit AI acceptance', result.status === 400 && provider().openaiRequests === before, `HTTP ${result.status}`);
 await http('POST', '/api/ai/consent', u, { accepted: true, consentVersion: 'openai-ai-v1' });
 result = await http('POST', '/api/ai-chat/send-message', u, { message: 'I am at home alone. Please suggest one gentle grounding exercise.' });
 const aiSessionId = result.data.data?.sessionId;
 if (provider().openaiRequests === before && result.status === 200) result = await http('POST', '/api/ai-chat/send-message', u, { sessionId: aiSessionId, message: 'Please explain the gentle grounding exercise in two sentences.' });
 check('Actual OpenAI response after explicit consent', result.status === 200 && provider().openaiRequests > before && provider().openaiResponses.some(r => r.status === 200), `HTTP ${result.status}; actual OpenAI HTTP 200 observed`);
 const afterResponse = provider().openaiRequests;
 result = await http('POST', '/api/ai-chat/send-message', u, { sessionId: aiSessionId, message: 'Synthetic crisis audit: I want to kill myself' });
 const responseText = result.data.data?.aiResponse || '';
 check('Crisis response gives urgent guidance without fabricated dispatch', result.status === 200 && /emergency/.test(responseText) && /cannot/.test(responseText) && !/connecting you|reach out to you shortly|\d{7,}/i.test(responseText) && provider().openaiRequests === afterResponse, `HTTP ${result.status}; deterministic safety response; no extra OpenAI request`);
 result = await http('DELETE', '/api/ai/consent', u);
 check('Consent withdrawal persisted', result.status === 200 && result.data.consented === false, `HTTP ${result.status}`);
 result = await http('POST', '/api/ai-chat/send-message', u, { message: 'Synthetic message after withdrawal' });
 check('Withdrawal blocks future provider transmission', result.status === 403 && provider().openaiRequests === afterResponse, `HTTP ${result.status}; provider count unchanged`);
 for (const [name, session] of [['User', user], ['Consultant', consultant]]) {
  const refreshed = await http('POST', '/api/auth/refresh-token', null, { refreshToken: session.refreshToken });
  const token = refreshed.data.accessToken || refreshed.data.data?.accessToken;
  check(`${name} refresh`, refreshed.status === 200 && Boolean(token), `HTTP ${refreshed.status}`);
  result = await http('GET', '/api/auth/me', token);
  check(`${name} authenticated access after refresh`, result.status === 200, `HTTP ${result.status}`);
  await http('POST', '/api/auth/logout', token, { refreshToken: refreshed.data.refreshToken });
  result = await http('GET', '/api/auth/me', token);
  check(`${name} logout revokes access`, result.status === 401, `HTTP ${result.status}`);
 }
 const demo = await login('appstore.user@humaeli.com', 'user');
 result = await http('POST', '/api/wallet/demo-payment', demo.accessToken, { amount: 100, requestId: 'local_demo_retry_001' });
 const creditedBalance = result.data.balance;
 check('Designated account demo top-up', result.status === 200 && result.data.status === 'demo_completed' && result.data.redeemable === false, `HTTP ${result.status}`);
 result = await http('POST', '/api/wallet/demo-payment', demo.accessToken, { amount: 100, requestId: 'local_demo_retry_001' });
 check('Demo retry credits once', result.status === 200 && result.data.balance === creditedBalance && result.data.alreadyCredited === true, `HTTP ${result.status}; same demo balance`);
 result = await http('POST', '/api/auth/login', null, { email: 'appstore.user@humaeli.com', password: 'AuditLocal!2026Only', role: 'user' });
 check('Another-device login requires verification', result.status === 409, `HTTP ${result.status}`);
 await http('POST', '/api/auth/logout-other-devices', null, { email: 'appstore.user@humaeli.com' });
 result = await http('POST', '/api/auth/verify-login-otp', null, { email: 'appstore.user@humaeli.com', otp: '000000' });
 check('Wrong demo OTP rejected', result.status === 400, `HTTP ${result.status}`);
 result = await http('GET', '/api/auth/me', demo.accessToken);
 check('Wrong OTP does not revoke current session', result.status === 200, `HTTP ${result.status}`);
 result = await http('POST', '/api/auth/verify-login-otp', null, { email: 'appstore.user@humaeli.com', otp: '123456' });
 check('Scoped expiring demo OTP accepted', result.status === 200 && Boolean(result.data.accessToken), `HTTP ${result.status}`);
 result = await http('GET', '/api/auth/me', demo.accessToken);
 check('Verified replacement revokes first device token', result.status === 401, `HTTP ${result.status}`);
 const disposable = await login('audit.delete.user@example.test', 'user');
 result = await http('DELETE', '/api/auth/delete', disposable.accessToken);
 check('Disposable local account deletion', result.status === 200 && !await User.exists({ _id: id('audit.delete.user@example.test') }) && !await Session.exists({ userId: id('audit.delete.user@example.test') }), `HTTP ${result.status}; account and sessions removed`);
 result = await http('GET', '/api/auth/me', disposable.accessToken);
 check('Deleted account token is rejected', result.status === 401, `HTTP ${result.status}`);
} catch (error) {
 rows.push({ feature: 'Audit completion', status: 'FAIL', evidence: error.message });
 process.exitCode = 1;
} finally {
 await mongoose.disconnect();
 const out = process.env.HUMAELI_AUDIT_OUTPUT || '/tmp/humaeli-local-api-audit.json';
 writeFileSync(out, JSON.stringify({ target: base, database: 'disposable localhost MongoDB', checkedAt: new Date().toISOString(), rows }, null, 2));
 console.log(JSON.stringify({ passed: rows.filter(r => r.status === 'PASS').length, failed: rows.filter(r => r.status === 'FAIL').length, report: out }));
}
