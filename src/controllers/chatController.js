import Chat from "../models/chatModel.js";
import { generateAIResponse } from "../services/aiService.js";

export const chatWithAI = async (req, res) => {

    try {
        const { message } = req.body;
        const aiResponse = await generateAIResponse(message);
        const chat = await Chat.create({
            userMessage: message,
            aiResponse: aiResponse
        });

        res.json({
            success: true,
            data: chat
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: error.message
        });

    }
};