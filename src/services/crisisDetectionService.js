// Crisis Detection Service - Identifies high-risk messages and alerts counselors

const CRISIS_KEYWORDS = {
  SUICIDE: [
    "suicide",
    "socide",
    "kill myself",
    "end my life",
    "want to die",
    "don't want to live",
    "suicidal",
    "aatmahatya",
    "jeevan samaapt",
  ],
  SELF_HARM: [
    "self harm",
    "cut myself",
    "hurt myself",
    "harm myself",
    "atamghaat",
  ],
  ABUSE: [
    "abuse",
    "assault",
    "rape",
    "hit me",
    "beat me",
    "violence",
    "domestic violence",
    "ghar mein hinsaa",
  ],
  SEVERE_DISTRESS: [
    "emergency",
    "crisis",
    "can't breathe",
    "panic attack",
    "losing control",
    "breakdown",
    "completely broken",
    "hopeless",
    "helpless",
  ],
};

const CRISIS_LEVELS = {
  CRITICAL: "critical", // Immediate danger (suicide, self-harm)
  HIGH: "high", // Severe distress, abuse
  MEDIUM: "medium", // Concerning but not immediately dangerous
  LOW: "low", // No crisis detected
};

export const detectCrisis = (message) => {
  if (!message) return { level: CRISIS_LEVELS.LOW, keywords: [] };

  const lowerMessage = message.toLowerCase();
  const detectedKeywords = [];
  let crisisLevel = CRISIS_LEVELS.LOW;

  // Check for critical keywords
  for (const keyword of CRISIS_KEYWORDS.SUICIDE) {
    if (lowerMessage.includes(keyword)) {
      detectedKeywords.push(keyword);
      crisisLevel = CRISIS_LEVELS.CRITICAL;
    }
  }

  for (const keyword of CRISIS_KEYWORDS.SELF_HARM) {
    if (lowerMessage.includes(keyword)) {
      detectedKeywords.push(keyword);
      if (crisisLevel !== CRISIS_LEVELS.CRITICAL) {
        crisisLevel = CRISIS_LEVELS.CRITICAL;
      }
    }
  }

  // Check for high-risk keywords
  for (const keyword of CRISIS_KEYWORDS.ABUSE) {
    if (lowerMessage.includes(keyword)) {
      detectedKeywords.push(keyword);
      if (crisisLevel === CRISIS_LEVELS.LOW) {
        crisisLevel = CRISIS_LEVELS.HIGH;
      }
    }
  }

  // Check for severe distress keywords
  for (const keyword of CRISIS_KEYWORDS.SEVERE_DISTRESS) {
    if (lowerMessage.includes(keyword)) {
      detectedKeywords.push(keyword);
      if (crisisLevel === CRISIS_LEVELS.LOW || crisisLevel === CRISIS_LEVELS.MEDIUM) {
        crisisLevel = CRISIS_LEVELS.HIGH;
      }
    }
  }

  return {
    level: crisisLevel,
    keywords: [...new Set(detectedKeywords)],
    isCrisis: crisisLevel !== CRISIS_LEVELS.LOW,
  };
};

export const generateCrisisResponse = (crisisLevel) => {
  const responses = {
    [CRISIS_LEVELS.CRITICAL]: `
🚨 I can see you're in a critical situation right now. Your safety is the most important thing.

IMMEDIATE HELP:
📞 National Suicide Prevention Lifeline (India): 9152987821
📞 iCall (24/7 Mental Health Support): 9152987821
📞 Vandrevala Foundation: 9999 77 6666
📞 AASRA: 9820466726

✅ I'm connecting you with an emergency counselor right now. Please stay safe.
    `,
    [CRISIS_LEVELS.HIGH]: `
⚠️ I'm concerned about what you're sharing. You deserve immediate professional support.

I'm connecting you with a specialized counselor who can help you right now. They will reach out to you shortly.

Please reach out to these resources while you wait:
📞 iCall: 9152987821 (Hindi, English, Marathi)
📞 Vandrevala Foundation: 9999 77 6666
📞 AASRA: 9820466726

You're not alone. Help is here. 💙
    `,
    [CRISIS_LEVELS.MEDIUM]: `
I hear you, and I'm here to listen and support you. Based on what you've shared, I'd like to connect you with a professional counselor who specializes in this area.

They can provide more personalized support and guidance. Is that okay with you?
    `,
  };

  return responses[crisisLevel] || "";
};

export const CRISIS_LEVELS_EXPORT = CRISIS_LEVELS;
