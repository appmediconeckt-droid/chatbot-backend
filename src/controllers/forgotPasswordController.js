// controllers/forgotPasswordController.js
import User from '../models/User.js'; // <- Ye path aapke hisaab se change karein
import ForgotPasswordToken from '../models/ForgotPasswordToken.js';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ==================== EMAIL CONFIGURATION ====================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASSWORD || 'your-email-password',
  },
});

// ==================== GENERATE OTP ====================
const generateOTP = () => {
  return crypto.randomInt(100000, 999999).toString();
};

// ==================== SEND OTP EMAIL ====================
const sendOTPEmail = async (email, otp) => {
  const mailOptions = {
    from: process.env.EMAIL_USER || 'your-email@gmail.com',
    to: email,
    subject: 'Password Reset OTP - Mediconeckt ChatBot',
    html: `
      <div style="max-width: 600px; margin: 0 auto; padding: 30px; font-family: Arial, sans-serif; background: #f8f9fa; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #667eea; margin: 0;">Mediconeckt ChatBot</h1>
          <p style="color: #666; margin: 5px 0 0;">Your Mental Health Companion</p>
        </div>
        
        <div style="background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
          <h2 style="color: #333; margin-top: 0;">Password Reset Request</h2>
          <p style="color: #666; line-height: 1.6;">We received a request to reset your password. Use the OTP below to reset your password:</p>
          
          <div style="text-align: center; padding: 20px 0; margin: 20px 0; background: #f0f4ff; border-radius: 8px;">
            <div style="font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; font-family: monospace;">
              ${otp}
            </div>
          </div>
          
          <p style="color: #666; font-size: 14px; line-height: 1.6;">
            This OTP is valid for <strong>10 minutes</strong>. If you didn't request a password reset, please ignore this email.
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          
          <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
            © 2024 Mediconeckt ChatBot. All rights reserved.
          </p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};

// ==================== SEND FORGOT PASSWORD OTP ====================
export const sendForgotPasswordOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address',
      });
    }

    const otp = generateOTP();

    await ForgotPasswordToken.create({
      email: email.toLowerCase(),
      otp: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    try {
      await sendOTPEmail(email, otp);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
    }

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your email',
    });
  } catch (error) {
    console.error('Send forgot password OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ==================== VERIFY FORGOT PASSWORD OTP ====================
export const verifyForgotPasswordOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required',
      });
    }

    const tokenRecord = await ForgotPasswordToken.findOne({
      email: email.toLowerCase(),
      otp: otp,
    }).sort({ createdAt: -1 });

    if (!tokenRecord) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP',
      });
    }

    if (!tokenRecord.isValid()) {
      if (tokenRecord.isUsed) {
        return res.status(400).json({
          success: false,
          message: 'This OTP has already been used',
        });
      }
      if (tokenRecord.isExpired()) {
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new one',
        });
      }
    }

    tokenRecord.isUsed = true;
    await tokenRecord.save();

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
    });
  } catch (error) {
    console.error('Verify forgot password OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ==================== RESET PASSWORD ====================
export const resetPassword = async (req, res) => {
  try {
    const { email, newPassword, confirmPassword } = req.body;

    if (!email || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Email, new password, and confirm password are required',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    if (newPassword.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 3 characters long',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    await ForgotPasswordToken.deleteMany({ email: email.toLowerCase() });

    return res.status(200).json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ==================== RESEND OTP ====================
export const resendForgotPasswordOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this email address',
      });
    }

    await ForgotPasswordToken.deleteMany({ email: email.toLowerCase() });

    const otp = generateOTP();

    await ForgotPasswordToken.create({
      email: email.toLowerCase(),
      otp: otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    try {
      await sendOTPEmail(email, otp);
    } catch (emailError) {
      console.error('Email sending error:', emailError);
    }

    return res.status(200).json({
      success: true,
      message: 'New OTP sent successfully',
    });
  } catch (error) {
    console.error('Resend forgot password OTP error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to resend OTP. Please try again.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};