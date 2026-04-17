import { model as geminiModel } from "../config/gemini.js";
import OpenAI from "openai";

// The main function your Chat Controller will call
export const generateAIResponse = async (
  message,
  chatHistory = [],
  systemInstruction = "",
) => {
  // Check our switch in the .env file!
  const provider = process.env.ACTIVE_AI_PROVIDER || "gemini";

  if (provider === "openai") {
    return await handleOpenAI(message, chatHistory, systemInstruction);
  } else if (provider === "groq") {
    return await handleGroq(message, chatHistory, systemInstruction);
  } else {
    return await handleGemini(message, chatHistory, systemInstruction);
  }
};

// --- OPEN AI LOGIC ---
const handleOpenAI = async (message, history, systemInstruction) => {
  // Initialize OpenAI here so it doesn't crash the server on startup if key is missing
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "missing_key",
  });

  // OpenAI uses a specific format: { role: "system" | "user" | "assistant", content: "..." }
  const messages = [];

  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }

  // Add prior history
  messages.push(...history);

  // Add the new user message
  messages.push({ role: "user", content: message });

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini", // The cost-friendly OpenAI model
    messages: messages,
  });

  return response.choices[0].message.content;
};

// --- GEMINI LOGIC ---
const handleGemini = async (message, history, systemInstruction) => {
  // Map generic { role, content } history to Gemini's format
  // OpenAI uses "assistant", Gemini uses "model".
  const formattedHistory = history.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content || "" }],
  }));

  // Add system instruction as the first exchange if present
  if (systemInstruction) {
    formattedHistory.unshift(
      {
        role: "user",
        parts: [{ text: systemInstruction }],
      },
      {
        role: "model",
        parts: [
          {
            text: "Understood. I will act as the Mediconeckt assistant using this counselor data.",
          },
        ],
      },
    );
  }

  // Start the chat session with the formatted history
  const chatSession = geminiModel.startChat({
    history: formattedHistory,
  });

  // Send the user's message and await the response
  const result = await chatSession.sendMessage(message);

  return result.response.text();
};

// --- GROQ LOGIC ---
// Groq provides an OpenAI‑compatible API at a custom base URL.
// We reuse the OpenAI client library, pointing it at Groq's endpoint.
const handleGroq = async (message, history, systemInstruction) => {
  const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const messages = [];

  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }

  messages.push(...history.filter((msg) => msg && msg.content));

  messages.push({ role: "user", content: message });

  const models = [
    process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ];

  for (const model of models) {
    try {
      const response = await groq.chat.completions.create({
        model,
        messages,
      });

      return response.choices[0].message.content;
    } catch (err) {
      console.log(`Groq model ${model} failed:`, err.message);
    }
  }

  throw new Error("All Groq models failed");
};