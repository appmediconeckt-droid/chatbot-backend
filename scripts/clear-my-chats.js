// One-off: clear chat history for a single user.
// Usage from backend folder:   node scripts/clear-my-chats.js <userId>
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const Chat = (await import("../src/models/chatModel.js")).default;

const userId = process.argv[2];
if (!userId) {
  console.error("Usage: node scripts/clear-my-chats.js <userId>");
  process.exit(1);
}

const uri =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  process.env.DATABASE_URL;
if (!uri) {
  console.error("No MongoDB URI found in .env (MONGODB_URI / MONGO_URI / DATABASE_URL)");
  process.exit(1);
}

await mongoose.connect(uri);
const filter = mongoose.isValidObjectId(userId)
  ? { userId: new mongoose.Types.ObjectId(userId) }
  : { userId };
const result = await Chat.deleteMany(filter);
console.log(`Deleted ${result.deletedCount} chat messages for user ${userId}`);
await mongoose.disconnect();
