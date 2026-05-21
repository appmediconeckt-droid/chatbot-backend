// Language Detection & Support Service - Multi-language Indian support

const INDIAN_LANGUAGES = {
  HINDI: {
    code: "hi",
    name: "Hindi",
    keywords: ["mujhe", "mera", "main", "haan", "nahi", "kya", "kaise", "kyun"],
  },
  TAMIL: {
    code: "ta",
    name: "Tamil",
    keywords: ["naan", "enakku", "enna", "aana", "sollran", "yaaru", "eppadi"],
  },
  TELUGU: {
    code: "te",
    name: "Telugu",
    keywords: ["nenu", "naa", "ento", "kaani", "kani", "oka", "emandi"],
  },
  KANNADA: {
    code: "kn",
    name: "Kannada",
    keywords: ["nanu", "muttina", "enu", "yenu", "kano", "hudga"],
  },
  MALAYALAM: {
    code: "ml",
    name: "Malayalam",
    keywords: ["njan", "ente", "enne", "ano", "alle", "enna", "arinj"],
  },
  BENGALI: {
    code: "bn",
    name: "Bengali",
    keywords: ["ami", "amar", "apo", "ki", "kebol", "tahole"],
  },
  PUNJABI: {
    code: "pa",
    name: "Punjabi",
    keywords: ["main", "mere", "ch", "hun", "ki", "jida", "eh"],
  },
  MARATHI: {
    code: "mr",
    name: "Marathi",
    keywords: ["mi", "mala", "mi", "kay", "kay", "nav", "jiv"],
  },
  ENGLISH: {
    code: "en",
    name: "English",
    keywords: ["i", "me", "my", "you", "is", "what", "how"],
  },
};

export const detectLanguage = (text) => {
  if (!text) return INDIAN_LANGUAGES.ENGLISH;

  const lowerText = text.toLowerCase();
  const languageScores = {};

  for (const [langKey, langData] of Object.entries(INDIAN_LANGUAGES)) {
    let score = 0;
    for (const keyword of langData.keywords) {
      if (lowerText.includes(keyword)) {
        score += 1;
      }
    }
    languageScores[langKey] = score;
  }

  const detectedLanguage = Object.entries(languageScores).reduce((prev, current) =>
    prev[1] > current[1] ? prev : current,
  )[0];

  return INDIAN_LANGUAGES[detectedLanguage] || INDIAN_LANGUAGES.ENGLISH;
};

export const getLanguageGreeting = (languageCode) => {
  const greetings = {
    hi: "नमस्ते! 🙏 मैं आपकी मदद करने के लिए यहाँ हूँ। कृपया अपनी समस्या बताएं।",
    ta: "வணக்கம்! 🙏 உங்களுக்கு உதவ நான் இங்கே இருக்கிறேன். தயவு செய்து உங்கள் பிரச்சினை சொல்லுங்கள்.",
    te: "నమస్కారం! 🙏 మీకు సహాయం చేయడానికి నేను ఇక్కడ ఉన్నాను. దయచేసి మీ సమస్యను చెప్పండి.",
    kn: "ನಮಸ್ಕಾರ! 🙏 ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ನಾನು ಇಲ್ಲಿ ಉಂಟೆ. ದಯವಿಟ್ಟು ನಿಮ್ಮ ಸಮಸ್ಯೆಯನ್ನು ಹೇಳಿ.",
    ml: "നമസ്കാരം! 🙏 നിങ്ങളെ സഹായിക്കാൻ ഞാൻ ഇവിടെയുണ്ട്. ദയവായി നിങ്ങളുടെ പ്രശ്നം പറയുക.",
    bn: "নমস্কার! 🙏 আপনাকে সাহায্য করতে আমি এখানে আছি। অনুগ্রহ করে আপনার সমস্যা বলুন।",
    pa: "ਨਮਸਕਾਰ! 🙏 ਮੈਂ ਤੁਹਾਨੂੰ ਮਦਦ ਕਰਨ ਲਈ ਇੱਥੇ ਹਾਂ। ਕਿਰਪਾ ਕਰਕੇ ਆਪਣੀ ਸਮੱਸਿਆ ਦੱਸੋ।",
    mr: "नमस्कार! 🙏 मी तुम्हाला मदत करण्यासाठी येथे आहे. कृपया तुमची समस्या सांगा.",
    en: "Hello! 👋 I'm here to help you. Please tell me what's troubling you.",
  };

  return greetings[languageCode] || greetings.en;
};

export const getLanguageEmergencyResponse = (languageCode) => {
  const responses = {
    hi: "🚨 आपातकालीन सहायता आवश्यक है!\n📞 आत्महत्या रोकथाम हेल्पलाइन: 9152987821\n📞 iCall (24/7): 9152987821\nकृपया सुरक्षित रहें। 💙",
    ta: "🚨 அருத்தமான உதவி தேவை!\n📞 தற்கொலை தடுப்பு ஹেல்பलைன்: 9152987821\n📞 iCall (24/7): 9152987821\nதயவு செய்து பாதுகாப்பாக இருங்கள். 💙",
    te: "🚨 తక్షణ సహాయం కావాలి!\n📞 ఆత్మహత్య నిరోధక హెల్పులైన్: 9152987821\n📞 iCall (24/7): 9152987821\nదయచేసి సురక్షితంగా ఉండండి. 💙",
    kn: "🚨 ತುರ್ತುಸಹಾಯ ಅಗತ್ಯ!\n📞 ಆತ್ಮಹತ್ಯೆ ತಡೆ ಸಹಾಯ ಸಾಲು: 9152987821\n📞 iCall (24/7): 9152987821\nದಯವಿಟ್ಟು ಸುರಕ್ಷಿತವಾಗಿರಿ. 💙",
    ml: "🚨 ತುರ್ತುಸಹಾಯ ಅಗತ್ಯ!\n📞 ആത്മഹത്യ നിരോധന ഹെൽപ്പ്‌ലൈൻ: 9152987821\n📞 iCall (24/7): 9152987821\nദയവായി സുരക്ഷിതരായിരിക്കുക. 💙",
    bn: "🚨 জরুরি সহায়তা প্রয়োজন!\n📞 আত্মহত্যা প্রতিরোধ হেল্পলাইন: 9152987821\n📞 iCall (24/7): 9152987821\nদয়া করে নিরাপদ থাকুন। 💙",
    pa: "🚨 ਜਰੂਰੀ ਸਹਾਇਤਾ ਦੀ ਲੋੜ ਹੈ!\n📞 ਖੁਦਕੁਸ਼ੀ ਰੋਕਥਾਮ ਹੈਲਪ ਲਾਈਨ: 9152987821\n📞 iCall (24/7): 9152987821\nਕਿਰਪਾ ਕਰਕੇ ਸੁਰਖ਼ੀ ਰਹੋ। 💙",
    mr: "🚨 जरूरी मदत लागते आहे!\n📞 आत्मघाती रोकथाम हेल्पलाइन: 9152987821\n📞 iCall (24/7): 9152987821\nकृपया सुरक्षित रहा. 💙",
    en: "🚨 Emergency help needed!\n📞 Suicide Prevention Lifeline: 9152987821\n📞 iCall (24/7): 9152987821\nPlease stay safe. 💙",
  };

  return responses[languageCode] || responses.en;
};

export const translateResponse = (response, targetLanguage) => {
  // In production, use Google Translate API or similar
  // For now, return the response as-is since Claude API will handle multilingual responses
  return response;
};

export default {
  detectLanguage,
  getLanguageGreeting,
  getLanguageEmergencyResponse,
  translateResponse,
  INDIAN_LANGUAGES,
};
