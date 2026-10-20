import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../src/models/userModel.js";
import DemoOtpConfig, { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";

// This script only updates existing, explicitly approved demo accounts.
const password = process.env.DEMO_ACCOUNT_PASSWORD;
if (!password) throw new Error("Set DEMO_ACCOUNT_PASSWORD before running this script.");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const accounts = await User.find({ email: { $in: DEMO_ACCOUNT_EMAILS } }).select("email role password").lean();
  if (accounts.length !== DEMO_ACCOUNT_EMAILS.length) throw new Error("All four demo users must exist before configuration.");
  for (const account of accounts) {
    const expectedRole = account.email.includes("counsellor") ? "counsellor" : "user";
    if (account.role !== expectedRole) throw new Error(`Unexpected role for ${account.email}`);
  }

  await DemoOtpConfig.init();
  for (const account of accounts) {
    await DemoOtpConfig.updateOne({ email: account.email }, {
      $set: { otp: "123456", enabled: true },
    }, { upsert: true, runValidators: true });
    const config = await DemoOtpConfig.findOne({ email: account.email }).lean();
    if (!config.enabled || config.otp !== "123456") {
      throw new Error(`Verification failed for ${account.email}`);
    }
    const passwordMatches = Boolean(account.password && await bcrypt.compare(password, account.password));
    console.log(`Verified ${account.role}: ${account.email} — fixed OTP configured; supplied password matches: ${passwordMatches}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
