import OpenAI from "openai";
import { consentFetch } from "./aiConsent.js";
// Only the disclosed provider is permitted; no undisclosed fallback.
export const generateAIResponse = (message, history = [], instructions = "") => handleOpenAI(message, history.slice(-20), instructions);
// --- OPEN AI LOGIC ---
const handleOpenAI = async (message, history, systemInstruction) => {
  // Initialize OpenAI here so it doesn't crash the server on startup if key is missing
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "missing_key", fetch: consentFetch, timeout: 60000, maxRetries: 0,
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
    model: "gpt-4o", // Latest most capable OpenAI model - best for mental health support
    messages: messages,
    store: false,
    temperature: 0.7, // Balanced for empathy and accuracy
    max_tokens: 1000, // Allow detailed psychological responses
  });

  return response.choices[0].message.content;
};
