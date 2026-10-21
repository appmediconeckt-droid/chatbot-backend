export const ANONYMOUS_USER_NAME = "Anonymous User";

const asTrimmedString = (value) =>
  typeof value === "string" ? value.trim() : "";

export const getAnonymousUserName = (
  user,
  fallback = ANONYMOUS_USER_NAME,
) => {
  const anonymous = asTrimmedString(user?.anonymous);
  return anonymous || fallback;
};

// Patient avatars are stored in profilePhoto by the profile update endpoint.
// Legacy real photos must remain private when returning counselor-facing data.
export const getUserAvatarForCounselor = (user) => {
  const photo = user?.profilePhoto;
  const url = asTrimmedString(typeof photo === "string" ? photo : photo?.url);
  return /^https:\/\/api\.dicebear\.com\//i.test(url) || /^data:image\//i.test(url)
    ? url
    : null;
};

export const sanitizeUserForCounselor = (user, fallbackId = null) => {
  if (!user) {
    return fallbackId
      ? {
          id: String(fallbackId),
          _id: String(fallbackId),
          name: ANONYMOUS_USER_NAME,
          fullName: "",
          anonymous: ANONYMOUS_USER_NAME,
          email: "",
          profilePhoto: null,
          avatar: null,
          avatarUrl: null,
        }
      : null;
  }

  const id = user._id || user.id || fallbackId;
  const anonymous = getAnonymousUserName(user);
  const avatarUrl = getUserAvatarForCounselor(user);

  return {
    id: id ? String(id) : null,
    _id: id ? String(id) : null,
    name: anonymous,
    fullName: "",
    anonymous,
    email: "",
    gender: user.gender || "",
    age: user.age || null,
    dateOfBirth: user.dateOfBirth || null,
    isActive: Boolean(user.isActive),
    isOnline: Boolean(user.isOnline),
    online: Boolean(user.isOnline),
    lastSeen: user.lastSeen || null,
    profilePhoto: null,
    avatar: avatarUrl,
    avatarUrl,
    anonymousAvatarUrl: avatarUrl,
    Image: null,
  };
};
