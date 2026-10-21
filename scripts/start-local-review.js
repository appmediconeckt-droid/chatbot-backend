// Disposable localhost-only test environment. Never seeds the .env database.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
dotenv.config({ quiet: true });
const mongo = await MongoMemoryServer.create({ instance: { ip: '127.0.0.1', dbName: 'humaeli_local_review' } });
process.env.MONGO_URI = mongo.getUri();
process.env.NODE_ENV = 'development';
process.env.ACCESS_SECRET = randomBytes(48).toString('hex');
process.env.REFRESH_SECRET = randomBytes(48).toString('hex');
process.env.JWT_SECRET = process.env.ACCESS_SECRET;
process.env.APP_REVIEW_ENABLED = 'true';
process.env.APP_REVIEW_TEST_EMAILS = 'audit.user@example.test,audit.consultant@example.test';
process.env.APP_REVIEW_OTP = String(Math.floor(100000 + Math.random() * 900000));
process.env.APP_REVIEW_EXPIRES_AT = new Date(Date.now() + 4 * 3600000).toISOString();
const { default: User } = await import('../src/models/userModel.js');
const { default: DemoOtpConfig } = await import('../src/models/demoOtpConfigModel.js');
await mongoose.connect(process.env.MONGO_URI);
const password = await bcrypt.hash('AuditLocal!2026Only', 10);
const account = (email, role, demo = false) => ({
  email, role, password, fullName: role === 'user' ? 'Local Audit User' : 'Local Audit Consultant',
  anonymous: 'Local Audit', hasPassword: true, authProvider: 'local',
  isActive: true, isEmailVerified: true, isPhoneVerified: true, isVerified: true,
  profileCompleted: true, age: 30, gender: 'other', isOnline: true,
  phoneNumber: role === 'user' ? (demo ? '9000000011' : '9000000012') : (demo ? '9000000013' : '9000000014'),
  phoneCountryCode: '+91', qualification: 'M.Sc. Psychology', education: 'M.Sc. Psychology',
  specialization: ['Mental Wellness'], experience: 5, languages: ['English', 'Hindi'],
  consultationMode: ['online'], consultationFee: 0, location: 'Local test', aboutMe: 'Disposable local audit profile',
  demoPaymentsEnabled: demo, demoWalletBalance: demo && role === 'user' ? 2000 : 0,
  locationData: { current: { type: 'Point', coordinates: [0, 0], city: 'Local test' } },
});
const seeded = await User.create([
  account('audit.user@example.test', 'user'),
  account('audit.consultant@example.test', 'counsellor'),
  account('appstore.user@humaeli.com', 'user', true),
  account('appstore.counsellor@humaeli.com', 'counsellor', true),
  account('audit.api.user@example.test', 'user'),
  account('audit.api.consultant@example.test', 'counsellor'),
  account('audit.delete.user@example.test', 'user'),
  account('audit.admin@example.test', 'admin'),
].map((item, index) => ({ ...item, phoneNumber: `90000000${String(index + 20).padStart(2, '0')}` })));
const descriptor = { mongoUri: mongo.getUri(), accounts: seeded.map(user => ({ id: String(user._id), email: user.email, role: user.role })), openaiRequests: 0, openaiResponses: [] };
const saveDescriptor = () => writeFileSync('/tmp/humaeli-local-review-runtime.json', JSON.stringify(descriptor), { mode: 0o600 });
saveDescriptor();
await DemoOtpConfig.create(['appstore.user@humaeli.com','appstore.counsellor@humaeli.com'].map(email => ({ email, enabled: true, otp: '123456', expiresAt: new Date(Date.now() + 4 * 3600000) })));
// Observe only request counts/status for verification; never log headers/bodies.
const originalFetch = globalThis.fetch;
let openaiRequests = 0;
globalThis.fetch = async (url, options) => {
  if (String(url).startsWith('https://api.openai.com/')) {
    openaiRequests += 1;
    descriptor.openaiRequests = openaiRequests; saveDescriptor();
    console.log(`[Local audit] OpenAI request #${openaiRequests}`);
  }
  const response = await originalFetch(url, options);
  if (String(url).startsWith('https://api.openai.com/')) {
    descriptor.openaiResponses.push({ status: response.status, requestId: response.headers.get('x-request-id') }); saveDescriptor();
  }
  return response;
};
const { default: server } = await import('../src/app.js');
server.listen(5006, '127.0.0.1', () => console.log('Local disposable review API ready at http://127.0.0.1:5006 (no production records)'));
const stop = async () => {
  server.close();
  await mongoose.disconnect();
  await mongo.stop();
  process.exit(0);
};
process.once('SIGINT', stop); process.once('SIGTERM', stop);
