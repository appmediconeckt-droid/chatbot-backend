const GOOGLE_TRANSLATE_API_URL =
  "https://translation.googleapis.com/language/translate/v2";

const normalizeLanguageCode = (language) => {
  if (!language || typeof language !== "string") return language;
  return language.split("-")[0].toLowerCase();
};

const getGoogleTranslateApiKey = () => {
  const apiKey =
    process.env.GOOGLE_TRANSLATE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_CLOUD_API_KEY;

  if (!apiKey) {
    throw new Error("GOOGLE_TRANSLATE_API_KEY is not configured");
  }

  return apiKey;
};

const parseGoogleTranslateError = async (response) => {
  try {
    const body = await response.json();
    return body?.error?.message || `Google Translate API error ${response.status}`;
  } catch (_error) {
    return `Google Translate API error ${response.status}`;
  }
};

export const translateTextWithGoogle = async ({
  text,
  targetLanguage,
  sourceLanguage,
  format = "text",
}) => {
  const apiKey = getGoogleTranslateApiKey();
  const target = normalizeLanguageCode(targetLanguage);
  const source = normalizeLanguageCode(sourceLanguage);

  const params = new URLSearchParams();
  params.set("key", apiKey);
  params.set("q", text);
  params.set("target", target);
  params.set("format", format);

  if (source && source !== "auto") {
    params.set("source", source);
  }

  const response = await fetch(GOOGLE_TRANSLATE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params,
  });

  if (!response.ok) {
    throw new Error(await parseGoogleTranslateError(response));
  }

  const body = await response.json();
  const translated = body?.data?.translations?.[0];

  return {
    translatedText: translated?.translatedText || "",
    detectedSourceLanguage: translated?.detectedSourceLanguage || source || null,
    targetLanguage: target,
  };
};

export const detectLanguageWithGoogle = async ({ text }) => {
  const apiKey = getGoogleTranslateApiKey();
  const params = new URLSearchParams();
  params.set("key", apiKey);
  params.set("q", text);

  const response = await fetch(`${GOOGLE_TRANSLATE_API_URL}/detect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body: params,
  });

  if (!response.ok) {
    throw new Error(await parseGoogleTranslateError(response));
  }

  const body = await response.json();
  const detection = body?.data?.detections?.[0]?.[0];

  return {
    language: detection?.language || null,
    confidence: detection?.confidence ?? null,
    isReliable: detection?.isReliable ?? null,
  };
};

export default {
  translateTextWithGoogle,
  detectLanguageWithGoogle,
};
