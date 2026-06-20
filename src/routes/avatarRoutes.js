import express from "express";
import { authenticateToken } from "../middleware/auth.js";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

const router = express.Router();
// Keep the model configurable, but default to the same vision-capable model
// already used by the application's OpenAI chat integration.
const AVATAR_ANALYSIS_MODEL = process.env.AVATAR_ANALYSIS_MODEL || "gpt-4o";
const AVATAR_IMAGE_MODEL = process.env.AVATAR_IMAGE_MODEL || "gpt-image-1";
// Low is noticeably faster and still suitable for a small profile avatar.
const AVATAR_IMAGE_QUALITY = process.env.AVATAR_IMAGE_QUALITY || "low";
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

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
  let failedStage = "photo analysis";

  try {
    const { photoBase64 } = req.body;

    if (!photoBase64) {
      return res.status(400).json({
        success: false,
        message: "Photo is required",
      });
    }

    if (typeof photoBase64 !== "string") {
      return res.status(400).json({
        success: false,
        message: "Photo must be sent as a base64 image",
      });
    }

    // Keep the original MIME type. Uploads can be PNG/WebP while camera photos
    // are JPEG; labelling every image as JPEG can make vision decoding unreliable.
    const dataUrlMatch = photoBase64.match(
      /^data:(image\/(?:jpeg|jpg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/i,
    );
    const imageMimeType = dataUrlMatch?.[1]?.toLowerCase().replace("jpg", "jpeg") || "image/jpeg";
    const base64Data = dataUrlMatch?.[2] || photoBase64.replace(/\s/g, "");

    if (!base64Data || !/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
      return res.status(400).json({
        success: false,
        message: "Photo is not a valid base64 image",
      });
    }

    const photoBytes = Buffer.byteLength(base64Data, "base64");
    if (photoBytes > MAX_PHOTO_BYTES) {
      return res.status(413).json({
        success: false,
        message: "Photo is too large. Please use an image smaller than 6 MB.",
      });
    }

    console.log("🔍 Analyzing photo with OpenAI Vision API...");

    // The image-edit model receives the selfie directly, so separate vision
    // analysis is optional and disabled by default for a faster request path.
    const openai = getOpenAI();
    const analysisResponse = process.env.AVATAR_ENABLE_ANALYSIS === "true"
      ? await openai.chat.completions.create({
      // gpt-4o accepts image_url input. The previous gpt-4-turbo model caused
      // the "image_url is only supported by certain models" API error.
      model: AVATAR_ANALYSIS_MODEL,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${imageMimeType};base64,${base64Data}`,
                detail: "low",
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
      })
      : { choices: [{ message: { content: "{}" } }] };

    let analysis;
    try {
      const analysisText = analysisResponse.choices[0].message.content;
      if (!analysisText) {
        throw new Error("OpenAI returned an empty photo analysis");
      }
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

    // Step 2: Edit the actual selfie. The previous text-to-image call used only
    // inferred attributes, so it could generate a different person (for example,
    // a female avatar from a male selfie). Image edits preserve the supplied face.
    console.log("🎨 Creating an avatar from the supplied selfie...");

    failedStage = "avatar image generation";
    const portraitPrompt = generatePortraitPrompt(analysis);
    const fileExtension = imageMimeType === "image/png" ? "png" : imageMimeType === "image/webp" ? "webp" : "jpg";
    const selfieFile = await toFile(
      Buffer.from(base64Data, "base64"),
      `selfie.${fileExtension}`,
      { type: imageMimeType },
    );

    const imageResponse = await getOpenAI().images.edit({
      model: AVATAR_IMAGE_MODEL,
      image: selfieFile,
      prompt: portraitPrompt,
      n: 1,
      size: "1024x1024",
      quality: AVATAR_IMAGE_QUALITY,
      input_fidelity: "high",
      output_format: "png",
      background: "opaque",
    });

    const avatarBase64 = imageResponse.data?.[0]?.b64_json;
    if (!avatarBase64) {
      throw new Error("OpenAI returned no avatar image data");
    }
    const avatarUrl = `data:image/png;base64,${avatarBase64}`;

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

    if (error.status === 400) {
      const providerMessage = error?.error?.message || error.message || "Invalid request";
      return res.status(422).json({
        success: false,
        message: `OpenAI ${failedStage} failed: ${providerMessage}`,
        stage: failedStage,
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to generate avatar",
      error: error.message,
    });
  }
});

// Apply the builder controls to an already-generated AI avatar. This keeps the
// person's identity while allowing deliberate changes such as hairstyle,
// glasses, eye expression, and outfit.
router.post("/customize", authenticateToken, async (req, res) => {
  try {
    const { avatarBase64, customization = {} } = req.body;
    if (typeof avatarBase64 !== "string") {
      return res.status(400).json({ success: false, message: "Avatar image is required" });
    }

    const match = avatarBase64.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      return res.status(400).json({ success: false, message: "Avatar image is not valid" });
    }

    const imageMimeType = match[1].toLowerCase().replace("jpg", "jpeg");
    const base64Data = match[2];
    if (Buffer.byteLength(base64Data, "base64") > MAX_PHOTO_BYTES) {
      return res.status(413).json({ success: false, message: "Avatar image is too large" });
    }

    const extension = imageMimeType === "image/png" ? "png" : imageMimeType === "image/webp" ? "webp" : "jpg";
    const avatarFile = await toFile(Buffer.from(base64Data, "base64"), `avatar.${extension}`, { type: imageMimeType });
    const imageResponse = await getOpenAI().images.edit({
      model: AVATAR_IMAGE_MODEL,
      image: avatarFile,
      prompt: buildCustomizationPrompt(customization),
      n: 1,
      size: "1024x1024",
      quality: AVATAR_IMAGE_QUALITY,
      input_fidelity: "high",
      output_format: "png",
      background: "opaque",
    });

    const avatarData = imageResponse.data?.[0]?.b64_json;
    if (!avatarData) throw new Error("OpenAI returned no customized avatar image data");

    return res.json({
      success: true,
      avatarUrl: `data:image/png;base64,${avatarData}`,
      message: "Avatar customized successfully",
    });
  } catch (error) {
    console.error("Avatar customization error:", error);
    const providerMessage = error?.error?.message || error.message || "Unable to customize avatar";
    return res.status(error.status === 400 ? 422 : 500).json({
      success: false,
      message: `OpenAI avatar customization failed: ${providerMessage}`,
    });
  }
});

// ─── Generate portrait prompt from analysis ────────────────────────────────
function generatePortraitPrompt(analysis) {
  const visibleDetails = [
    analysis.hairColor && `${analysis.hairColor} hair`,
    analysis.hairLength && `${analysis.hairLength.toLowerCase()} hair`,
    analysis.glasses && "the same glasses",
    analysis.facialHair && analysis.facialHair !== "none" && `the same ${analysis.facialHair.toLowerCase()}`,
  ].filter(Boolean).join(", ");

  return [
    "Transform the supplied selfie into a polished, friendly, illustrated profile avatar.",
    "Preserve the same person: facial structure, apparent age range, gender presentation, skin tone, hairstyle, hair color, facial hair, glasses, and expression must remain recognizably consistent with the input image.",
    "Do not replace the person with someone else and do not change their gender presentation.",
    visibleDetails && `Keep these visible details consistent: ${visibleDetails}.`,
    "Use clean studio lighting, a simple soft-color background, head-and-shoulders framing, and a high-quality modern avatar illustration style.",
  ].filter(Boolean).join(" ");
}

function buildCustomizationPrompt(customization) {
  const description = [
    customization.top && `hairstyle: ${customization.top}`,
    customization.hairColor && `hair color: ${customization.hairColor}`,
    customization.eyes && `eye expression: ${customization.eyes}`,
    customization.eyebrows && `eyebrows: ${customization.eyebrows}`,
    customization.mouth && `mouth expression: ${customization.mouth}`,
    customization.facialHair && `facial hair: ${customization.facialHair}`,
    customization.accessories && `accessory: ${customization.accessories}`,
    customization.clothing && `outfit: ${customization.clothing}`,
    customization.clothesColor && `outfit color: ${customization.clothesColor}`,
  ].filter(Boolean).join("; ");

  return [
    "Edit this existing illustrated profile avatar.",
    "Keep the exact same person, facial identity, gender presentation, skin tone, age range, and pose.",
    "Only apply the requested appearance changes while retaining the polished avatar style.",
    `Requested changes: ${description || "keep the current appearance"}.`,
  ].join(" ");
}

export default router;
