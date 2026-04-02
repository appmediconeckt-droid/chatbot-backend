import jwt from "jsonwebtoken";
import Session from "../models/sessionModel.js"
import { generateAccessToken } from "../utils/token.js";
export const refreshAccessToken = async (req, res) => {

  const { refreshToken } = req.body;

  const decoded = jwt.verify(
    refreshToken,
    process.env.REFRESH_SECRET
  );

  const session = await Session.findOne({
    userId: decoded.userId,
    refreshToken,
    isActive: true
  });

  if (!session) {
    return res.status(403).json({
      message: "Session expired"
    });
  }

  const newAccessToken = generateAccessToken(decoded.userId);

  res.json({
    accessToken: newAccessToken
  });

};