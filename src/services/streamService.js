import { StreamChat } from "stream-chat";

let streamClient = null;
let currentApiKey = "";
let currentApiSecret = "";

const resolveStreamCredentials = () => {
  const apiKey =
    process.env.STREAM_API_KEY?.trim() ||
    process.env.STEAM_API_KEY?.trim() ||
    "";
  const apiSecret =
    process.env.STREAM_API_SECRET?.trim() ||
    process.env.STEAM_API_SECRET?.trim() ||
    "";

  return { apiKey, apiSecret };
};

const getStreamClient = () => {
  const { apiKey, apiSecret } = resolveStreamCredentials();

  if (!apiKey || !apiSecret) {
    const missingFields = [];
    if (!apiKey) missingFields.push("STREAM_API_KEY (or STEAM_API_KEY)");
    if (!apiSecret)
      missingFields.push("STREAM_API_SECRET (or STEAM_API_SECRET)");

    throw new Error(
      `Stream credentials are missing: ${missingFields.join(", ")}.`,
    );
  }

  const credentialsChanged =
    apiKey !== currentApiKey || apiSecret !== currentApiSecret;

  if (!streamClient || credentialsChanged) {
    streamClient = StreamChat.getInstance(apiKey, apiSecret);
    currentApiKey = apiKey;
    currentApiSecret = apiSecret;
  }

  return streamClient;
};

export const ensureStreamUser = async (user) => {
  const client = getStreamClient();

  const userId = String(user?._id || user?.id || "");
  if (!userId) {
    throw new Error("Cannot upsert Stream user without user id.");
  }

  const profilePhoto =
    typeof user?.profilePhoto === "string"
      ? user.profilePhoto
      : user?.profilePhoto?.url || "";

  await client.upsertUsers([
    {
      id: userId,
      name: user?.fullName || user?.name || "User",
      image: profilePhoto,
    },
  ]);

  return userId;
};

export const createStreamUserToken = (userId) => {
  const client = getStreamClient();
  return client.createToken(String(userId));
};
