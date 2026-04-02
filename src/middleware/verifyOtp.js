import OTP from "../models/otpModel.js";
import User from "../models/userModel.js";
import Session from "../models/sessionModel.js";
import { generateAccessToken, generateRefreshToken } from "../utils/token.js";

export const verifyOtp = async (req, res) => {
  try {
    
    const { email, otp } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
        success: false
      });
    }

    const otpDoc = await OTP.findOne({
      userId: user._id,
      otp
    });

    if (!otpDoc) {
      return res.status(400).json({
        message: "Invalid OTP",
        success: false
      });
    }

    // ✅ check expiry
    if (otpDoc.expiresAt < Date.now()) {
      return res.status(400).json({
        message: "OTP expired",
        success: false
      });
    }

    // ✅ invalidate old sessions
    await Session.updateMany(
      { userId: user._id },
      { isActive: false }
    );

    // ✅ generate tokens
    const accessToken = generateAccessToken(user._id);
    const refreshToken = generateRefreshToken(user._id);

    // ✅ create new session
    await Session.create({
      userId: user._id,
      accessToken,
      refreshToken,
      isActive: true
    });

    // ✅ delete OTP after use
    await OTP.deleteMany({ userId: user._id });

    // ✅ send cookies (your system uses cookies) - FIXED CHAINING
    return res
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: false,
        sameSite: "strict",
        maxAge: 15 * 60 * 1000
      })
      .cookie("refreshToken", refreshToken, {
        httpOnly: true,
        secure: false,
        sameSite: "strict",
        maxAge: 7 * 24 * 60 * 60 * 1000
      })
      .status(200)
      .json({
        message: "Login successful via OTP",
        success: true,
        accessToken, 
        refreshToken 
      });

  } catch (error) {

    console.log(error);

    return res.status(500).json({
      message: "OTP verification failed",
      success: false
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