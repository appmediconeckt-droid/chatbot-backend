import { model } from "../config/gemini.js";

export const generateAIResponse = async (prompt) => {

    const result = await model.generateContent(prompt);

    const response = result.response.text();

    return response;
};

