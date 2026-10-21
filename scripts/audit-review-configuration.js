// Read-only audit of designated review accounts in the configured database.
import 'dotenv/config';
import dns from 'node:dns';
import mongoose from 'mongoose';
import User from '../src/models/userModel.js';
import DemoOtpConfig, { DEMO_ACCOUNT_EMAILS } from '../src/models/demoOtpConfigModel.js';
import Session from '../src/models/sessionModel.js';
dns.setServers(['8.8.8.8','1.1.1.1']);
try {
  await mongoose.connect(process.env.MONGO_URI, {serverSelectionTimeoutMS:10000});
  const result = { checkedAt:new Date().toISOString(), source:'local configured database; Railway database identity not independently established', accounts:[] };
  for (const email of DEMO_ACCOUNT_EMAILS) {
    const user=await User.findOne({email}).select('_id email role isActive demoPaymentsEnabled').lean();
    const config=await DemoOtpConfig.findOne({email}).select('enabled expiresAt').lean();
    result.accounts.push({email,exists:Boolean(user),role:user?.role,active:user?.isActive,simulation:user?.demoPaymentsEnabled,
      activeSessions:user?await Session.countDocuments({userId:user._id,isActive:true}):null,
      legacyFixedCodeEnabled:config?.enabled===true,legacyConfigExpiresAt:config?.expiresAt||null,
      legacyConfigPassesExpiry:Boolean(config?.enabled&&new Date(config.expiresAt||0).getTime()>Date.now())});
  }
  console.log(JSON.stringify(result,null,2));
} catch { console.error('Read-only database configuration audit unavailable');process.exitCode=1; }
finally {await mongoose.disconnect();}
