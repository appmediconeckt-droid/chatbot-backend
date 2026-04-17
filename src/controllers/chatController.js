import Chat from "../models/chatModel.js";
import User from "../models/userModel.js";
import { generateAIResponse } from "../services/aiService.js";

export const chatWithAI = async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    // Fetch all active counsellors from the database
    const counsellors = await User.find({ role: "counsellor" }).select(
      "fullName specialization experience qualification aboutMe location consultationMode languages rating totalSessions",
    );

    // Construct the logical "System Instruction" for the AI model
    const systemInstruction = `
You are a helpful and empathetic healthcare assistant for Mediconeckt. 
Your goal is to listen to the user's health or mental health concerns and recommend the best professional from our platform.

Here is our current database of active professionals:
${JSON.stringify(counsellors)}

Rules:
- Keep responses VERY CONCISE (maximum 2-3 sentences).
- Be empathetic but get straight to the point.
- Only recommend professionals from the provided list.
- If a match is found, briefly name them and their specialty. Wrap their name in square brackets like this: [Name].
- Do not explain the "meta" details of the database (e.g., "we only have a dentist"). Just make the recommendation naturally.
- If no good match exists, offer general empathy and suggest they check back later.
`;

    // Generate AI response
    const aiResponse = await generateAIResponse(
      message,
      history,
      systemInstruction,
    );

    // Save to database (optional userId)
    const chatData = {
      userMessage: message,
      aiResponse: aiResponse,
    };

    if (req.user && (req.user.id || req.user._id)) {
      chatData.userId = req.user.id || req.user._id;
    }

    const chat = await Chat.create(chatData);

    res.status(200).json({
      success: true,
      data: {
        aiResponse,
        chatId: chat._id,
      },
    });
  } catch (error) {
    console.error("AI Chat Error:", error);
    res.status(500).json({
      success: false,
      message: "An error occurred while processing your request with the AI.",
      error: error.message,
    });
  }
};
