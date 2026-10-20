import "dotenv/config";
import mongoose from "mongoose";
import AIConsent from "../src/models/AIConsent.js";
try {
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 10000,
  });
  await AIConsent.createIndexes();
  console.log(
    "AI consent indexes created. No existing accounts were opted in."
  );
} finally {
  await mongoose.disconnect();
}
