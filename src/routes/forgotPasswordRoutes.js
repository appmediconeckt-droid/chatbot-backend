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
router.post('/send-forgot-password-otp', sendForgotPasswordOTP);

// Verify OTP
router.post('/verify-forgot-password-otp', verifyForgotPasswordOTP);

// Reset password
router.post('/reset-password', resetPassword);

// Resend OTP
router.post('/resend-forgot-password-otp', resendForgotPasswordOTP);

export default router;