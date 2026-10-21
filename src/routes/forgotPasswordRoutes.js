import { authRateLimit } from "../middleware/authRateLimit.js";
// routes/forgotPasswordRoutes.js
import express from 'express';
import {
  sendForgotPasswordOTP,
  verifyForgotPasswordOTP,
  resetPassword,
  resendForgotPasswordOTP,
} from '../controllers/forgotPasswordController.js';

const router = express.Router();

// Send OTP to email
router.post('/send-forgot-password-otp', authRateLimit, sendForgotPasswordOTP);

// Verify OTP
router.post('/verify-forgot-password-otp', authRateLimit, verifyForgotPasswordOTP);

// Reset password
router.post('/reset-password', authRateLimit, resetPassword);

// Resend OTP
router.post('/resend-forgot-password-otp', authRateLimit, resendForgotPasswordOTP);

export default router;