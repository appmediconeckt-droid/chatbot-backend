// profileExtractor.js
//
// Tiny rule-based extractor that pulls onboarding facts out of free-form
// chat replies. We do this on every user turn so the AI can stop re-asking
// (age, gender, where they are, who's with them, what they're feeling).
//
// Rules-only on purpose: deterministic, language-tolerant, zero LLM cost.
// All values are best-effort — when nothing matches we return nulls and
// the AI keeps the original "ask gently if missing" behaviour.

const AGE_PATTERNS = [
  /(?:i(?:'| a)?m|i am|mai|main|me|umar|age|saal|years?\s*old)\s*(?:hu|hoon|h\b|is|of)?\s*(\d{1,2})/i,
  /\b(\d{1,2})\s*(?:saal|years?|yrs?)\b/i,
  /^\s*(\d{1,2})\s*(?:yo|y\.?o\.?)\s*$/i,
];

const GENDER_PATTERNS = [
  { re: /\b(?:male|boy|ladka|gent|man)\b/i, value: "male" },
  { re: /\b(?:female|girl|ladki|woman|lady)\b/i, value: "female" },
  { re: /\b(?:non[\s-]?binary|nb|other|prefer not)\b/i, value: "other" },
];

const LOCATION_PATTERNS = [
  { re: /\b(at\s+home|home\s+pe|ghar\s+(?:pe|par|mein)|inside)\b/i, value: "home" },
  { re: /\b(at\s+work|office\s+(?:pe|par|mein)|kaam\s+pe|kaam\s+par|workplace)\b/i, value: "work" },
  { re: /\b(school|college|class|university|uni|hostel)\b/i, value: "school" },
  { re: /\b(out(?:side)?|bahar|public|park|market|on\s+the\s+road|street)\b/i, value: "outside" },
];

const COMPANY_PATTERNS = [
  { re: /\b(alone|akela|akeli|akeley|by\s+myself|on\s+my\s+own|no\s+one)\b/i, value: "alone" },
  { re: /\b(with\s+family|family\s+ke\s+saath|with\s+parents|maa|papa|bhai|behen|brother|sister)\b/i, value: "family" },
  { re: /\b(with\s+friends?|dost(?:o|on)\s+ke\s+saath|with\s+a\s+friend)\b/i, value: "friends" },
  { re: /\b(with\s+partner|girlfriend|boyfriend|husband|wife|spouse)\b/i, value: "partner" },
  { re: /\b(with\s+colleague|colleagues|coworker|saathi)\b/i, value: "colleagues" },
];

const SAFETY_FLAGS = [
  { re: /\b(scared|afraid|dar(?:\s+lag)?|fear(?:ful)?|unsafe|not\s+safe|hurting\s+me|threatening)\b/i, flag: "feels_unsafe" },
  { re: /\b(stuck|trapped|can'?t\s+leave|nahi\s+nikal)\b/i, flag: "feels_trapped" },
];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const extractAge = (text) => {
  for (const re of AGE_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n) && n >= 8 && n <= 99) {
        return clamp(n, 8, 99);
      }
    }
  }
  return null;
};

const extractEnum = (text, patterns) => {
  for (const { re, value } of patterns) {
    if (re.test(text)) return value;
  }
  return null;
};

const extractFlags = (text) => {
  const flags = new Set();
  for (const { re, flag } of SAFETY_FLAGS) {
    if (re.test(text)) flags.add(flag);
  }
  return Array.from(flags);
};

// Pull onboarding facts from a single user message.
// Returns an object with whichever fields could be detected; absent keys
// stay undefined so callers can $set only the ones we found.
export const extractProfileFields = (message) => {
  if (!message || typeof message !== "string") return {};
  const text = message.toLowerCase();

  const out = {};
  const age = extractAge(text);
  if (age) out.age = age;

  const gender = extractEnum(text, GENDER_PATTERNS);
  if (gender) out.gender = gender;

  const where = extractEnum(text, LOCATION_PATTERNS);
  if (where) out.currentSurrounding = where;

  const company = extractEnum(text, COMPANY_PATTERNS);
  if (company) out.currentCompany = company;

  const flags = extractFlags(text);
  if (flags.length) out.safetyFlags = flags;

  return out;
};

// Build a short, AI-readable summary of situational context for the system
// prompt. Used by chatController when we don't want to dump raw fields.
export const formatSituationSummary = ({
  age,
  gender,
  currentSurrounding,
  currentCompany,
  safetyFlags,
  gpsCity,
} = {}) => {
  const parts = [];
  if (age) parts.push(`age ${age}`);
  if (gender) parts.push(gender);
  if (currentSurrounding) parts.push(`currently at ${currentSurrounding}`);
  if (currentCompany) parts.push(`with ${currentCompany}`);
  if (gpsCity) parts.push(`in ${gpsCity}`);
  if (safetyFlags?.length) parts.push(`flags: ${safetyFlags.join(", ")}`);
  return parts.length ? parts.join(", ") : null;
};
