// counsellorMatcher.js
//
// Ranks online counsellors against a user's situation so the AI can suggest
// the *best fit*, not just whoever's online. The score combines:
//   - specialization match against keywords pulled from the user's message
//   - gender preference (female users often prefer female counsellors for
//     certain topics — we soft-boost the match, never hard-filter)
//   - age bucket (teens get youth-specialists, elderly get senior-care)
//   - rating + experience (tiebreakers)
//
// Returns counsellors sorted high-to-low by total score. Anyone with score >=
// matchThreshold is considered a real match; below that we still return them
// so the AI can offer a generalist if no strong fit exists.

// Topic → specialization tag → keyword list. Multi-language (English +
// Hinglish) so we catch real user speech.
const TOPIC_KEYWORDS = {
  anxiety: [
    "anxiety", "anxious", "panic", "ghabra", "bechain", "ghabraht", "panic attack",
    "tension", "worry", "worrying", "darr", "fear",
  ],
  depression: [
    "depression", "depressed", "sad", "udaas", "low", "hopeless", "khud ko",
    "mann nahi", "kuch acha nahi lag",
  ],
  sleep: [
    "sleep", "insomnia", "neend", "nahi aati", "raat bhar", "soya nahi",
    "thik se nahi soya",
  ],
  stress: [
    "stress", "stressed", "burnout", "pressure", "overwhelm", "kaam ka stress",
    "deadline", "exam stress",
  ],
  relationship: [
    "relationship", "girlfriend", "boyfriend", "partner", "shaadi", "marriage",
    "husband", "wife", "patni", "pati", "break up", "breakup",
  ],
  family: [
    "family", "parents", "maa", "papa", "mother", "father", "bhai", "behen",
    "sibling", "ghar mein", "family problem",
  ],
  trauma: [
    "trauma", "ptsd", "flashback", "abuse", "abused", "violated", "assault",
    "molest", "harass",
  ],
  addiction: [
    "addict", "smoking", "drink", "alcohol", "drugs", "cigarette", "weed",
    "habit chod", "habit chhod",
  ],
  career: [
    "career", "job", "office", "boss", "work", "interview", "kaam",
    "naukri", "promotion",
  ],
  studies: [
    "study", "studies", "exam", "school", "college", "padhai", "result",
    "marks", "fail", "test",
  ],
  women_health: [
    "period", "menstrual", "menstruation", "pms", "pregnancy", "pregnant",
    "gyno", "women", "harassment",
  ],
  men_health: [
    "erection", "performance", "low libido", "mardana", "premature",
    "infertility", "men",
  ],
  general_health: [
    "health", "headache", "fever", "stomach", "pain", "tabiyat", "sehat",
    "dard", "doctor",
  ],
};

// Specialization names on counsellor profiles are messy free-form strings.
// Map our internal tag → likely substrings to look for in their specialization
// list. Case-insensitive contains match.
const SPECIALIZATION_HINTS = {
  anxiety: ["anxiety", "panic"],
  depression: ["depression", "mood"],
  sleep: ["sleep", "insomnia"],
  stress: ["stress", "burnout"],
  relationship: ["relationship", "couple", "marital", "marriage"],
  family: ["family", "parent"],
  trauma: ["trauma", "ptsd", "abuse", "ssa", "sexual abuse"],
  addiction: ["addiction", "substance", "de-addiction"],
  career: ["career", "occupational", "work", "professional"],
  studies: ["student", "academic", "youth", "adolescent"],
  women_health: ["women", "gynec", "female", "ob/gyn"],
  men_health: ["men", "andrology", "male"],
  general_health: ["general", "wellbeing", "wellness", "psycholog", "psychiat"],
};

const normalize = (s) => String(s || "").toLowerCase();

// Extract which topics the user is bringing up. Multiple topics possible.
const detectTopics = (message) => {
  const text = normalize(message);
  const hits = new Set();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) hits.add(topic);
  }
  return Array.from(hits);
};

// Specialization match score for one counsellor against detected topics.
// Each topic that matches the counsellor's specialization adds points.
const specializationScore = (counsellor, topics) => {
  if (!topics.length) return 0;
  const specs = (counsellor.specialization || []).map(normalize);
  if (!specs.length) return 0;

  let score = 0;
  let matchedTopics = [];
  for (const topic of topics) {
    const hints = SPECIALIZATION_HINTS[topic] || [];
    const matched = hints.some((hint) => specs.some((s) => s.includes(hint)));
    if (matched) {
      score += 30; // strong signal
      matchedTopics.push(topic);
    }
  }
  return { score, matchedTopics };
};

// Soft gender preference. We DO NOT hard-filter — that would exclude great
// counsellors. Just nudge the score for likely-better matches.
const genderScore = (counsellor, userGender, topics) => {
  if (!userGender || !counsellor.gender) return 0;

  const cGender = normalize(counsellor.gender);
  const uGender = normalize(userGender);

  // Topic-driven preferences (heuristic, soft):
  // - Female user + trauma / women_health / relationship → prefer female
  // - Male user + men_health → prefer male
  const sensitiveForFemale =
    topics.includes("trauma") ||
    topics.includes("women_health") ||
    topics.includes("relationship");
  const sensitiveForMale = topics.includes("men_health");

  if (uGender === "female" && cGender === "female" && sensitiveForFemale) return 15;
  if (uGender === "male" && cGender === "male" && sensitiveForMale) return 15;

  // Same-gender baseline nudge (very small) so when topics don't drive a
  // preference, a same-gender counsellor still ranks ahead all else equal.
  if (cGender === uGender) return 4;

  return 0;
};

// Age-bucket bonus: teens get adolescent specialists, elderly get geriatric.
const ageScore = (counsellor, userAge) => {
  if (!userAge || !Number.isFinite(userAge)) return 0;
  const specs = (counsellor.specialization || []).map(normalize);
  const has = (kw) => specs.some((s) => s.includes(kw));

  if (userAge < 20 && (has("adolescent") || has("youth") || has("student"))) return 10;
  if (userAge >= 60 && (has("geriatric") || has("elderly") || has("senior"))) return 10;
  return 0;
};

// Quality tiebreakers — rating and experience.
const qualityScore = (counsellor) => {
  const rating = Number(counsellor.rating) || 0;
  const exp = Number(counsellor.experience) || 0;
  // Rating contributes more than raw years; cap to avoid runaways.
  return Math.min(rating, 5) * 4 + Math.min(exp, 20) * 0.5;
};

// Rank counsellors. Returns an array of { counsellor, score, breakdown,
// matchedTopics } sorted descending by score.
export const rankCounsellors = ({
  counsellors,
  message,
  userGender,
  userAge,
} = {}) => {
  if (!Array.isArray(counsellors) || counsellors.length === 0) return [];

  const topics = detectTopics(message);

  const scored = counsellors.map((c) => {
    const { score: specScore, matchedTopics } = (() => {
      const r = specializationScore(c, topics);
      return typeof r === "number" ? { score: r, matchedTopics: [] } : r;
    })();
    const gScore = genderScore(c, userGender, topics);
    const aScore = ageScore(c, userAge);
    const qScore = qualityScore(c);

    return {
      counsellor: c,
      score: specScore + gScore + aScore + qScore,
      breakdown: { specScore, gScore, aScore, qScore },
      matchedTopics,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return { topics, ranked: scored };
};

// Compact, AI-readable summary of the top N counsellors. Goes straight
// into the system prompt so the model has all it needs to recommend a
// specific person with a real "why".
export const formatRankedForPrompt = (ranked, limit = 3) => {
  if (!Array.isArray(ranked) || ranked.length === 0) {
    return "⚠️ NO COUNSELORS ARE CURRENTLY ONLINE.";
  }

  const top = ranked.slice(0, limit);
  return top
    .map((entry, idx) => {
      const c = entry.counsellor;
      const matched = entry.matchedTopics?.length
        ? ` | Matched topics: ${entry.matchedTopics.join(", ")}`
        : "";
      return `${idx + 1}. ${c.fullName} | Gender: ${c.gender || "?"} | Specialization: ${(c.specialization || []).join(", ") || "General"} | Experience: ${c.experience || "N/A"} yrs | Rating: ${c.rating || "N/A"}/5 | Languages: ${(c.languages || []).join(", ") || "N/A"} | Mode: ${(c.consultationMode || []).join(", ") || "N/A"} | MatchScore: ${entry.score.toFixed(1)}${matched}`;
    })
    .join("\n");
};
