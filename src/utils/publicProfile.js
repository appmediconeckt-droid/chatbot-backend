// Explicit allowlist: public professional profiles must never include account,
// identity-provider, medical, location-history, banking, or authentication data.
export const publicCounselorProfile = (user) => {
  const source = user?.toObject ? user.toObject() : user;
  return Object.fromEntries(
    [
      "_id",
      "fullName",
      "anonymous",
      "role",
      "profilePhoto",
      "specialization",
      "experience",
      "qualification",
      "education",
      "languages",
      "aboutMe",
      "location",
      "consultationMode",
      "consultationFee",
      "chatFee",
      "rating",
      "totalRatings",
      "isActive",
      "isVerified",
      "isOnline",
      "lastSeen",
      "profileCompleted",
      "patientConversationCount",
    ]
      .filter((key) => source?.[key] !== undefined)
      .map((key) => [key, source[key]])
  );
};
