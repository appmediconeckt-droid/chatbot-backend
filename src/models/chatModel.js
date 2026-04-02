import mongoose from "mongoose";

const chatSchema = new mongoose.Schema({
    userMessage: String,
    aiResponse: String
}, { timestamps: true });

export default mongoose.model("Chat", chatSchema);