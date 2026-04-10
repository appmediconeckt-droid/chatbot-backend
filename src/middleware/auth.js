import jwt from "jsonwebtoken";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";

export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    // Use ACCESS_SECRET (or JWT_SECRET as fallback)
    const secret = process.env.ACCESS_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);

    // Support both 'userId' and 'id' fields
    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    if (!decoded.sessionId) {
      return res
        .status(401)
        .json({ error: "Session is required. Please login again." });
    }

    const activeSession = await Session.findOne({
      _id: decoded.sessionId,
      userId,
      isActive: true,
    });

    if (!activeSession) {
      return res
        .status(401)
        .json({ error: "Session expired or logged out from another device" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (!user.isActive) {
      return res.status(401).json({ error: "Account is deactivated" });
    }

    req.user = user;
    req.userId = user._id;
    req.userType = user.role;
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

export const authenticateSocket = async (socket, next) => {
  try {
<<<<<<< HEAD
    const token = socket.handshake.auth.token;

=======
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];
    
>>>>>>> a08d7822750d80e75aa0bad21029d20f488cb7fd
    if (!token) {
      return next(new Error("Authentication required"));
    }
<<<<<<< HEAD

=======
    
>>>>>>> a08d7822750d80e75aa0bad21029d20f488cb7fd
    const secret = process.env.ACCESS_SECRET || process.env.JWT_SECRET;
    const decoded = jwt.verify(token, secret);
    const userId = decoded.userId || decoded.id;

    if (!userId) {
<<<<<<< HEAD
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
=======
      return next(new Error('Invalid token payload'));
    }

    const user = await User.findById(userId).select('_id role isActive');
    if (!user) {
      return next(new Error('User not found'));
    }

    if (!user.isActive) {
      return next(new Error('Account is deactivated'));
    }
    
    socket.userId = user._id.toString();
    socket.userRole = user.role;
    socket.user = user;
    
    next();
>>>>>>> a08d7822750d80e75aa0bad21029d20f488cb7fd
  } catch (error) {
    console.error("Socket auth error:", error);
    next(new Error("Authentication failed"));
  }
};
