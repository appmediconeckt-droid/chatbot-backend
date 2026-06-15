import {
  detectLanguageWithGoogle,
  translateTextWithGoogle,
} from "../services/googleTranslateService.js";

const SUPPORTED_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "kn", name: "Kannada" },
  { code: "ml", name: "Malayalam" },
  { code: "bn", name: "Bengali" },
  { code: "pa", name: "Punjabi" },
  { code: "mr", name: "Marathi" },
  { code: "gu", name: "Gujarati" },
  { code: "ur", name: "Urdu" },
];

export const translateText = async (req, res) => {
  try {
    const { text, targetLanguage, sourceLanguage, format } = req.body || {};
    const trimmedText = typeof text === "string" ? text.trim() : "";

    if (!trimmedText) {
      return res.status(400).json({
        success: false,
        message: "text is required",
      });
    }

    if (!targetLanguage || typeof targetLanguage !== "string") {
      return res.status(400).json({
        success: false,
        message: "targetLanguage is required",
      });
    }

    const translation = await translateTextWithGoogle({
      text: trimmedText,
      targetLanguage,
      sourceLanguage,
      format,
    });

    return res.json({
      success: true,
      ...translation,
    });
  } catch (error) {
    console.error("Google translate error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to translate text",
      error: error.message,
    });
  }
};

export const detectLanguage = async (req, res) => {
  try {
    const { text } = req.body || {};
    const trimmedText = typeof text === "string" ? text.trim() : "";

    if (!trimmedText) {
      return res.status(400).json({
        success: false,
        message: "text is required",
      });
    }

    const detection = await detectLanguageWithGoogle({ text: trimmedText });

    return res.json({
      success: true,
      ...detection,
    });
  } catch (error) {
    console.error("Google language detect error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to detect language",
      error: error.message,
    });
  }
};

export const getSupportedLanguages = (_req, res) => {
  return res.json({
    success: true,
    languages: SUPPORTED_LANGUAGES,
  });
};
