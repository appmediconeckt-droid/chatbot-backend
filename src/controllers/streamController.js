import {
  createStreamUserToken,
  ensureStreamUser,
} from "../services/streamService.js";

export const getStreamToken = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    const userId = await ensureStreamUser(req.user);
    const token = createStreamUserToken(userId);

    return res.status(200).json({
      success: true,
      token,
      userId,
      apiKey: process.env.STREAM_API_KEY || process.env.STEAM_API_KEY,
    });
  } catch (error) {
    console.error("Error generating Stream token:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to generate Stream token",
      details: error.message,
    });
  }
};
