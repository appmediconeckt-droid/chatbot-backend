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

// This app cannot dispatch emergency services or promise clinician contact.
// Resource phone numbers must not be guessed or presented as globally valid.
export const generateCrisisResponse = (crisisLevel) => {
  if (crisisLevel === CRISIS_LEVELS.CRITICAL) return "I'm sorry you are facing this. Your immediate safety matters. If you might act on thoughts of harming yourself, have already harmed yourself, or cannot stay safe, call your local emergency services or go to the nearest emergency department now. Ask someone you trust to stay with you, and move away from anything you could use to hurt yourself if you can do so safely. Humaeli is not an emergency service and cannot contact a counselor or emergency responder for you. Are you in immediate danger right now?";
  if (crisisLevel === CRISIS_LEVELS.HIGH) return "I'm concerned about what you are experiencing. If you are in immediate danger or have a medical emergency, contact local emergency services or go to the nearest emergency department. If possible, reach out to someone you trust and seek urgent professional support. Humaeli cannot dispatch help or guarantee a counselor will contact you. Are you safe right now?";
  if (crisisLevel === CRISIS_LEVELS.MEDIUM) return "I hear you. A qualified professional can offer personal support. You can choose to contact a consultant in the directory; this does not automatically arrange an emergency response. Would you like help exploring your support options?";
  return "";
};
export const CRISIS_LEVELS_EXPORT = CRISIS_LEVELS;
