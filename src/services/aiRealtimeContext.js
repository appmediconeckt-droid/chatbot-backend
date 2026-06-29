import Session from "../models/sessionModel.js";
import User from "../models/userModel.js";
import { formatRankedForPrompt, rankCounsellors } from "./counsellorMatcher.js";

const joinList = (value, fallback = "not provided") => {
  if (Array.isArray(value)) {
    const filtered = value.map((item) => String(item || "").trim()).filter(Boolean);
    return filtered.length ? filtered.join(", ") : fallback;
  }

  const text = String(value || "").trim();
  return text || fallback;
};

const getCity = (user) =>
  user?.locationData?.current?.city ||
  user?.address?.city ||
  user?.location ||
  "not provided";

const buildUserContext = (user) => {
  if (!user) {
    return "Logged-in user context is not available for this call. Do not claim to know the user's profile.";
  }

  const medical = user.medicalInfo || {};
  const chatContext = user.chatContext || {};

  return [
    `Role: ${user.role || "user"}`,
    `Anonymous handle: ${user.anonymous || "not provided"}`,
    `Age: ${user.age || "not provided"}`,
    `Gender: ${user.gender || "not provided"}`,
    `City/location: ${getCity(user)}`,
    `Current surrounding: ${chatContext.currentSurrounding || "not provided"}`,
    `Current company: ${chatContext.currentCompany || "not provided"}`,
    `Safety flags: ${joinList(chatContext.safetyFlags)}`,
    `Medical context: allergies=${joinList(medical.allergies)}, chronicConditions=${joinList(medical.chronicConditions)}, currentMedications=${joinList(medical.currentMedications)}`,
  ].join("\n");
};

export const buildRealtimeDataContext = async (user) => {
  const counsellors = await User.find({
    role: "counsellor",
    isActive: true,
    profileCompleted: true,
    $or: [
      { "chatPermission.enabled": { $ne: false } },
      { chatPermission: { $exists: false } },
    ],
  })
    .select(
      "fullName role gender specialization experience qualification aboutMe location consultationMode languages rating ratingCount totalSessions isOnline",
    )
    .sort({ rating: -1, experience: -1 })
    .limit(50)
    .lean();

  const counsellorIds = counsellors.map((counsellor) => counsellor._id);
  const activeSessionUserIds = await Session.distinct("userId", {
    userId: { $in: counsellorIds },
    isActive: true,
  });
  const activeSessionIds = new Set(
    activeSessionUserIds.map((userId) => userId.toString()),
  );

  const availableCounsellors = counsellors
    .filter((counsellor) => activeSessionIds.has(counsellor._id.toString()))
    .map((counsellor) => ({
      ...counsellor,
      isOnline: true,
      hasActiveSession: true,
    }));

  const matcherResult = rankCounsellors({
    counsellors: availableCounsellors,
    message: "",
    userGender: user?.gender,
    userAge: user?.age,
  });

  const rankedCounsellors = matcherResult?.ranked || [];

  return `
PROJECT DATA AVAILABLE TO YOU FOR THIS VOICE CALL

USER PROFILE CONTEXT
${buildUserContext(user)}

AVAILABLE COUNSELORS FROM THIS PROJECT
${formatRankedForPrompt(rankedCounsellors, 6)}

COUNSELOR RECOMMENDATION RULES
- Use only counselors listed above. Never invent names, ratings, qualifications, locations, or availability.
- If the user asks for a counselor, says the AI tips are not enough, wants professional help, or sounds high-risk, recommend the best matching counselor from the list.
- Match the user's spoken problem to counselor specialization first, then use rating and experience as tie-breakers.
- Mention the counselor's name, specialization, experience, rating, languages, and mode if available.
- If no counselor is listed, say honestly that no counselor is online right now and guide them to book from the counselor/appointment tab while you continue supporting them.
- Do not reveal private account fields such as email, phone, password, tokens, insurance policy numbers, or internal IDs.
`.trim();
};
