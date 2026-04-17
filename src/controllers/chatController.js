import Chat from "../models/chatModel.js";
import User from "../models/userModel.js";
import { generateAIResponse } from "../services/aiService.js";

export const chatWithAI = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    // Fetch all active counsellors from the database
    // Selecting only relevant fields to pass to the AI to save tokens
    const counsellors = await User.find({ role: "counsellor" }).select(
      "fullName specialization experience qualification aboutMe location consultationMode languages rating totalSessions",
    );

    // Construct the logical "System Instruction" for the AI model
    const systemInstruction = `
You are a helpful and empathetic healthcare assistant for Mediconeckt. 
Your primary goal is to listen to the user's health concerns or mental health issues, 
and recommend the best counsellor from our platform based on their symptoms.

Here is our current database of active counsellors:
${JSON.stringify(counsellors)}

Rules:
- ONLY recommend counsellors from the provided list.
- Keep your answers professional, concise, empathetic, and friendly.
- Suggest 1 or 2 counsellors that best match the user's needs, and briefly explain WHY (mentioning their experience or specialization).
- If the user's query is vague, ask a clarifying question to determine their needs.
`;

    // Call our upgraded AI Gateway (which supports Gemini and OpenAI seamlessly)
    const aiResponse = await generateAIResponse(
      message,
      history,
      systemInstruction,
    );

    // Save the interaction to the database
    const chat = await Chat.create({
      userMessage: message,
      aiResponse: aiResponse,
    });

    res.json({
      success: true,
      data: chat,
      reply: aiResponse,
    });
  } catch (error) {
    console.error("Chat API Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to connect to the AI model.",
    });
  }
};
