import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import mongoose from "mongoose";

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const secret = process.env.ACCESS_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    const userId = decoded.userId || decoded.id;
    const sessionId = decoded.sessionId;
    const role = decoded.role;

    if (!userId || !sessionId || !role) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // ✅ Validate session only (important for one-device policy)
    const activeSession = await Session.findOne({
      _id: sessionId,
      userId,
      isActive: true,
    });

    if (!activeSession) {
      return res.status(401).json({
        error: "Session expired or logged out from another device",
      });
    }

    // ✅ Attach clean user info (NO extra DB call)
    req.user = {
      _id: userId,
      userId,
      role,
      sessionId,
    };

    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }

    console.error("Auth error:", error);
    return res.status(500).json({ error: "Authentication error" });
  }
};

export const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "Access denied: Insufficient permissions",
      });
    }
    next();
  };
};

export const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;

    if (!token) {
      return next(new Error("Authentication required"));
    }
    const secret = process.env.ACCESS_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    const userId = decoded.userId || decoded.id;

    if (!userId) {
      return next(new Error("Invalid token payload"));
    }

    User.findById(userId)
      .then((user) => {
        if (!user || !user.isActive) {
          return next(new Error("User not found or inactive"));
        }

        socket.userId = user._id.toString();
        socket.userRole = user.role;
        return next();
      })
      .catch((error) => {
        console.error("Socket auth user lookup error:", error);
        return next(new Error("Authentication failed"));
      });
  } catch (error) {
    console.error("Socket auth error:", error);
    next(new Error("Authentication failed"));
  }
};

