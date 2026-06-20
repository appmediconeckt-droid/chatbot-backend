import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import OpenAI from "openai";

const router = express.Router();

// Lazy-load OpenAI client to ensure env variables are loaded
let openai = null;
function getOpenAI() {
  if (!openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set in environment variables");
    }
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openai;
}

// ─── Analyze photo and generate AI avatar ──────────────────────────────────
router.post("/analyze-and-generate", authenticateToken, async (req, res) => {
  try {
    const { photoBase64 } = req.body;

    if (!photoBase64) {
      return res.status(400).json({
        success: false,
        message: "Photo is required",
      });
    }

    // Extract base64 data if it includes the data URL prefix
    let base64Data = photoBase64;
    if (photoBase64.includes(",")) {
      base64Data = photoBase64.split(",")[1];
    }

    console.log("🔍 Analyzing photo with OpenAI Vision API...");

    // Step 1: Use OpenAI Vision to analyze the photo
    const openai = getOpenAI();
    const analysisResponse = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Data}`,
              },
            },
            {
              type: "text",
              text: `Analyze this photo and provide detailed facial feature analysis in JSON format:
{
  "gender": "male" or "female" (based on visible features),
  "skinTone": "very fair" / "fair" / "light" / "medium" / "tan" / "dark",
  "hairColor": "black" / "dark brown" / "brown" / "blonde" / "light blonde" / "red" / "white" / "other",
  "hairLength": "very short" / "short" / "medium" / "long" / "very long",
  "hairType": "straight" / "wavy" / "curly" / "coily",
  "eyeColor": "brown" / "blue" / "green" / "hazel" / "gray" / "other",
  "facialHair": "none" / "light beard" / "medium beard" / "full beard" / "moustache",
  "glasses": true/false,
  "glassesType": "none" / "regular glasses" / "sunglasses" / "aviators" / "other",
  "expression": "smile" / "neutral" / "serious" / "happy" / "other",
  "mouthShape": "closed" / "slightly open" / "open" / "smiling",
  "facialFeatures": "brief description of distinctive features",
  "lighting": "bright" / "moderate" / "dim",
  "background": "description of background if visible",
  "confidence": 0-100 (how confident about the analysis),
  "suggestions": "suggestions for avatar customization"
}

Provide ONLY the JSON response, no other text.`,
            },
          ],
        },
      ],
    });

    let analysis;
    try {
      const analysisText = analysisResponse.choices[0].message.content;
      analysis = JSON.parse(analysisText);
    } catch (parseErr) {
      console.error("Failed to parse analysis:", parseErr);
      return res.status(500).json({
        success: false,
        message: "Failed to analyze photo",
        error: parseErr.message,
      });
    }

    console.log("✅ Photo analyzed:", analysis);

    // Step 2: Generate a portrait using DALL-E based on the analysis
    console.log("🎨 Generating AI avatar portrait...");

    const portraitPrompt = generatePortraitPrompt(analysis);

    const imageResponse = await getOpenAI().images.generate({
      model: "dall-e-3",
      prompt: portraitPrompt,
      n: 1,
      size: "1024x1024",
      quality: "hd",
      style: "natural",
    });

    const avatarUrl = imageResponse.data[0].url;

    console.log("✅ Avatar generated successfully");

    res.json({
      success: true,
      analysis,
      avatarUrl,
      message: "Avatar generated successfully",
    });
  } catch (error) {
    console.error("❌ Avatar generation error:", error);

    if (error.status === 401) {
      return res.status(401).json({
        success: false,
        message: "OpenAI API key is invalid or expired",
      });
    }

    if (error.status === 429) {
      return res.status(429).json({
        success: false,
        message: "Rate limited. Please try again later.",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to generate avatar",
      error: error.message,
    });
  }
});

// ─── Generate portrait prompt from analysis ────────────────────────────────
function generatePortraitPrompt(analysis) {
  const parts = [];

  // Age/Gender appearance
  if (analysis.gender === "male") {
    parts.push("professional portrait of a man");
  } else {
    parts.push("professional portrait of a woman");
  }

  // Physical features
  if (analysis.skinTone) {
    parts.push(`with ${analysis.skinTone} skin tone`);
  }

  if (analysis.hairColor) {
    parts.push(`${analysis.hairColor} hair`);
  }

  if (analysis.hairLength) {
    parts.push(`${analysis.hairLength.toLowerCase()} hair`);
  }

  if (analysis.eyeColor) {
    parts.push(`${analysis.eyeColor} eyes`);
  }

  // Facial hair
  if (analysis.facialHair && analysis.facialHair !== "none") {
    parts.push(`with ${analysis.facialHair.toLowerCase()}`);
  }

  // Glasses
  if (analysis.glasses) {
    const glassesType = analysis.glassesType || "glasses";
    parts.push(`wearing ${glassesType.toLowerCase()}`);
  }

  // Expression
  if (analysis.expression === "smile" || analysis.expression === "happy") {
    parts.push("with a warm, friendly smile");
  } else if (analysis.expression === "neutral" || analysis.expression === "serious") {
    parts.push("with a calm, neutral expression");
  }

  // Professional context
  parts.push(
    "professional headshot, clean white background, professional lighting, high quality, studio photography"
  );

  return parts.join(", ");
}

export default router;
