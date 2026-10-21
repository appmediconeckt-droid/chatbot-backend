// Read-only validation. Does not reset passwords, enable accounts or write legacy OTP config.
import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../src/models/userModel.js";
import { DEMO_ACCOUNT_EMAILS } from "../src/models/demoOtpConfigModel.js";

const password = process.env.DEMO_ACCOUNT_PASSWORD;
if (!password) throw new Error("Set DEMO_ACCOUNT_PASSWORD for read-only credential validation.");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
try {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const accounts = await User.find({ email: { $in: DEMO_ACCOUNT_EMAILS } })
    .select("email role password isActive demoPaymentsEnabled").lean();
  if (accounts.length !== DEMO_ACCOUNT_EMAILS.length) throw new Error("All four review accounts must exist.");
  for (const account of accounts) {
    const expectedRole = account.email.includes("counsellor") ? "counsellor" : "user";
    const valid = account.role === expectedRole && account.isActive === true &&
      Boolean(account.password) &&
      await bcrypt.compare(password, account.password);
    console.log(JSON.stringify({ email: account.email, credentialSetupValid: valid, simulationEnabled: account.demoPaymentsEnabled === true }));
    if (!valid) process.exitCode = 1;
  }
  console.log("Read-only validation complete. Synthetic-data isolation and live release verification are separate required checks.");
} catch {
  console.error("Review setup validation failed; no records were changed."); process.exitCode = 1;
} finally { await mongoose.disconnect(); }
