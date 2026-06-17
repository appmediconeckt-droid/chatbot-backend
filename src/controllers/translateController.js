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

export const translateText = async (req, res) => {
  try {
    const { text, to, from } = req.body;

    if (!text || !to) {
      return res.status(400).json({
        success: false,
        message: "text and to language are required",
      });
    }

    // Try Azure first if credentials exist
    const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT;
    const key = process.env.AZURE_TRANSLATOR_KEY;
    const region = process.env.AZURE_TRANSLATOR_REGION;

    if (endpoint && key) {
      try {
        let url = `${endpoint}/translate?api-version=3.0&to=${to}`;
        if (from) url += `&from=${from}`;

        const response = await axios.post(
          url,
          [{ Text: text }],
          {
            headers: {
              "Ocp-Apim-Subscription-Key": key,
              "Ocp-Apim-Subscription-Region": region,
              "Content-Type": "application/json; charset=UTF-8",
            },
            timeout: 8000,
          }
        );

        return res.status(200).json({
          success: true,
          originalText: text,
          translatedText: response.data?.[0]?.translations?.[0]?.text || "",
          data: response.data,
        });
      } catch (azureError) {
        console.warn("Azure Translator failed, falling back to LibreTranslate");
      }
    }

    // Fallback to MyMemory Translation API (free, no credentials needed)
    // Format: GET https://api.mymemory.translated.net/get?q=QUERYTEXT&langpair=EN|FR
    const langPair = `${from || "en"}|${to}`;
    const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${langPair}`;

    const response = await axios.get(myMemoryUrl, { timeout: 10000 });
    const translatedText = response.data?.responseData?.translatedText || text;

    return res.status(200).json({
      success: true,
      originalText: text,
      translatedText: translatedText,
      source: "mymemory",
    });
  } catch (error) {
    console.error("Translation error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Translation failed",
      error: error.message,
    });
  }
};