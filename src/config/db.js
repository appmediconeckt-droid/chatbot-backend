// src/config/db.js
// Cached MongoDB connection for serverless environments (Vercel)
import mongoose from "mongoose";

let cachedConnection = null;

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
    console.log("✅ MongoDB Connected Successfully");
    return cachedConnection;
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    throw error;
  }
}

export default connectDB;
