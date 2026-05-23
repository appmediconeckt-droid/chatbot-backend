// safetyGuard.js
//
// Hard, deterministic safety layer that runs BEFORE we call the LLM. The goal
// is to never let the model improvise on topics where a wrong answer can hurt
// a vulnerable user — especially minors and sexual-abuse victims. When this
// returns a `block` we short-circuit chatController and reply with a fixed,
// vetted message + helpline numbers.

const INDIA_HELPLINES_TEXT =
  "📞 Help is available right now:\n" +
  "• Childline India: 1098 (free, 24/7, for anyone under 18)\n" +
  "• iCall: 9152987821 (counsellor support)\n" +
  "• Vandrevala Foundation: 1860 2662 345 (24/7 mental health)\n" +
  "• Police: 100 / Women & Child helpline: 1091";

// Words / phrases that strongly suggest sexual abuse, coercion, or
// non-consensual contact. Hindi-English mix included.
const ABUSE_PATTERNS = [
  /\bforced?\b.*\b(sex|kiss|touch)\b/i,
  /\bforce(d|fully)?\s+(me|to|by)\b/i,
  /\bsomeone\s+force/i,
  /\b(rape|raped|raping|molested|molesting|molestation)\b/i,
  /\b(zabardasti|jabardasti|zabran|jabran)\b/i,
  /\b(no\s+consent|without\s+consent|did\s+not\s+want)\b/i,
  /\bpregnant\b.*\b(force|forced|forcefully|rape|raped)\b/i,
  /\b(force|forced|forcefully)\b.*\bpregnant\b/i,
  /\babuse(d|s|ing)?\b.*\b(me|sexual)\b/i,
  /\bunsafe\s+touch/i,
  /\b(beat|hit|hurt)\s+me\b/i,
];

// "How to" sexual content requests. Combined with minor-age this becomes a
// hard block. With unknown age we still gate the response to redirect.
const SEXUAL_HOWTO_PATTERNS = [
  /\bhow\s+(do|to|can)\s+(i|we|you)\b.*\b(sex|intercourse|orgasm|condom|protection|masturbat)/i,
  /\b(use|apply|wear|put\s+on)\b.*\b(condom)\b/i,
  /\bsex\s+(position|steps|guide|tutorial|tips)\b/i,
  /\bdaily\s+sex\b/i,
  /\bsex\s+(habit|daily)\b/i,
  /\b(want|need|chahiye|chahta|chahti)\b.*\b(sex|boy|girl|partner)\b.*\b(daily|roj|everyday)\b/i,
];

// Any sexual-topic mention (broader than how-to). Used to gate the "unknown
// age" branch — if the user is asking ANYTHING sex-related and we don't know
// their age, ask their age before answering.
const SEXUAL_TOPIC_PATTERNS = [
  /\b(sex|sexual|intercourse|condom|condoms|protection|contraceptiv|masturbat|orgasm|porn|erection|ejaculat)\b/i,
  /\b(sambhog|sex\s*karna|sex\s*kaise)\b/i,
];

const hasSexualTopic = (message) => {
  const m = String(message || "");
  return SEXUAL_TOPIC_PATTERNS.some((re) => re.test(m));
};

// Did the conversation history show we already asked for age? Used to avoid
// re-asking in a loop if user keeps pressing on sexual topics without giving
// age — after one ask we let it fall through to the soft refusal instead.
const alreadyAskedForAge = (history = []) => {
  if (!Array.isArray(history)) return false;
  return history.some(
    (turn) =>
      turn.role === "assistant" &&
      typeof turn.content === "string" &&
      /could you share your age|aapki umar/i.test(turn.content),
  );
};

// Risky minor-context signals: a self-reported child age + sexual topic.
const PREGNANCY_PATTERNS = [
  /\b(i'?m|im|mai|main|me)\s+(pregnant|garbhwati|garbhvati)\b/i,
  /\bpregnant\b.*\b(at|age|saal|year)\s*(\d{1,2})\b/i,
];

const isMinorAge = (age) =>
  typeof age === "number" && Number.isFinite(age) && age < 18;

const isSelfReportedMinor = (message) => {
  const m = String(message || "").toLowerCase();
  const re = /\b(?:i'?m|im|i am|mai|main|me)\s*(\d{1,2})\s*(?:year|years|saal|yo|y\.?o\.?)\b/i;
  const match = m.match(re);
  if (!match) return false;
  const age = parseInt(match[1], 10);
  return Number.isFinite(age) && age >= 5 && age < 18;
};

const hasAbuseSignal = (message) => {
  const m = String(message || "");
  return ABUSE_PATTERNS.some((re) => re.test(m));
};

const hasSexualHowTo = (message) => {
  const m = String(message || "");
  return SEXUAL_HOWTO_PATTERNS.some((re) => re.test(m));
};

const hasPregnancyDisclosure = (message) => {
  const m = String(message || "");
  return PREGNANCY_PATTERNS.some((re) => re.test(m));
};

// Whole-conversation context: any earlier user turn that mentioned being
// a minor or being abused stays "sticky" — the model shouldn't suddenly
// give safe-sex tips later in the chat just because the latest message
// looks innocent.
const conversationFlagsAbuse = (history = []) => {
  if (!Array.isArray(history)) return false;
  return history.some(
    (turn) =>
      turn.role === "user" &&
      typeof turn.content === "string" &&
      (hasAbuseSignal(turn.content) || hasPregnancyDisclosure(turn.content)),
  );
};

const conversationFlagsMinor = (history = [], knownAge) => {
  if (isMinorAge(knownAge)) return true;
  if (!Array.isArray(history)) return false;
  return history.some(
    (turn) =>
      turn.role === "user" &&
      typeof turn.content === "string" &&
      isSelfReportedMinor(turn.content),
  );
};

// The main entry. Returns either:
//   { block: false } — let normal flow continue
//   { block: true, reply: string, reason: string } — short-circuit, reply this
export const evaluateSafety = ({
  message,
  history,
  knownAge,
} = {}) => {
  const text = String(message || "");

  const minorInPlay =
    isMinorAge(knownAge) ||
    isSelfReportedMinor(text) ||
    conversationFlagsMinor(history, knownAge);

  const abuseInPlay =
    hasAbuseSignal(text) ||
    hasPregnancyDisclosure(text) ||
    conversationFlagsAbuse(history);

  // Highest priority: any abuse signal, regardless of age — switch to crisis
  // tone and the right helplines. For minors this is mandatory.
  if (abuseInPlay) {
    return {
      block: true,
      reason: "abuse_signal",
      reply:
        "What you're sharing sounds really serious, and I'm so sorry you're going through this. You did the right thing by reaching out. " +
        "Please talk to a trusted adult right now — a parent, teacher, school counsellor, or any safe family member. " +
        (minorInPlay
          ? "Because you're under 18, the safest thing is to call **Childline 1098** straight away — it's free, confidential, and the people there will protect you and help you with medical care, safety, and next steps. "
          : "If you're in immediate danger, call **112** (emergency) or the **Women & Child helpline 1091**. ") +
        "You are not at fault for what happened, and you deserve help and safety.\n\n" +
        INDIA_HELPLINES_TEXT,
    };
  }

  // Minor + sexual how-to / sex-habit request → refuse the explicit content
  // and redirect to safe adults & medical help. Never give step-by-step
  // sexual instructions to a minor.
  if (minorInPlay && hasSexualHowTo(text)) {
    return {
      block: true,
      reason: "minor_sexual_howto",
      reply:
        "I can hear there's a lot going on for you, but because you're under 18 I'm not the right person to give step-by-step advice about sexual activity. " +
        "What I *can* do is help you find someone safe to talk to. Please reach out to a trusted adult, a school counsellor, or a doctor — they can guide you privately and without judgement. " +
        "If you ever feel pressured or unsafe, **Childline 1098** is free, confidential and available 24/7.\n\n" +
        INDIA_HELPLINES_TEXT,
    };
  }

  // Minor + sexual context (without explicit how-to) — soft redirect.
  if (minorInPlay && /\b(sex|sexual|intercourse|partner)\b/i.test(text)) {
    return {
      block: true,
      reason: "minor_sexual_topic",
      reply:
        "It's good that you're asking, but because you're under 18, the safest place for these questions is a doctor or a trusted adult, not a chatbot. " +
        "If anything has happened that didn't feel okay, please call **Childline 1098** — they'll listen and help, and it stays private. " +
        "I'm here to support you with how you're feeling, school stress, family stuff, or anything else on your mind.",
    };
  }

  // Unknown age + sexual topic → ask age once before answering. Children and
  // adults get very different answers, and refusing without explanation feels
  // dismissive to adults. We only ask ONCE per conversation (alreadyAskedForAge
  // gate) so we don't loop. If they refuse to share, the request still falls
  // through to Gemini, which will be conservative thanks to the system prompt.
  const ageUnknown =
    !isMinorAge(knownAge) &&
    (typeof knownAge !== "number" || !Number.isFinite(knownAge));
  if (ageUnknown && hasSexualTopic(text) && !alreadyAskedForAge(history)) {
    return {
      block: true,
      reason: "age_needed_for_sexual_topic",
      reply:
        "Happy to help with this — but the right answer depends on your age. Could you share your age first? " +
        "I share general health info with adults (18+), and for under-18 I'll point you to a doctor or trusted adult so you get the safest guidance. " +
        "Aapki umar kya hai? (Just type the number, e.g. \"22\".)",
    };
  }

  return { block: false };
};

export const SAFETY_HELPLINES_TEXT = INDIA_HELPLINES_TEXT;
