// import {
//   detectLanguageWithGoogle,
//   translateTextWithGoogle,
// } from "../services/googleTranslateService.js";

// const SUPPORTED_LANGUAGES = [
//   { code: "en", name: "English" },
//   { code: "hi", name: "Hindi" },
//   { code: "ta", name: "Tamil" },
//   { code: "te", name: "Telugu" },
//   { code: "kn", name: "Kannada" },
//   { code: "ml", name: "Malayalam" },
//   { code: "bn", name: "Bengali" },
//   { code: "pa", name: "Punjabi" },
//   { code: "mr", name: "Marathi" },
//   { code: "gu", name: "Gujarati" },
//   { code: "ur", name: "Urdu" },
// ];

// export const translateText = async (req, res) => {
//   try {
//     const { text, targetLanguage, sourceLanguage, format } = req.body || {};
//     const trimmedText = typeof text === "string" ? text.trim() : "";

//     if (!trimmedText) {
//       return res.status(400).json({
//         success: false,
//         message: "text is required",
//       });
//     }

//     if (!targetLanguage || typeof targetLanguage !== "string") {
//       return res.status(400).json({
//         success: false,
//         message: "targetLanguage is required",
//       });
//     }

//     const translation = await translateTextWithGoogle({
//       text: trimmedText,
//       targetLanguage,
//       sourceLanguage,
//       format,
//     });

//     return res.json({
//       success: true,
//       ...translation,
//     });
//   } catch (error) {
//     console.error("Google translate error:", error.message);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to translate text",
//       error: error.message,
//     });
//   }
// };

// export const detectLanguage = async (req, res) => {
//   try {
//     const { text } = req.body || {};
//     const trimmedText = typeof text === "string" ? text.trim() : "";

//     if (!trimmedText) {
//       return res.status(400).json({
//         success: false,
//         message: "text is required",
//       });
//     }

//     const detection = await detectLanguageWithGoogle({ text: trimmedText });

//     return res.json({
//       success: true,
//       ...detection,
//     });
//   } catch (error) {
//     console.error("Google language detect error:", error.message);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to detect language",
//       error: error.message,
//     });
//   }
// };

// export const getSupportedLanguages = (_req, res) => {
//   return res.json({
//     success: true,
//     languages: SUPPORTED_LANGUAGES,
//   });
// };


import axios from "axios";

const normalizeLanguageCode = (language) => {
  if (!language || typeof language !== "string") return undefined;
  return language.trim().split("-")[0].toLowerCase();
};

export const translatePlainText = async ({ text, to, from }) => {
  const trimmedText = typeof text === "string" ? text.trim() : "";
  const targetLanguage = normalizeLanguageCode(to);
  const sourceLanguage = normalizeLanguageCode(from);

  if (!trimmedText) {
    const error = new Error("text is required");
    error.statusCode = 400;
    throw error;
  }

  if (!targetLanguage) {
    const error = new Error("to language is required");
    error.statusCode = 400;
    throw error;
  }

  if (sourceLanguage && sourceLanguage === targetLanguage) {
    return {
      originalText: trimmedText,
      translatedText: trimmedText,
      source: "none",
      sourceLanguage,
      targetLanguage,
    };
  }

  // Try Azure first if credentials exist.
  // Azure Translator auto-detects source language when `from` is omitted.
  const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT?.replace(/\/$/, "");
  const key = process.env.AZURE_TRANSLATOR_KEY;
  const region = process.env.AZURE_TRANSLATOR_REGION;

  if (endpoint && key) {
    try {
      const params = new URLSearchParams({
        "api-version": "3.0",
        to: targetLanguage,
      });

      if (sourceLanguage) {
        params.set("from", sourceLanguage);
      }

      const headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json; charset=UTF-8",
      };

      if (region) {
        headers["Ocp-Apim-Subscription-Region"] = region;
      }

      const response = await axios.post(
        `${endpoint}/translate?${params.toString()}`,
        [{ Text: trimmedText }],
        {
          headers,
          timeout: 8000,
        },
      );

      const result = response.data?.[0];
      return {
        originalText: trimmedText,
        translatedText: result?.translations?.[0]?.text || trimmedText,
        source: "azure",
        sourceLanguage:
          sourceLanguage || result?.detectedLanguage?.language || null,
        targetLanguage,
        data: response.data,
      };
    } catch (azureError) {
      console.warn(
        "Azure Translator failed, falling back to MyMemory:",
        azureError.message,
      );
    }
  }

  // Fallback to MyMemory Translation API.
  // MyMemory supports Autodetect as the source side of langpair, so do not
  // force English when caller intentionally omits `from`.
  const fallbackSourceLanguage = sourceLanguage || "Autodetect";
  const langPair = `${fallbackSourceLanguage}|${targetLanguage}`;
  const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmedText)}&langpair=${encodeURIComponent(langPair)}`;

  const response = await axios.get(myMemoryUrl, { timeout: 10000 });
  const translatedText = response.data?.responseData?.translatedText || trimmedText;

  return {
    originalText: trimmedText,
    translatedText,
    source: "mymemory",
    sourceLanguage: sourceLanguage || null,
    targetLanguage,
    data: response.data,
  };
};

export const translateText = async (req, res) => {
  try {
    const translation = await translatePlainText({
      text: req.body?.text,
      to: req.body?.to || req.body?.targetLanguage,
      from: req.body?.from || req.body?.sourceLanguage,
    });

    return res.status(200).json({
      success: true,
      ...translation,
    });
  } catch (error) {
    console.error("Translation error:", error.message);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Translation failed",
      error: error.message,
    });
  }
};
