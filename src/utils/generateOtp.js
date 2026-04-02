import OTP from "../models/otpModel.js";
import User from "../models/userModel.js";
import { sendOtpMail } from "../utils/sendMail.js";

export const generateOtp = async (req, res) => {
  try {

    const { email } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        message: "User not found",
        success: false
      });
    }

    const otp = Math.floor(100000 + Math.random() * 900000);

    // delete old OTPs
    await OTP.deleteMany({ userId: user._id });

    await OTP.create({
      userId: user._id,
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    await sendOtpMail(user.email, otp);

    return res.status(200)
      .json({
        message: "OTP sent successfully",
        success: true
      });

  } catch (error) {

    console.log(error);

    return res.status(500).json({
      message: "Error in generating OTP",
      success: false
    });

  }
};