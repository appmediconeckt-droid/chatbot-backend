// src/config/db.js
// Cached MongoDB connection for serverless environments (Vercel)
import mongoose from "mongoose";
import User from "../models/userModel.js";

let cachedConnection = null;

const PHONE_INDEX_NAME = "phoneNumber_1";

async function ensurePhoneNumberIndex() {
  const collection = User.collection;
  const indexes = await collection.indexes();
  const phoneIndex = indexes.find((index) => index.name === PHONE_INDEX_NAME);
  const expectedPartial = { phoneNumber: { $type: "string" } };

  const hasExpectedIndex =
    phoneIndex?.unique === true &&
    JSON.stringify(phoneIndex.partialFilterExpression) ===
      JSON.stringify(expectedPartial);

  if (hasExpectedIndex) return;

  if (phoneIndex) {
    console.warn(
      "⚠️ Rebuilding users.phoneNumber unique index as a partial index",
    );
    await collection.dropIndex(PHONE_INDEX_NAME);
  }

  await collection.createIndex(
    { phoneNumber: 1 },
    {
      unique: true,
      name: PHONE_INDEX_NAME,
      partialFilterExpression: expectedPartial,
    },
  );
}

async function connectDB() {
  // If already connected, reuse the connection
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  // If a connection is being established, wait for it
  if (mongoose.connection.readyState === 2) {
    await new Promise((resolve) => {
      mongoose.connection.once("connected", resolve);
    });
    cachedConnection = mongoose.connection;
    return cachedConnection;
  }

  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // These options help with serverless cold starts
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 0, // Allow pool to shrink to 0 when idle
    });

    cachedConnection = conn.connection;
    await ensurePhoneNumberIndex();
    console.log("✅ MongoDB Connected Successfully");
    return cachedConnection;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}

export default connectDB;
