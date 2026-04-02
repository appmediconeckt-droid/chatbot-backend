import OTP from "../models/otpModel.js";
import User from "../models/userModel.js";
import { sendOtpMail } from "../utils/sendMail.js";

// ================= RESEND OTP (Simplified) =================
export const resendOtp = async (req, res) => {
  try {
    const { email } = req.body;

    // Find user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
        success: false
      });
    }

    // Generate new OTP
    const otp = Math.floor(100000 + Math.random() * 900000);

    // Delete old OTPs
    await OTP.deleteMany({ userId: user._id });

    // Save new OTP
    await OTP.create({
      userId: user._id,
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
    });

    // Send email
    await sendOtpMail(user.email, otp);

    return res.status(200).json({
      message: "OTP resent successfully",
      success: true
    });

  } catch (error) {
    console.log(error);
    
    return res.status(500).json({
      message: "Error in resending OTP",
      success: false
    });
  }
};