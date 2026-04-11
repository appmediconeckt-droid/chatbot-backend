// api/index.js
// Vercel serverless entry point
import dotenv from "dotenv";
dotenv.config();

import connectDB from "../src/config/db.js";
import { app } from "../src/app.js";

// Connect to DB before exporting
// This runs once per cold start, and the connection is cached
await connectDB();

export default app;
