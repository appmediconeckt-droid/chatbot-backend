import express from "express";
import {
  loginUser,
  deleteUser,
  getUser,
  getAlluser,
  logout,
  getAllCounsellors,
  getCounsellorById,
  getMyProfile,
  verifyEmailOTP,
  sendEmailOTP,
  sendPhoneOTP,
  verifyPhoneOTP,
  completeRegistration,
  forgotPassword,
  resetPassword,
  refreshAccessTokenHandler,
  logoutAllDevices,
  getMySessions,
  updateUserById,
  logoutOtherDevicesAndSendOTP,
  verifyLoginOTP,
} from "../controllers/authController.js";
import { body } from "express-validator";
import { verifyOtp } from "../middleware/verifyOtp.js";
// refreshToken middleware import removed — route uses refreshAccessTokenHandler from authController
import { authMiddleware } from "../middleware/authMiddleware.js";
import { generateOtp } from "../utils/generateOtp.js";
import { resendOtp } from "../utils/resendOtp.js";
import {
  handleUserUpload,
  uploadProfilePhoto,
} from "../middleware/multerConfig.js";

export const authRoutes = express.Router();

// OTP & REGISTRATION FLOW
authRoutes.post("/send-email-otp", sendEmailOTP);
authRoutes.post("/verify-email-otp", verifyEmailOTP);
authRoutes.post("/send-phone-otp", sendPhoneOTP);
authRoutes.post("/verify-phone-otp", verifyPhoneOTP);
authRoutes.post(
  "/complete-registration",
  uploadProfilePhoto,
  completeRegistration,
);

// AUTHENTICATION ROUTES
authRoutes.post("/login", loginUser);
// NEW routes for the one‑device flow
authRoutes.post("/logout-other-devices", logoutOtherDevicesAndSendOTP);
authRoutes.post("/verify-login-otp", verifyLoginOTP);

authRoutes.post("/logout", authMiddleware, logout);
authRoutes.post("/refresh-token", refreshAccessTokenHandler);
authRoutes.post("/logout-all", authMiddleware, logoutAllDevices);
authRoutes.get("/my-sessions", authMiddleware, getMySessions);

// OTP ROUTES For Login
authRoutes.post("/generateOtp", generateOtp);
authRoutes.post("/verifyOtp", verifyOtp);
authRoutes.post("/resendOtp", resendOtp);

// PUBLIC COUNSELLOR ROUTES
authRoutes.get("/counsellors", getAllCounsellors);
authRoutes.get("/counsellors/:counsellorId", getCounsellorById);

// PROTECTED ROUTES
authRoutes.get("/me", authMiddleware, getMyProfile);
authRoutes.get("/getUser/:userId", getUser);
authRoutes.get("/getAllUser", authMiddleware, getAlluser);

// UPDATE ROUTE - Uses handleUserUpload for both profile photo and certifications
authRoutes.patch(
  "/update/:userId",
  authMiddleware,
  handleUserUpload,
  updateUserById,
);

authRoutes.delete("/delete", authMiddleware, deleteUser);

// PASSWORD RESET ROUTES
authRoutes.post(
  "/forgotPassword",
  [body("email").isEmail().withMessage("Please provide a valid email")],
  forgotPassword,
);

authRoutes.post(
  "/resetPassword/:token",
  [
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("confirmPassword").custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error("Passwords do not match");
      }
      return true;
    }),
  ],
  resetPassword,
);

export default authRoutes;
