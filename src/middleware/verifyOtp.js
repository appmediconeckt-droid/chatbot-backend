import { verifyLoginOTP } from "../controllers/authController.js";
import { DEMO_ACCOUNT_EMAILS } from "../models/demoOtpConfigModel.js";
import OTP from "../models/otpModel.js";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import { accountDeletionPending } from "../services/accountDeletionService.js";
import { generateAccessToken, generateRefreshToken } from "../utils/token.js";

export const verifyOtp = async (req, res) => {
  try {
    const { email: rawEmail, otp } = req.body || {};
    if (typeof rawEmail !== "string" || !rawEmail.trim() ||
      typeof otp !== "string" || !/^\d{6}$/.test(otp)) {
      return res.status(400).json({ message: "Valid email and six-digit OTP are required", success: false });
    }
    const email = rawEmail.trim().toLowerCase();

    // 1. Find user
    if (DEMO_ACCOUNT_EMAILS.includes(String(email || "").trim().toLowerCase())) {
      if (typeof req.body.password !== "string" || !req.body.password) {
        return res.status(401).json({ success: false, code: "REVIEW_PASSWORD_REQUIRED", message: "Enter the review account password to continue" });
      }
      return verifyLoginOTP(req, res);
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: "User not found", success: false });
    }
    if (!user.isActive || await accountDeletionPending(user._id)) {
      return res.status(401).json({ message: "Account is unavailable", success: false });
    }

    // 2. Find valid OTP
    // Consume atomically with expiry in the query. Concurrent replays cannot
    // create multiple sessions, and MongoDB TTL cleanup timing is irrelevant.
    const otpDoc = await OTP.findOneAndDelete({ userId: user._id, otp, expiresAt: { $gt: new Date() } });
    if (!otpDoc) {
      return res.status(400).json({ message: "Invalid or expired OTP", success: false });
    }

    // Multi-device policy: keep prior sessions active; just create one for this device.

    // 4. Create a new session FIRST (to get its _id)
    const newSession = new Session({
      userId: user._id,
      isActive: true,
      createdAt: new Date(),
      // Do NOT store accessToken here – only refreshToken will be added
    });

    // 5. Generate tokens WITH the session ID
    const accessToken = generateAccessToken(user._id, newSession._id, user.role);
    const refreshToken = generateRefreshToken(user._id, newSession._id, user.role);

    // 6. Now save the refreshToken into the session
    newSession.refreshToken = refreshToken;
    await newSession.save();

    // The accepted OTP was consumed above; do not delete a newer resend.

    // 8. Set cookies (works for both development and production)
    const isProduction = process.env.NODE_ENV === "production";
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: isProduction,   // false on localhost (HTTP), true on HTTPS
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    });

    // 9. Return success with user data
    return res.status(200).json({
      message: "Login successful via OTP",
      success: true,
      accessToken,
      refreshToken,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("OTP verification failed");
    return res.status(500).json({
      message: "OTP verification failed",
      success: false,
    });
  }
};
// export const verifyOtp = async (req, res) => {
//   try {
    
//     const { email, otp } = req.body;

//     const user = await User.findOne({ email });

//     if (!user) {
//       return res.status(404).json({
//         message: "User not found",
//         success: false
//       });
//     }

//     const otpDoc = await OTP.findOne({
//       userId: user._id,
//       otp
//     });

//     if (!otpDoc) {
//       return res.status(400).json({
//         message: "Invalid OTP",
//         success: false
//       });
//     }

//     // ✅ check expiry
//     if (otpDoc.expiresAt < Date.now()) {
//       return res.status(400).json({
//         message: "OTP expired",
//         success: false
//       });
//     }

//     // ✅ invalidate old sessions
//     await Session.updateMany(
//       { userId: user._id },
//       { isActive: false }
//     );

//     // ✅ generate tokens
//     const accessToken = generateAccessToken(user._id);
//     const refreshToken = generateRefreshToken(user._id);

//     // ✅ create new session
//     await Session.create({
//       userId: user._id,
//       accessToken,
//       refreshToken,
//       isActive: true
//     });

//     // ✅ delete OTP after use
//     await OTP.deleteMany({ userId: user._id });

//     // ✅ send cookies (your system uses cookies) - FIXED CHAINING
//     return res
//       .cookie("accessToken", accessToken, {
//         httpOnly: true,
//         secure: false,
//         sameSite: "strict",
       
//       })
//       .cookie("refreshToken", refreshToken, {
//         httpOnly: true,
//         secure: false,
//         sameSite: "strict",
//       })
//       .status(200)
//       .json({
//         message: "Login successful via OTP",
//         success: true,
//         accessToken, 
//         refreshToken 
//       });

//   } catch (error) {

//     console.log(error);

//     return res.status(500).json({
//       message: "OTP verification failed",
//       success: false
//     });

//   }
// };
// export const verifyOtp = async (req, res) => {

//   try {
    
//     const { email, otp } = req.body;

//     const user = await User.findOne({ email });

//     if (!user) {
//       return res.status(404).json({
//         message: "User not found",
//         success: false
//       });
//     }

//     const otpDoc = await OTP.findOne({
//       userId: user._id,
//       otp
//     });

//     if (!otpDoc) {
//       return res.status(400).json({
//         message: "Invalid OTP",
//         success: false
//       });
//     }

//     // ✅ check expiry
//     if (otpDoc.expiresAt < Date.now()) {
//       return res.status(400).json({
//         message: "OTP expired",
//         success: false
//       });
//     }

//     // ✅ invalidate old sessions
//     await Session.updateMany(
//       { userId: user._id },
//       { isActive: false }
//     );

//     // ✅ generate tokens
//     const accessToken = generateAccessToken(user._id);
//     const refreshToken = generateRefreshToken(user._id);

//     // ✅ create new session
//     await Session.create({
//       userId: user._id,
//       accessToken,
//       refreshToken,
//       isActive: true
//     });

//     // ✅ delete OTP after use
//     await OTP.deleteMany({ userId: user._id });

//     // ✅ send cookies (your system uses cookies)
//     return res.cookie("accessToken", accessToken, {
//         httpOnly: true,
//         secure: false,
//         sameSite: "strict",
//         maxAge: 15 * 60 * 1000
//       })
//       res.cookie("refreshToken", refreshToken, {
//         httpOnly: true,
//         secure: false,
//         sameSite: "strict",
//         maxAge: 7 * 24 * 60 * 60 * 1000
//       })
//       .status(200).json({
//         message: "Login successful via OTP",
//         success: true,
//         accessToken, 
//         refreshToken 
//       });

//   } catch (error) {

//     console.log(error);

//     return res.status(500).json({
//       message: "OTP verification failed",
//       success: false
//     });

//   }
// };
