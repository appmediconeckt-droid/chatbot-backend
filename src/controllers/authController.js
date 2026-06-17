import mongoose from "mongoose";
import User from "../models/userModel.js";
import OTP from "../models/otpModel.js";
import bcrypt from "bcryptjs";
import { formatCertifications } from "../utils/certificationFormatter.js";
import Session from "../models/sessionModel.js";
import { generateAccessToken, generateRefreshToken } from "../utils/token.js";
// import { saveLocalFile, deleteLocalFile } from "../utils/uploadHelper.js";
import otpService from "../services/otpService.js";
import { reverseGeocode } from "../services/geocodingService.js";
import { validationResult } from "express-validator";
import { sendResetPasswordEmail } from "../utils/emailService.js";
import cloudinary from "../config/cloudinary.js";
import {
  uploadToCloudinary,
  deleteFromCloudinary,
} from "../utils/uploadHelper.js";
// import User from "../models/userModel.js";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Twilio client is not used in this controller; removed to reduce bundle size.

// ================= TEMPORARY STORAGE =================
const verifiedUsersStore = new Map();
const emailOTPStore = new Map();
const phoneOTPStore = new Map();
// Store OTPs used for the "logout other devices" login flow
const loginOTPStore = new Map();
// Store OTPs used for unlinking Google accounts (requires confirm)
const unlinkGoogleOTPStore = new Map();

// Profile-change OTP flow (dashboard "edit email / phone"). Keyed by
// `${userId}:${field}` so a user can have at most one pending change per
// field at a time. Each entry holds the OTP + the new value the user wants
// to switch to. Once verified, the entry is moved to verifiedProfileChanges
// and consumed by updateUserById on the next PATCH /update/:userId call.
const profileChangeOTPStore = new Map();
const verifiedProfileChanges = new Map();
const PROFILE_CHANGE_OTP_TTL_MS = 10 * 60 * 1000; // 10 min to enter the OTP
const PROFILE_CHANGE_VERIFIED_TTL_MS = 15 * 60 * 1000; // 15 min to hit Save
const HEX_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const AVATAR_TYPES = new Set(["preset", "initial", "builder"]);

const parseMaybeJson = (value, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
};

const getInitials = (name = "") => {
  const parts = String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) return "U";
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
};

const normalizeHexColor = (value, fallback) => {
  if (!value || typeof value !== "string") return fallback;
  const color = value.trim();
  return HEX_COLOR_REGEX.test(color) ? color.toUpperCase() : fallback;
};

const buildInitialAvatarUrl = ({ initials, backgroundColor, textColor }) => {
  const background = backgroundColor.replace("#", "");
  const color = textColor.replace("#", "");
  const name = encodeURIComponent(initials || "U");

  return `https://ui-avatars.com/api/?name=${name}&background=${background}&color=${color}&bold=true&format=svg`;
};

const buildAvatarUpdate = (body, currentUser, updates) => {
  const rawAvatar = parseMaybeJson(body.avatar, {});
  const avatarInput =
    rawAvatar && typeof rawAvatar === "object" && !Array.isArray(rawAvatar)
      ? rawAvatar
      : {};

  const avatarType =
    body.avatarType ||
    avatarInput.type ||
    (body.avatarUrl || avatarInput.url ? "preset" : undefined);
  const hasAvatarRequest =
    Boolean(body.avatarUrl) ||
    Boolean(body.avatarType) ||
    Boolean(body.avatar) ||
    Boolean(body.avatarBackgroundColor) ||
    Boolean(body.avatarTextColor) ||
    Boolean(body.avatarBuilder);

  if (!hasAvatarRequest || !AVATAR_TYPES.has(avatarType)) {
    return null;
  }

  const backgroundColor = normalizeHexColor(
    body.avatarBackgroundColor || avatarInput.backgroundColor,
    currentUser.avatar?.backgroundColor || "#4F46E5",
  );
  const textColor = normalizeHexColor(
    body.avatarTextColor || avatarInput.textColor,
    currentUser.avatar?.textColor || "#FFFFFF",
  );
  const builder =
    parseMaybeJson(body.avatarBuilder, undefined) ?? avatarInput.builder ?? null;
  const seed = String(body.avatarSeed || avatarInput.seed || currentUser._id);
  const initials = String(
    body.avatarInitials ||
      avatarInput.initials ||
      getInitials(updates.fullName || currentUser.fullName),
  )
    .slice(0, 3)
    .toUpperCase();

  let url = body.avatarUrl || avatarInput.url || "";

  if (avatarType === "initial") {
    url = buildInitialAvatarUrl({ initials, backgroundColor, textColor });
  }

  if (
    (avatarType === "preset" || avatarType === "builder") &&
    url &&
    !/^https?:\/\//i.test(url)
  ) {
    return { error: "avatarUrl must be an http or https URL" };
  }

  return {
    avatar: {
      type: avatarType,
      url,
      initials,
      backgroundColor,
      textColor,
      seed,
      builder,
      updatedAt: new Date(),
    },
    profilePhoto: url ? { url, publicId: null } : undefined,
  };
};

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of profileChangeOTPStore.entries()) {
    if (data.expiresAt < now) profileChangeOTPStore.delete(key);
  }
  for (const [key, data] of verifiedProfileChanges.entries()) {
    if (data.expiresAt < now) verifiedProfileChanges.delete(key);
  }
}, 60 * 1000).unref?.();

const MAX_LOCATION_HISTORY = 20;

const getClientIp = (req) =>
  (req.headers["x-forwarded-for"]?.split(",")[0] || req.socket?.remoteAddress || "").trim();

const markUserOnline = async (userOrId) => {
  const userId = userOrId?._id || userOrId;
  if (!userId) return;

  await User.findByIdAndUpdate(userId, {
    $set: { isOnline: true, lastSeen: null },
  });

  if (userOrId?._id) {
    userOrId.isOnline = true;
    userOrId.lastSeen = null;
  }
};

const markUserOfflineIfNoActiveSessions = async (userId) => {
  if (!userId) return;

  const activeSessionCount = await Session.countDocuments({
    userId,
    isActive: true,
  });

  if (activeSessionCount > 0) return;

  await User.findByIdAndUpdate(userId, {
    $set: { isOnline: false, lastSeen: new Date() },
  });
};

const saveLoginLocationIfProvided = async ({ req, userId }) => {
  const lat = Number(req.body?.latitude);
  const lng = Number(req.body?.longitude);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

  let geo = { address: "", city: "", state: "", country: "" };
  try {
    geo = await reverseGeocode(lat, lng);
  } catch (err) {
    // keep empty address; coords still saved
  }

  const now = new Date();
  const ip = getClientIp(req);

  const current = {
    type: "Point",
    coordinates: [lng, lat], // GeoJSON [lng, lat]
    address: geo.address,
    city: geo.city,
    state: geo.state,
    country: geo.country,
    capturedAt: now,
    ipAddress: ip,
  };

  const historyEntry = {
    coordinates: [lng, lat],
    address: geo.address,
    capturedAt: now,
    event: "login",
    ipAddress: ip,
  };

  await User.findByIdAndUpdate(userId, {
    $set: {
      "locationData.current": current,
      locationConsent: true,
    },
    $push: {
      "locationData.history": {
        $each: [historyEntry],
        $slice: -MAX_LOCATION_HISTORY,
      },
    },
  });
};

// Clean up expired data every hour
setInterval(
  () => {
    const now = Date.now();
    for (const [email, data] of verifiedUsersStore.entries()) {
      if (data.expiresAt < now) verifiedUsersStore.delete(email);
    }
    for (const [email, data] of emailOTPStore.entries()) {
      if (data.expiresAt < now) emailOTPStore.delete(email);
    }
    for (const [email, data] of phoneOTPStore.entries()) {
      if (data.expiresAt < now) phoneOTPStore.delete(email);
    }
    // Clean up login OTPs as well
    for (const [email, data] of loginOTPStore.entries()) {
      if (data.expiresAt < now) loginOTPStore.delete(email);
    }
  },
  60 * 60 * 1000,
);

// Clean up unlink OTPs every hour
setInterval(
  () => {
    const now = Date.now();
    for (const [key, data] of unlinkGoogleOTPStore.entries()) {
      if (data.expiresAt < now) unlinkGoogleOTPStore.delete(key);
    }
  },
  60 * 60 * 1000,
).unref?.();

export const updateUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Removed verbose console logs for production

    // Log all files with their paths
    if (req.files) {
      Object.keys(req.files).forEach((field) => {
        // Removed per-file console logging to reduce noise
      });
    }

    // Find existing user
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    // Prepare updates object
    const updates = {};

    // 1. Handle Profile Photo Upload
    if (
      req.files &&
      req.files["profilePhoto"] &&
      req.files["profilePhoto"][0]
    ) {
      const profileFile = req.files["profilePhoto"][0];
      // console.log(
      //   "Processing profile photo:",
      //   profileFile.originalname,
      //   "URL:",
      //   profileFile.path,
      // );

      // Delete old photo if exists
      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET &&
        currentUser.profilePhoto &&
        currentUser.profilePhoto.publicId
      ) {
        try {
          await cloudinary.uploader.destroy(currentUser.profilePhoto.publicId);
          console.log("Deleted old profile photo");
        } catch (err) {
          console.error("Error deleting old photo:", err);
        }
      }

      updates.profilePhoto = {
        url: profileFile.path,
        publicId: profileFile.filename,
        format: profileFile.format || null,
        bytes: profileFile.bytes || null,
      };
      updates.avatar = {
        type: "uploaded",
        url: profileFile.path,
        initials: getInitials(currentUser.fullName),
        backgroundColor: currentUser.avatar?.backgroundColor || "#4F46E5",
        textColor: currentUser.avatar?.textColor || "#FFFFFF",
        seed: String(currentUser._id),
        builder: null,
        updatedAt: new Date(),
      };
    } else if (req.body.avatarUrl && typeof req.body.avatarUrl === "string" && req.body.avatarUrl.startsWith("http")) {
      // Avatar URL from generator (DiceBear etc.) — store directly, no file upload
      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET &&
        currentUser.profilePhoto &&
        currentUser.profilePhoto.publicId
      ) {
        try {
          await cloudinary.uploader.destroy(currentUser.profilePhoto.publicId);
        } catch (err) {
          console.error("Error deleting old photo on avatar switch:", err);
        }
      }
      updates.profilePhoto = { url: req.body.avatarUrl, publicId: null };
      const avatarUpdate = buildAvatarUpdate(req.body, currentUser, updates);
      if (avatarUpdate?.error) {
        return res.status(400).json({
          success: false,
          message: avatarUpdate.error,
        });
      }
      if (avatarUpdate?.avatar) updates.avatar = avatarUpdate.avatar;
    } else if (req.body.removeProfilePhoto === "true") {
      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET &&
        currentUser.profilePhoto &&
        currentUser.profilePhoto.publicId
      ) {
        try {
          await cloudinary.uploader.destroy(currentUser.profilePhoto.publicId);
        } catch (err) {
          console.error("Error deleting photo on remove:", err);
        }
      }
      updates.profilePhoto = null;
      const initials = getInitials(currentUser.fullName);
      const backgroundColor = currentUser.avatar?.backgroundColor || "#4F46E5";
      const textColor = currentUser.avatar?.textColor || "#FFFFFF";
      updates.avatar = {
        type: "initial",
        url: buildInitialAvatarUrl({ initials, backgroundColor, textColor }),
        initials,
        backgroundColor,
        textColor,
        seed: String(currentUser._id),
        builder: null,
        updatedAt: new Date(),
      };
    } else {
      const avatarUpdate = buildAvatarUpdate(req.body, currentUser, updates);
      if (avatarUpdate?.error) {
        return res.status(400).json({
          success: false,
          message: avatarUpdate.error,
        });
      }
      if (avatarUpdate?.avatar) updates.avatar = avatarUpdate.avatar;
      if (avatarUpdate?.profilePhoto) updates.profilePhoto = avatarUpdate.profilePhoto;
    }

    // 2. Handle Certifications - FIXED: Properly handle document URLs and DELETION
    let processedCertifications = [];

    // Check for certifications to delete
    let certificationsToDelete = [];
    if (req.body.deleteCertificationIds) {
      try {
        certificationsToDelete =
          typeof req.body.deleteCertificationIds === "string"
            ? JSON.parse(req.body.deleteCertificationIds)
            : req.body.deleteCertificationIds;
        console.log("Certifications to delete:", certificationsToDelete);
      } catch (e) {
        console.error("Error parsing deleteCertificationIds:", e);
      }
    }

    // Check for certification files in different formats
    const certificationFiles = [];

    // Check for nested certification files (certifications[0][document] format)
    if (req.files) {
      Object.keys(req.files).forEach((field) => {
        if (field.includes("certifications") && field.includes("document")) {
          // Extract index from field name like "certifications[0][document]"
          const match = field.match(/certifications\[(\d+)\]\[document\]/);
          if (match) {
            const index = parseInt(match[1]);
            certificationFiles[index] = req.files[field][0];
            console.log(
              `Found nested certification file at index ${index}:`,
              req.files[field][0].originalname,
            );
          }
        } else if (field === "certificationDocuments") {
          // Handle flat certificationDocuments array
          req.files[field].forEach((file, idx) => {
            certificationFiles[idx] = file;
            // console.log(
            //   `Found certification file at index ${idx}:`,
            //   file.originalname,
            // );
          });
        }
      });
    }

    // console.log(`Total certification files found: ${certificationFiles.length}`);

    // First, delete the certifications that are marked for deletion
    if (certificationsToDelete.length > 0 && currentUser.certifications) {
      // Find certifications to delete and remove their files from Cloudinary
      const certsToRemove = currentUser.certifications.filter((cert) =>
        certificationsToDelete.includes(cert._id.toString()),
      );

      // Delete files from Cloudinary
      for (const cert of certsToRemove) {
        if (cert.documentPublicId) {
          try {
            await cloudinary.uploader.destroy(cert.documentPublicId);
            // console.log(`Deleted certification file: ${cert.documentPublicId}`);
          } catch (err) {
            // console.error(
            //   `Error deleting certification file ${cert.documentPublicId}:`,
            //   err,
            // );
          }
        }
      }

      // Keep only certifications that are NOT marked for deletion
      const remainingCerts = currentUser.certifications.filter(
        (cert) => !certificationsToDelete.includes(cert._id.toString()),
      );

      // console.log(
      //   `Deleted ${certsToRemove.length} certifications, ${remainingCerts.length} remaining`,
      // );
      processedCertifications = [...remainingCerts];
    }

    // Parse certifications from request body (new/updated certifications)
    if (req.body.certifications) {
      try {
        let certificationsData = req.body.certifications;

        // Parse if it's a JSON string
        if (typeof certificationsData === "string") {
          try {
            certificationsData = JSON.parse(certificationsData);
            // console.log('Parsed certifications from JSON string');
          } catch (e) {
            console.log("Failed to parse as JSON, checking nested format");
          }
        }

        // Handle nested format (certifications[0][name], etc.)
        const hasNestedFormat = Object.keys(req.body).some((key) =>
          key.startsWith("certifications["),
        );

        if (hasNestedFormat) {
          // console.log("Processing nested certifications format");
          const certMap = new Map();

          Object.keys(req.body).forEach((key) => {
            const match = key.match(/certifications\[(\d+)\]\[(\w+)\]/);
            if (match) {
              const index = parseInt(match[1]);
              const field = match[2];
              const value = req.body[key];

              if (!certMap.has(index)) {
                certMap.set(index, {});
              }
              certMap.get(index)[field] = value;
            }
          });

          // Convert map to array with file URLs
          const newCertifications = [];
          certMap.forEach((cert, index) => {
            // Skip if this certification is marked as deleted
            if (cert._id && certificationsToDelete.includes(cert._id)) {
              // console.log(
              //   `Skipping deleted certification with ID: ${cert._id}`,
              // );
              return;
            }

            const certFile = certificationFiles[index];
            const certification = {
              name: cert.name || "",
              issuedBy: cert.issuedBy || "",
              issueDate: cert.issueDate || null,
              expiryDate: cert.expiryDate || null,
              _id: cert._id || undefined,
            };

            if (certFile && certFile.path) {
              console.log(
                `Adding document for certification ${index}:`,
                certFile.originalname,
                "URL:",
                certFile.path,
              );
              certification.documentName = certFile.originalname;
              certification.documentUrl = certFile.path;
              certification.documentPublicId = certFile.filename;
            } else if (
              cert.documentUrl &&
              cert.documentUrl !== "null" &&
              cert.documentUrl !== ""
            ) {
              // Keep existing document
              certification.documentName = cert.documentName || "";
              certification.documentUrl = cert.documentUrl;
              certification.documentPublicId = cert.documentPublicId || null;
              // console.log(
              //   `Keeping existing document for certification ${index}:`,
              //   certification.documentUrl,
              // );
            }

            newCertifications.push(certification);
          });

          // Merge with existing certifications that weren't deleted
          // Filter out any certifications that might be duplicates
          const existingCerts = processedCertifications.filter(
            (existing) =>
              !newCertifications.some(
                (newCert) => newCert._id && newCert._id === existing._id,
              ),
          );

          processedCertifications = [...existingCerts, ...newCertifications];
        }
        // Handle array format
        else if (Array.isArray(certificationsData)) {
          // console.log("Processing array format certifications");
          const newCertifications = certificationsData
            .map((cert, index) => {
              // Skip if this certification is marked as deleted
              if (cert._id && certificationsToDelete.includes(cert._id)) {
                // console.log(
                //   `Skipping deleted certification with ID: ${cert._id}`,
                // );
                return null;
              }

              const certFile = certificationFiles[index];

              if (certFile && certFile.path) {
                // console.log(
                //   `Adding document for certification ${index}:`,
                //   certFile.originalname,
                //   "URL:",
                //   certFile.path,
                // );
                return {
                  ...cert,
                  documentName: certFile.originalname,
                  documentUrl: certFile.path,
                  documentPublicId: certFile.filename,
                };
              }

              // Keep existing document if no new file
              if (
                cert.documentUrl &&
                cert.documentUrl !== "null" &&
                cert.documentUrl !== ""
              ) {
                // console.log(
                //   `Keeping existing document for certification ${index}:`,
                //   cert.documentUrl,
                // );
                return cert;
              }

              // Return certification without document
              return {
                ...cert,
                documentName: cert.documentName || "",
                documentUrl: null,
                documentPublicId: null,
              };
            })
            .filter((cert) => cert !== null); // Remove null entries (deleted certs)

          // Merge with existing certifications that weren't deleted
          const existingCerts = processedCertifications.filter(
            (existing) =>
              !newCertifications.some(
                (newCert) => newCert._id && newCert._id === existing._id,
              ),
          );

          processedCertifications = [...existingCerts, ...newCertifications];
        }
        // Handle object with arrays format
        else if (
          certificationsData.name &&
          Array.isArray(certificationsData.name)
        ) {
          // console.log("Processing object with arrays format");
          let fileIndex = 0;
          const newCertifications = [];

          for (let i = 0; i < certificationsData.name.length; i++) {
            if (
              certificationsData.name[i] &&
              certificationsData.name[i].trim()
            ) {
              // Skip if this certification is marked as deleted
              if (
                certificationsData._id?.[i] &&
                certificationsToDelete.includes(certificationsData._id[i])
              ) {
                // console.log(
                //   `Skipping deleted certification with ID: ${certificationsData._id[i]}`,
                // );
                continue;
              }

              const certFile = certificationFiles[fileIndex];

              const certification = {
                name: certificationsData.name[i],
                issuedBy: certificationsData.issuedBy?.[i] || "",
                issueDate: certificationsData.issueDate?.[i] || null,
                expiryDate: certificationsData.expiryDate?.[i] || null,
                _id: certificationsData._id?.[i] || undefined,
              };

              if (certFile && certFile.path) {
                // console.log(
                //   `Adding document for certification ${i}:`,
                //   certFile.originalname,
                // );
                certification.documentName = certFile.originalname;
                certification.documentUrl = certFile.path;
                certification.documentPublicId = certFile.filename;
                fileIndex++;
              } else if (
                certificationsData.documentUrl?.[i] &&
                certificationsData.documentUrl[i] !== "null" &&
                certificationsData.documentUrl[i] !== ""
              ) {
                // Keep existing document
                certification.documentName =
                  certificationsData.documentName?.[i] || "";
                certification.documentUrl = certificationsData.documentUrl[i];
                certification.documentPublicId =
                  certificationsData.documentPublicId?.[i] || null;
              } else {
                certification.documentName = "";
                certification.documentUrl = null;
                certification.documentPublicId = null;
              }

              newCertifications.push(certification);
            }
          }

          // Merge with existing certifications that weren't deleted
          const existingCerts = processedCertifications.filter(
            (existing) =>
              !newCertifications.some(
                (newCert) => newCert._id && newCert._id === existing._id,
              ),
          );

          processedCertifications = [...existingCerts, ...newCertifications];
        }

        // console.log(
        //   `Processed ${processedCertifications.length} certifications total after deletion and updates`,
        // );

        // Apply certifications update
        updates.certifications = processedCertifications;
        // console.log(
        //   `Added ${processedCertifications.length} certifications to update`,
        // );
      } catch (error) {
        console.error("Error processing certifications:", error);
      }
    } else if (
      req.body.certifications === null ||
      req.body.certifications === ""
    ) {
      updates.certifications = [];
    } else if (certificationsToDelete.length > 0 && !req.body.certifications) {
      // If only deletions happened (no new/updated certifications)
      updates.certifications = processedCertifications;
    }

    // Log final certifications before update
    if (updates.certifications) {
      console.log("Final certifications to save:");
      updates.certifications.forEach((cert, idx) => {
        console.log(`  Cert ${idx}:`, {
          name: cert.name,
          documentUrl: cert.documentUrl,
          documentName: cert.documentName,
          _id: cert._id,
        });
      });
    }

    // 3. Handle basic user fields.
    //
    // SECURITY: email and phoneNumber changes from the dashboard MUST be
    // gated by the profile-change OTP flow. We check each one against the
    // user's current value — if it actually changed, the request must have
    // a matching verified entry produced by /profile-change/verify-otp.
    // Other fields update freely.
    const basicFields = [
      "fullName",
      "anonymous",
      "phoneNumber",
      "age",
      "gender",
      "dateOfBirth",
      "bloodGroup",
      "isActive",
      "isVerified",
      "profileCompleted",
      "email",
    ];

    for (const field of basicFields) {
      if (req.body[field] === undefined || req.body[field] === "") continue;

      // Gate email / phoneNumber changes through the OTP flow.
      if (field === "email") {
        const incoming = String(req.body.email).trim().toLowerCase();
        const current = String(currentUser.email || "").toLowerCase();
        if (incoming !== current) {
          const check = consumeVerifiedProfileChange(userId, "email", incoming);
          if (!check.ok) {
            return res.status(403).json({
              success: false,
              message: check.message,
              field: "email",
            });
          }
          updates.email = incoming;
          updates.isEmailVerified = true;

          // Changing the account email should detach the existing Google link.
          // The profile data stays intact, but future Google sign-in must be
          // performed again against the new email/account state.
          updates.googleEmail = null;
          updates.googleId = undefined;
          updates.authProvider = "local";
        }
        continue;
      }

      if (field === "phoneNumber") {
        const incoming = String(req.body.phoneNumber).replace(/\D/g, "");
        const current = String(currentUser.phoneNumber || "");
        if (incoming !== current) {
          const check = consumeVerifiedProfileChange(userId, "phone", incoming);
          if (!check.ok) {
            return res.status(403).json({
              success: false,
              message: check.message,
              field: "phoneNumber",
            });
          }
          updates.phoneNumber = incoming;
          updates.isPhoneVerified = true;
        }
        continue;
      }

      updates[field] = req.body[field];
    }

    // 4. Handle nested objects
    if (req.body.address) {
      try {
        updates.address =
          typeof req.body.address === "string"
            ? JSON.parse(req.body.address)
            : req.body.address;
      } catch (e) {
        updates.address = req.body.address;
      }
    }

    if (req.body.emergencyContact) {
      try {
        updates.emergencyContact =
          typeof req.body.emergencyContact === "string"
            ? JSON.parse(req.body.emergencyContact)
            : req.body.emergencyContact;
      } catch (e) {
        updates.emergencyContact = req.body.emergencyContact;
      }
    }

    // 5. Handle medicalInfo field (NEW)
    if (req.body.medicalInfo) {
      try {
        updates.medicalInfo =
          typeof req.body.medicalInfo === "string"
            ? JSON.parse(req.body.medicalInfo)
            : req.body.medicalInfo;
      } catch (e) {
        updates.medicalInfo = req.body.medicalInfo;
      }
    }

    // 6. Handle insuranceInfo field (NEW)
    if (req.body.insuranceInfo) {
      try {
        updates.insuranceInfo =
          typeof req.body.insuranceInfo === "string"
            ? JSON.parse(req.body.insuranceInfo)
            : req.body.insuranceInfo;
      } catch (e) {
        updates.insuranceInfo = req.body.insuranceInfo;
      }
    }

    // 7. Handle counsellor-specific fields
    if (currentUser.role === "counsellor") {
      const counsellorFields = [
        "qualification",
        "specialization",
        "experience",
        "location",
        "consultationMode",
        "languages",
        "aboutMe",
        "education",
        "rating",
        "totalSessions",
        "activeClients",
      ];

      counsellorFields.forEach((field) => {
        if (req.body[field] !== undefined && req.body[field] !== "") {
          // Parse JSON strings for array fields
          if (
            ["specialization", "languages", "consultationMode"].includes(
              field,
            ) &&
            typeof req.body[field] === "string"
          ) {
            try {
              updates[field] = JSON.parse(req.body[field]);
            } catch (e) {
              updates[field] = req.body[field].split(",").map((s) => s.trim());
            }
          } else {
            updates[field] = req.body[field];
          }
        }
      });
    }

    // 8a. Auto-set profileCompleted for counsellors when required fields are present
    if (currentUser.role === "counsellor") {
      const mergedSpec = updates.specialization ?? currentUser.specialization;
      const mergedExp = updates.experience ?? currentUser.experience;
      const mergedQual = updates.qualification ?? currentUser.qualification ?? updates.education ?? currentUser.education;
      const mergedLoc = updates.location ?? currentUser.location;
      const specOk = Array.isArray(mergedSpec) ? mergedSpec.length > 0 : !!mergedSpec;
      const hasAllRequired = specOk && !!mergedExp && !!mergedQual && !!mergedLoc;
      if (hasAllRequired) {
        updates.profileCompleted = true;
      }
    }

    // 8. Validate phone number
    if (updates.phoneNumber && updates.phoneNumber.length !== 10) {
      return res.status(400).json({
        message: "Phone number must be 10 digits",
        success: false,
      });
    }

    // 9. Update user
    // console.log("Applying updates...");

    const unsetUpdates = {};
    if (
      Object.prototype.hasOwnProperty.call(updates, "googleEmail") &&
      updates.googleEmail === null
    ) {
      unsetUpdates.googleEmail = "";
      delete updates.googleEmail;
    }
    if (
      Object.prototype.hasOwnProperty.call(updates, "googleId") &&
      updates.googleId === undefined
    ) {
      unsetUpdates.googleId = "";
      delete updates.googleId;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $set: updates,
        ...(Object.keys(unsetUpdates).length > 0 ? { $unset: unsetUpdates } : {}),
      },
      { new: true, runValidators: true },
    ).select("-password -emailOTP -phoneOTP");

    if (!updatedUser) {
      return res.status(404).json({
        message: "User not found after update",
        success: false,
      });
    }

    // 10. Format response with all fields matching frontend structure
    const formattedUser = {
      _id: updatedUser._id,
      fullName: updatedUser.fullName,
      anonymous: updatedUser.anonymous,
      email: updatedUser.email,
      phoneNumber: updatedUser.phoneNumber,
      age: updatedUser.age,
      gender: updatedUser.gender,
      role: updatedUser.role,
      profilePhoto: updatedUser.profilePhoto,
      avatar: updatedUser.avatar,
      isActive: updatedUser.isActive,
      profileCompleted: updatedUser.profileCompleted,
      createdAt: updatedUser.createdAt,
      updatedAt: updatedUser.updatedAt,
      dateOfBirth: updatedUser.dateOfBirth
        ? new Date(updatedUser.dateOfBirth).toISOString().split("T")[0]
        : null,
      bloodGroup: updatedUser.bloodGroup,
      address: updatedUser.address,
      emergencyContact: updatedUser.emergencyContact,
      medicalInfo: updatedUser.medicalInfo,
      insuranceInfo: updatedUser.insuranceInfo,
    };

    // Add counsellor fields if applicable
    if (updatedUser.role === "counsellor") {
      Object.assign(formattedUser, {
        qualification: updatedUser.qualification,
        specialization: updatedUser.specialization,
        experience: updatedUser.experience,
        location: updatedUser.location,
        consultationMode: updatedUser.consultationMode,
        languages: updatedUser.languages,
        aboutMe: updatedUser.aboutMe,
        education: updatedUser.education,
        certifications: updatedUser.certifications,
        rating: updatedUser.rating,
        totalSessions: updatedUser.totalSessions,
        activeClients: updatedUser.activeClients,
        uniqueCode: updatedUser.uniqueCode,
      });
    }

    // console.log(
    //   "Update successful! Certifications saved:",
    //   formattedUser.certifications?.length,
    // );

    return res.status(200).json({
      message: "User updated successfully",
      success: true,
      user: formattedUser,
    });
  } catch (error) {
    console.error("Update user error:", error);

    // Rollback: Delete any uploaded files if error occurred
    if (req.files && req.files["profilePhoto"]) {
      try {
        await cloudinary.uploader.destroy(
          req.files["profilePhoto"][0].filename,
        );
        console.log("Rollback: Deleted profile photo");
      } catch (e) {}
    }
    if (req.files) {
      Object.keys(req.files).forEach((field) => {
        if (
          field.includes("certifications") ||
          field === "certificationDocuments"
        ) {
          req.files[field].forEach(async (file) => {
            try {
              await cloudinary.uploader.destroy(file.filename);
              // console.log(
              //   `Rollback: Deleted certification file ${file.filename}`,
              // );
            } catch (e) {}
          });
        }
      });
    }

    return res.status(500).json({
      message: "Error updating user",
      success: false,
      error: error.message,
    });
  }
};

export const sendEmailOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ message: "Email is required", success: false });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({
        message: "User already exists with this email",
        success: false,
      });
    }

    const otp = otpService.generateOTP();

    try {
      await otpService.sendEmailOTP(email, otp, "User");
      emailOTPStore.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

      return res.status(200).json({
        message: "Email OTP sent successfully",
        success: true,
        email: email,
      });
    } catch (sendError) {
      console.error("OTP sending error:", sendError);
      return res.status(500).json({
        message: "Failed to send OTP. Please try again.",
        success: false,
      });
    }
  } catch (error) {
    console.error("Send email OTP error:", error);
    return res.status(500).json({
      message: "Error sending OTP",
      success: false,
      error: error.message,
    });
  }
};

// ================= STEP 2: VERIFY EMAIL OTP =================
export const verifyEmailOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res
        .status(400)
        .json({ message: "Email and OTP are required", success: false });
    }

    const storedData = emailOTPStore.get(email);

    if (!storedData) {
      return res.status(400).json({
        message: "No OTP found. Please request a new OTP.",
        success: false,
      });
    }

    if (Date.now() > storedData.expiresAt) {
      emailOTPStore.delete(email);
      return res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
        success: false,
      });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    let userVerification = verifiedUsersStore.get(email);
    if (!userVerification) {
      userVerification = {
        isEmailVerified: true,
        isPhoneVerified: false,
        expiresAt: Date.now() + 60 * 60 * 1000,
      };
    } else {
      userVerification.isEmailVerified = true;
    }

    verifiedUsersStore.set(email, userVerification);
    emailOTPStore.delete(email);

    return res.status(200).json({
      message:
        "Email verified successfully. Please verify your phone number next.",
      success: true,
      email: email,
      nextStep: "phone_verification",
    });
  } catch (error) {
    console.error("Verify email OTP error:", error);
    return res.status(500).json({
      message: "Error verifying OTP",
      success: false,
      error: error.message,
    });
  }
};

// ================= STEP 3: SEND PHONE OTP =================
export const sendPhoneOTP = async (req, res) => {
  try {
    const { phoneNumber, email } = req.body;

    if (!phoneNumber) {
      return res
        .status(400)
        .json({ message: "Phone number is required", success: false });
    }

    let userEmail = email;
    let userVerification = null;

    if (userEmail) {
      userVerification = verifiedUsersStore.get(userEmail);
    } else {
      for (const [email, data] of verifiedUsersStore.entries()) {
        if (data.isEmailVerified && !data.isPhoneVerified) {
          userEmail = email;
          userVerification = data;
          break;
        }
      }
    }

    if (!userVerification || !userVerification.isEmailVerified) {
      return res.status(400).json({
        message: "Please verify your email first.",
        success: false,
        requiresEmailFirst: true,
      });
    }

    const cleanedPhone = phoneNumber.replace(/\D/g, "");

    if (cleanedPhone.length !== 10) {
      return res
        .status(400)
        .json({ message: "Phone number must be 10 digits", success: false });
    }

    const existingUser = await User.findOne({ phoneNumber: cleanedPhone });
    if (existingUser) {
      return res
        .status(409)
        .json({ message: "Phone number already registered", success: false });
    }

    const formattedPhone = `+91${cleanedPhone}`;
    const otp = otpService.generateOTP();

    console.log(`📱 Sending Phone OTP to ${formattedPhone}: ${otp}`);

    userVerification.phoneNumber = cleanedPhone;
    userVerification.formattedPhone = formattedPhone;
    verifiedUsersStore.set(userEmail, userVerification);

    phoneOTPStore.set(userEmail, {
      otp,
      phoneNumber: cleanedPhone,
      formattedPhone,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    const isTwilioConfigured = Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      twilioPhoneNumber,
    );

    if (!isTwilioConfigured && process.env.NODE_ENV !== "production") {
      console.warn(
        "Twilio is not configured. Returning OTP in development response only.",
      );
      return res.status(200).json({
        message: "Phone OTP generated in development mode",
        success: true,
        phoneNumber: cleanedPhone,
        email: userEmail,
        devOtp: otp,
      });
    }

    if (!isTwilioConfigured) {
      phoneOTPStore.delete(userEmail);
      userVerification.phoneNumber = undefined;
      userVerification.formattedPhone = undefined;
      verifiedUsersStore.set(userEmail, userVerification);

      return res.status(503).json({
        message: "SMS service is not configured. Please contact support.",
        success: false,
      });
    }

    try {
      const twilioModule = await import("twilio");
      const twilio = twilioModule.default || twilioModule;
      const twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      );

      await twilioClient.messages.create({
        body: `Your verification code is: ${otp}. This code will expire in 10 minutes.`,
        from: twilioPhoneNumber,
        to: formattedPhone,
      });

      return res.status(200).json({
        message: "Phone OTP sent successfully",
        success: true,
        phoneNumber: cleanedPhone,
        email: userEmail,
      });
    } catch (sendError) {
      phoneOTPStore.delete(userEmail);
      userVerification.phoneNumber = undefined;
      userVerification.formattedPhone = undefined;
      verifiedUsersStore.set(userEmail, userVerification);

      console.error("Phone OTP sending error:", {
        code: sendError?.code,
        message: sendError?.message,
        moreInfo: sendError?.moreInfo,
      });

      if (sendError?.code === 21211) {
        return res.status(400).json({
          message: "Invalid phone number format.",
          success: false,
        });
      }

      if (sendError?.code === 21608) {
        return res.status(400).json({
          message:
            "Phone number is not verified for your Twilio trial account. Verify this number in Twilio console or use a paid account.",
          success: false,
        });
      }

      if (sendError?.code === 20003) {
        return res.status(502).json({
          message:
            "Twilio authentication failed. Please verify SMS credentials.",
          success: false,
        });
      }

      return res.status(502).json({
        message: "Failed to send phone OTP via SMS provider.",
        success: false,
      });
    }
  } catch (error) {
    console.error("Send phone OTP error:", error);
    return res.status(500).json({
      message: "Error sending phone OTP",
      success: false,
      error: error.message,
    });
  }
};

// ================= STEP 4: VERIFY PHONE OTP =================
// export const verifyPhoneOTP = async (req, res) => {
//     try {
//         const { phoneNumber, otp, email } = req.body;

//         if (!phoneNumber || !otp) {
//             return res.status(400).json({ message: "Phone number and OTP are required", success: false });
//         }

//         const cleanedPhone = phoneNumber.replace(/\D/g, '');
//         let foundEmail = email;
//         let storedData = null;

//         if (foundEmail) {
//             storedData = phoneOTPStore.get(foundEmail);
//             if (storedData && storedData.phoneNumber !== cleanedPhone) storedData = null;
//         }

//         if (!storedData) {
//             for (const [email, data] of phoneOTPStore.entries()) {
//                 if (data.phoneNumber === cleanedPhone && Date.now() <= data.expiresAt) {
//                     foundEmail = email;
//                     storedData = data;
//                     break;
//                 }
//             }
//         }

//         if (!storedData) {
//             return res.status(400).json({ message: "No OTP found. Please request a new OTP.", success: false });
//         }

//         if (Date.now() > storedData.expiresAt) {
//             phoneOTPStore.delete(foundEmail);
//             return res.status(400).json({ message: "OTP has expired. Please request a new OTP.", success: false });
//         }

//         if (storedData.otp !== otp) {
//             return res.status(400).json({ message: "Invalid OTP", success: false });
//         }

//         const userVerification = verifiedUsersStore.get(foundEmail);
//         if (userVerification) {
//             userVerification.isPhoneVerified = true;
//             userVerification.phoneNumber = cleanedPhone;
//             userVerification.formattedPhone = storedData.formattedPhone;
//             verifiedUsersStore.set(foundEmail, userVerification);
//         }

//         phoneOTPStore.delete(foundEmail);

//         return res.status(200).json({
//             message: "Phone verified successfully. You can now complete your registration.",
//             success: true,
//             email: foundEmail,
//             nextStep: "complete_registration"
//         });

//     } catch (error) {
//         console.error("Verify phone OTP error:", error);
//         return res.status(500).json({ message: "Error verifying phone OTP", success: false, error: error.message });
//     }
// };

// ================= STEP 4: VERIFY PHONE OTP =================
export const verifyPhoneOTP = async (req, res) => {
  try {
    const { phoneNumber, otp, email } = req.body;

    if (!phoneNumber || !otp) {
      return res
        .status(400)
        .json({ message: "Phone number and OTP are required", success: false });
    }

    const cleanedPhone = phoneNumber.replace(/\D/g, "");
    let foundEmail = email;
    let storedData = null;

    if (foundEmail) {
      storedData = phoneOTPStore.get(foundEmail);
      if (storedData && storedData.phoneNumber !== cleanedPhone)
        storedData = null;
    }

    if (!storedData) {
      for (const [email, data] of phoneOTPStore.entries()) {
        if (data.phoneNumber === cleanedPhone && Date.now() <= data.expiresAt) {
          foundEmail = email;
          storedData = data;
          break;
        }
      }
    }

    if (!storedData) {
      return res.status(400).json({
        message: "No OTP found. Please request a new OTP.",
        success: false,
      });
    }

    if (Date.now() > storedData.expiresAt) {
      phoneOTPStore.delete(foundEmail);
      return res.status(400).json({
        message: "OTP has expired. Please request a new OTP.",
        success: false,
      });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    const userVerification = verifiedUsersStore.get(foundEmail);
    if (userVerification) {
      userVerification.isPhoneVerified = true;
      userVerification.phoneNumber = cleanedPhone;
      userVerification.formattedPhone = storedData.formattedPhone;
      verifiedUsersStore.set(foundEmail, userVerification);

      // DEBUG: Log the verification status
      console.log(`✅ Phone verified for ${foundEmail}`);
      console.log(`Verification data:`, {
        isEmailVerified: userVerification.isEmailVerified,
        isPhoneVerified: userVerification.isPhoneVerified,
        expiresAt: new Date(userVerification.expiresAt),
      });
    } else {
      // If no verification entry exists, create one
      verifiedUsersStore.set(foundEmail, {
        isEmailVerified: false, // This should have been set in email verification
        isPhoneVerified: true,
        phoneNumber: cleanedPhone,
        formattedPhone: storedData.formattedPhone,
        expiresAt: Date.now() + 60 * 60 * 1000,
      });
      console.log(
        `⚠️ Created new verification entry for ${foundEmail} (email verification missing)`,
      );
    }

    phoneOTPStore.delete(foundEmail);

    return res.status(200).json({
      message:
        "Phone verified successfully. You can now complete your registration.",
      success: true,
      email: foundEmail,
      nextStep: "complete_registration",
    });
  } catch (error) {
    console.error("Verify phone OTP error:", error);
    return res.status(500).json({
      message: "Error verifying phone OTP",
      success: false,
      error: error.message,
    });
  }
};
// controllers/authController.js

// ================= STEP 5: COMPLETE REGISTRATION =================
export const completeRegistration = async (req, res) => {
  try {
    const {
      fullName,
      anonymous,
      email,
      password,
      age,
      gender,
      qualification,
      specialization,
      experience,
      location,
      consultationMode,
      languages,
      aboutMe,
      // NEW: Patient profile fields (optional)
      dateOfBirth,
      bloodGroup,
      address,
      emergencyContact,
      medicalInfo,
      insuranceInfo,
    } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        message: "Full name, email, and password are required",
        success: false,
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
        success: false,
      });
    }

    // DEBUG: Check what's in verifiedUsersStore
    console.log(`🔍 Checking verification for email: ${email}`);
    // console.log(`All verified users:`, Array.from(verifiedUsersStore.keys()));

    const userVerification = verifiedUsersStore.get(email);

    // DEBUG: Log verification status
    if (userVerification) {
      console.log(`Verification data for ${email}:`, {
        isEmailVerified: userVerification.isEmailVerified,
        isPhoneVerified: userVerification.isPhoneVerified,
        expiresAt: new Date(userVerification.expiresAt),
        now: new Date(),
        isExpired: Date.now() > userVerification.expiresAt,
      });
    } else {
      console.log(`❌ No verification data found for ${email}`);
    }

    // Check if verification exists and is complete
    if (!userVerification) {
      return res.status(400).json({
        message:
          "Please verify your email and phone first. No verification session found.",
        success: false,
      });
    }

    // Check if verification has expired
    if (Date.now() > userVerification.expiresAt) {
      verifiedUsersStore.delete(email);
      return res.status(400).json({
        message:
          "Verification session has expired. Please restart the registration process.",
        success: false,
      });
    }

    // Check both verifications
    if (
      !userVerification.isEmailVerified ||
      !userVerification.isPhoneVerified
    ) {
      const missing = [];
      if (!userVerification.isEmailVerified) missing.push("email");
      if (!userVerification.isPhoneVerified) missing.push("phone");

      return res.status(400).json({
        message: `Please verify your ${missing.join(" and ")} first`,
        success: false,
        missingVerifications: missing,
        status: {
          isEmailVerified: userVerification.isEmailVerified,
          isPhoneVerified: userVerification.isPhoneVerified,
        },
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber: userVerification.phoneNumber }],
    });

    if (existingUser) {
      verifiedUsersStore.delete(email);
      return res.status(409).json({
        message: "User already exists with this email or phone number",
        success: false,
      });
    }

    // Auto-detect role based on counsellor fields
    const hasCounsellorFields =
      qualification && specialization && experience && location;
    const role = hasCounsellorFields ? "counsellor" : "user";

    const hashedPassword = await bcrypt.hash(password, 10);

    // Base user data (common for both roles)
    const userData = {
      fullName,
      anonymous,
      email,
      password: hashedPassword,
      phoneNumber: userVerification.phoneNumber,
      age: age || null,
      gender: gender || "male",
      role,
      profileCompleted: true,
      isEmailVerified: true,
      isActive: true,
      // The 2dsphere index requires a complete GeoJSON Point. Without this,
      // the schema default creates { type: "Point" } without coordinates and
      // MongoDB rejects the insert during registration.
      locationData: {
        current: { type: "Point", coordinates: [0, 0] },
        history: [],
      },
      // NEW: Add patient profile fields (will be null/empty for counsellors initially)
      dateOfBirth: dateOfBirth || null,
      bloodGroup: bloodGroup || null,
      address: address || {
        line1: "",
        line2: "",
        city: "",
        state: "",
        pincode: "",
        country: "India",
      },
      emergencyContact: emergencyContact || {
        name: "",
        relation: "",
        phone: "",
      },
      medicalInfo: medicalInfo || {
        height: "",
        weight: "",
        allergies: [],
        chronicConditions: [],
        currentMedications: [],
      },
      insuranceInfo: insuranceInfo || {
        provider: "",
        policyNumber: "",
        groupNumber: "",
        coverageAmount: "",
        validityDate: null,
        nominee: "",
        relationship: "",
        insuranceType: "",
      },
    };

    // Profile photo handling.
    //
    // Multer + CloudinaryStorage already uploaded the file to Cloudinary by
    // the time we reach this controller — req.file.path is the secure URL
    // and req.file.filename is the public_id. We just need to persist them
    // on the user. (Old code re-uploaded via req.file.buffer, which doesn't
    // exist with CloudinaryStorage, so the upload always failed silently or
    // returned "Invalid file data".)
    //
    // Photo is allowed for BOTH roles — patients can add one too if the UI
    // collects it; we just don't require it.
    if (req.file && req.file.path) {
      userData.profilePhoto = {
        url: req.file.path,
        publicId: req.file.filename,
      };
      console.log(
        `[completeRegistration] Profile photo saved for ${role}: ${req.file.path}`,
      );
    }

    // Add counsellor-specific fields ONLY if role is counsellor
    if (role === "counsellor") {
      userData.qualification = qualification;
      userData.specialization =
        typeof specialization === "string"
          ? specialization.split(",").map((s) => s.trim())
          : specialization;
      userData.experience = Number(experience);
      userData.location = location;
      userData.consultationMode =
        typeof consultationMode === "string"
          ? consultationMode.split(",").map((m) => m.trim())
          : consultationMode || ["online"];
      userData.languages =
        typeof languages === "string"
          ? languages.split(",").map((l) => l.trim())
          : languages || [];
      userData.aboutMe = aboutMe || "";
    }

    const newUser = await User.create(userData);

    // Clean up verification data
    verifiedUsersStore.delete(email);
    emailOTPStore.delete(email);
    phoneOTPStore.delete(email);

    // Generate tokens
    const accessToken = generateAccessToken(newUser._id);
    const refreshToken = generateRefreshToken(newUser._id);

    // Create session
    await Session.create({
      userId: newUser._id,
      refreshToken,
      isActive: true,
      createdAt: new Date(),
    });
    await markUserOnline(newUser);

    // Set cookies
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res.status(201).json({
      message: "Registration completed successfully!",
      success: true,
      user: newUser.toJSON(),
      accessToken,
      refreshToken,
      role: newUser.role,
    });
  } catch (error) {
    console.error("Complete registration error:", error);

    // Rollback: Delete uploaded photo from Cloudinary if registration fails
    if (req.file && profilePhotoData && profilePhotoData.publicId) {
      try {
        await deleteFromCloudinary(profilePhotoData.publicId);
        console.log(
          `Rollback: Deleted uploaded photo ${profilePhotoData.publicId}`,
        );
      } catch (deleteError) {
        console.error("Error rolling back photo upload:", deleteError);
      }
    }

    return res.status(500).json({
      message: "Error completing registration",
      success: false,
      error: error.message,
    });
  }
};

/// ================= LOGIN USER (One‑device policy – now only *detect*) =================
export const loginUser = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        message: "Email, password and role are required",
        success: false,
      });
    }

    const user = await User.findOne({ email });

    if (!user || user.role !== role) {
      return res.status(401).json({
        message: "Invalid credentials or role mismatch",
        success: false,
      });
    }

    if (!user.isActive) {
      return res
        .status(401)
        .json({ message: "Account is deactivated", success: false });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res
        .status(401)
        .json({ message: "Invalid password", success: false });
    }

    // ---- One-device policy: detect any *other* active session ----
    const activeSession = await Session.findOne({
      userId: user._id,
      isActive: true,
    });

    if (activeSession) {
      // Do NOT log the user out here – just tell the client what to do
      return res.status(409).json({
        message: "Already login",
        needLogout: true, // client can use this flag to show the modal
        success: false,
      });
    }

    // ---- No other session → normal login ----
    const sessionId = new mongoose.Types.ObjectId();
    const accessToken = generateAccessToken(
      user._id,
      sessionId.toString(),
      user.role,
    );
    const refreshToken = generateRefreshToken(
      user._id,
      sessionId.toString(),
      user.role,
    );

    // Persist the new session with the same id embedded in JWTs
    await Session.create({
      _id: sessionId,
      userId: user._id,
      refreshToken,
      isActive: true,
    });
    await markUserOnline(user);

    // Optional: if client sends GPS on login, store it (and append history event=login)
    await saveLoginLocationIfProvided({ req, userId: user._id });

    // Set cookies (keep your existing options)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: "Login successful",
      success: true,
      accessToken,
      refreshToken,
      user: user.toJSON(),
      role: user.role,
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      message: "Error in login",
      success: false,
      error: error.message,
    });
  }
};

// ================= GOOGLE OAUTH (Sign-up + Login in one endpoint) =================
// Frontend sends Google ID token (from Google Sign-In SDK).
// Flow:
//   1. Verify token with Google
//   2. If user with email exists → auto-merge (set googleId if missing, log them in)
//   3. If new email → create account (email auto-verified, phone optional, profile incomplete)
//   4. Enforce one-device policy (same as /login)
export const googleAuth = async (req, res) => {
  try {
    const { idToken, role } = req.body;

    if (!idToken) {
      return res.status(400).json({
        message: "Google idToken is required",
        success: false,
      });
    }

    // Default role to "user" if not provided. Frontend should send "user" or "counsellor".
    const requestedRole = role === "counsellor" ? "counsellor" : "user";

    // 1. Verify the Google ID token
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error("Google token verify failed:", verifyErr.message);
      return res.status(401).json({
        message: "Invalid Google token",
        success: false,
      });
    }

    if (!payload || !payload.email) {
      return res.status(401).json({
        message: "Google token did not contain email",
        success: false,
      });
    }

    if (!payload.email_verified) {
      return res.status(401).json({
        message: "Google email is not verified",
        success: false,
      });
    }

    const email = payload.email.toLowerCase();
    const googleId = payload.sub;
    const fullName = payload.name || email.split("@")[0];
    const picture = payload.picture || null;

    // 2. Look up existing user.
    //
    // SECURITY: Google identity is the `sub` (googleId), NOT the email. A
    // user can change their backend email from the dashboard, which means
    // the email in our DB and the email from this Google payload can drift.
    // If we used `$or: [{ email }, { googleId }]` naively, two failure modes
    // appear:
    //   (a) User signs up via Google as a@gmail.com, later changes their
    //       backend email to b@yahoo.com. Signing in again with the same
    //       Google account works (googleId matches) — but their backend
    //       email is no longer the Google email. That's expected.
    //   (b) Worse: a stranger owns a Google account for b@yahoo.com. They
    //       click "Sign in with Google" and Google sends us their sub
    //       (some other googleId) with email=b@yahoo.com. The naive query
    //       matches our existing record by email and we silently log the
    //       stranger into someone else's account.
    //
    // Fix: resolve by googleId first. Only fall back to email match when no
    // googleId record exists, and even then refuse if the matched record is
    // already bound to a *different* googleId.
    let user = await User.findOne({ googleId });

    if (!user) {
      const byEmail = await User.findOne({ email });
      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== googleId) {
          // The email belongs to an account already linked to a different
          // Google identity. Do not merge — that would let any Google user
          // who happens to know this email take over the account.
          return res.status(409).json({
            message:
              "This email is associated with a different Google account. Please sign in with the original Google account.",
            success: false,
            code: "GOOGLE_ID_MISMATCH",
          });
        }
        user = byEmail;
      }
    }

    if (user) {
      // Role mismatch guard — same contract as /login. If the client said
      // "user" but the existing account is a counsellor (or vice-versa),
      // refuse rather than silently logging them in to the wrong dashboard.
      if (user.role !== requestedRole) {
        return res.status(403).json({
          message: `This Google account is registered as ${user.role}. Please pick the ${user.role} role and try again.`,
          success: false,
          code: "ROLE_MISMATCH",
          actualRole: user.role,
          requestedRole,
        });
      }

      // Auto-merge: existing local account (no googleId yet), link Google.
      if (!user.googleId) {
        user.googleId = googleId;
        // Don't overwrite authProvider for existing local users — they can use both
        if (!user.profilePhoto?.url && picture) {
          user.profilePhoto = { url: picture, publicId: null };
        }
        await user.save();
      }

      // Track the last-seen Google email for this identity.
      // If the user previously mirrored their Google email in their profile,
      // keep it synced when Google changes. If they manually customized their
      // profile email, don't overwrite it on login.
      const currentEmail = String(user.email || "").toLowerCase();
      const previousGoogleEmail = String(user.googleEmail || "").toLowerCase();
      const shouldSyncProfileEmail =
        user.authProvider === "google" &&
        (!previousGoogleEmail || currentEmail === previousGoogleEmail);

      if (user.googleId === googleId && email) {
        user.googleEmail = email;

        if (shouldSyncProfileEmail && currentEmail !== email) {
          const taken = await User.findOne({ email, _id: { $ne: user._id } });
          if (taken) {
            return res.status(409).json({
              success: false,
              code: "EMAIL_IN_USE",
              message:
                "Your Google email is already in use by another account. Please contact support.",
            });
          }
          user.email = email;
          user.isEmailVerified = true;
        }

        await user.save();
      }

      if (!user.isActive) {
        return res
          .status(401)
          .json({ message: "Account is deactivated", success: false });
      }
    } else {
      // 3. Create new account from Google profile
      const newUserData = {
        fullName,
        email,
        googleEmail: email,
        googleId,
        authProvider: "google",
        role: requestedRole,
        isEmailVerified: true,
        isActive: true,
        profileCompleted: false, // user still needs to add phone, age, etc.
        // The geo index rejects a Point subdoc without coordinates, but the
        // schema sets type="Point" by default. Initialize with [0,0] so insert
        // succeeds; real coordinates land here when the client sends GPS.
        locationData: {
          current: { type: "Point", coordinates: [0, 0] },
          history: [],
        },
      };

      if (picture) {
        newUserData.profilePhoto = { url: picture, publicId: null };
      }

      user = await User.create(newUserData);
    }

    // 4. One-device policy — Google variant.
    //
    // For local /login we return 409 "Already login" and force the user
    // through an email-OTP confirmation before killing the other device's
    // session, because email+password alone shouldn't let someone bump an
    // existing session (the password could be stolen).
    //
    // Google auth is different: Google has already cryptographically
    // verified the user's identity (we just verified the ID token above).
    // Requiring an extra OTP on top of that is redundant friction. So
    // here we silently terminate any other active sessions and proceed
    // to issue a fresh one — same end state as local login + OTP, just
    // without the extra round-trip.
    await Session.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false, logoutAt: new Date() } },
    );

    // 5. Create new session + tokens
    const sessionId = new mongoose.Types.ObjectId();
    const accessToken = generateAccessToken(
      user._id,
      sessionId.toString(),
      user.role,
    );
    const refreshToken = generateRefreshToken(
      user._id,
      sessionId.toString(),
      user.role,
    );

    await Session.create({
      _id: sessionId,
      userId: user._id,
      refreshToken,
      isActive: true,
    });
    await markUserOnline(user);

    // Optional: capture login location if GPS sent in body
    await saveLoginLocationIfProvided({ req, userId: user._id });

    // 6. Cookies (same options as /login)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      message: user.profileCompleted
        ? "Login successful"
        : "Account created. Please complete your profile.",
      success: true,
      accessToken,
      refreshToken,
      user: user.toJSON(),
      role: user.role,
      profileCompleted: user.profileCompleted,
      isNewUser: !user.profileCompleted,
    });
  } catch (error) {
    console.error("Google auth error:", error);
    return res.status(500).json({
      message: "Error during Google authentication",
      success: false,
      error: error.message,
    });
  }
};

// ================= GOOGLE RE-LINK (Change linked Google account) =================
// Requires the user to be logged in already (old account). Client sends a NEW
// Google ID token; we verify it and re-bind googleId (sub) to this user.
export const relinkGoogleAccount = async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Google idToken is required",
      });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error("Google token verify failed (relink):", verifyErr.message);
      return res.status(401).json({
        success: false,
        message: "Invalid Google token",
      });
    }

    if (!payload?.sub || !payload?.email) {
      return res.status(401).json({
        success: false,
        message: "Google token did not contain required fields",
      });
    }

    if (!payload.email_verified) {
      return res.status(401).json({
        success: false,
        message: "Google email is not verified",
      });
    }

    const newGoogleId = String(payload.sub);
    const newGoogleEmail = String(payload.email).trim().toLowerCase();

    // If this Google identity is already linked to some other account, block.
    const alreadyLinked = await User.findOne({
      googleId: newGoogleId,
      _id: { $ne: currentUser._id },
    }).select("_id");

    if (alreadyLinked) {
      return res.status(409).json({
        success: false,
        code: "GOOGLE_ALREADY_LINKED",
        message:
          "This Google account is already linked to another user. Please sign in to that account instead.",
      });
    }

    // Update bindings for this user.
    const user = await User.findById(currentUser._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const previousGoogleEmail = String(user.googleEmail || "").toLowerCase();
    const currentEmail = String(user.email || "").toLowerCase();
    const shouldSyncProfileEmail =
      user.authProvider === "google" &&
      (!previousGoogleEmail || currentEmail === previousGoogleEmail);

    user.googleId = newGoogleId;
    user.googleEmail = newGoogleEmail;

    if (shouldSyncProfileEmail && currentEmail !== newGoogleEmail) {
      const taken = await User.findOne({
        email: newGoogleEmail,
        _id: { $ne: user._id },
      }).select("_id");
      if (taken) {
        return res.status(409).json({
          success: false,
          code: "EMAIL_IN_USE",
          message:
            "Your Google email is already in use by another account. Please contact support.",
        });
      }
      user.email = newGoogleEmail;
      user.isEmailVerified = true;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Google account linked successfully",
      user: user.toJSON(),
    });
  } catch (error) {
    console.error("relinkGoogleAccount error:", error);
    return res.status(500).json({
      success: false,
      message: "Error linking Google account",
      error: error.message,
    });
  }
};

export const sendUnlinkGoogleOtp = async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const user = await User.findById(currentUser._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.googleId) {
      return res.status(400).json({
        success: false,
        code: "NOT_LINKED",
        message: "This account is not linked to Google.",
      });
    }

    // Safety: unlinking would lock out users who don't have a password.
    if (!user.password) {
      return res.status(400).json({
        success: false,
        code: "PASSWORD_REQUIRED",
        message:
          "Set a password first before unlinking Google, otherwise you may not be able to log in.",
      });
    }
    if (!user.phoneNumber) {
      return res.status(400).json({
        success: false,
        code: "PHONE_REQUIRED",
        message:
          "Add a phone number first before unlinking Google, otherwise you may not be able to log in.",
      });
    }

    const email = String(user.email || "").toLowerCase();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required on the account to send OTP",
      });
    }

    const otp = otpService.generateOTP();
    unlinkGoogleOTPStore.set(String(user._id), {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    await otpService.sendLoginOTP(email, otp);

    const devOtp =
      process.env.NODE_ENV !== "production" ? { devOtp: otp } : {};

    return res.status(200).json({
      success: true,
      message: `OTP sent to ${email}`,
      ...devOtp,
    });
  } catch (err) {
    console.error("sendUnlinkGoogleOtp error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const unlinkGoogleAccount = async (req, res) => {
  try {
    const currentUser = req.user;
    if (!currentUser) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const { otp } = req.body;
    if (!otp) {
      return res.status(400).json({ success: false, message: "OTP is required" });
    }

    const user = await User.findById(currentUser._id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (!user.googleId) {
      return res.status(400).json({
        success: false,
        code: "NOT_LINKED",
        message: "This account is not linked to Google.",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        success: false,
        code: "PASSWORD_REQUIRED",
        message:
          "Set a password first before unlinking Google, otherwise you may not be able to log in.",
      });
    }
    if (!user.phoneNumber) {
      return res.status(400).json({
        success: false,
        code: "PHONE_REQUIRED",
        message:
          "Add a phone number first before unlinking Google, otherwise you may not be able to log in.",
      });
    }

    const stored = unlinkGoogleOTPStore.get(String(user._id));
    if (!stored) {
      return res.status(400).json({
        success: false,
        message: "No OTP found — request a new one",
      });
    }
    if (Date.now() > stored.expiresAt) {
      unlinkGoogleOTPStore.delete(String(user._id));
      return res.status(400).json({ success: false, message: "OTP expired" });
    }
    if (String(stored.otp) !== String(otp)) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    // Unlink
    user.googleId = undefined;
    user.googleEmail = null;
    user.authProvider = "local";
    await user.save();
    unlinkGoogleOTPStore.delete(String(user._id));

    return res.status(200).json({
      success: true,
      message: "Google account unlinked successfully",
      user: user.toJSON(),
    });
  } catch (err) {
    console.error("unlinkGoogleAccount error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ================= LOGOUT OTHER DEVICES & SEND EMAIL OTP =================
export const logoutOtherDevicesAndSendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res
        .status(400)
        .json({ message: "Email is required", success: false });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    }

    // 1️⃣ Generate a short‑lived OTP (6 digits)
    const otp = otpService.generateOTP();
    console.log(`Generated OTP for ${email}: ${otp} (valid for 10 minutes);`);

    // 2️⃣ Store it in the temporary map (valid for 10 min)
    loginOTPStore.set(email, {
      otp,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
      userId: user._id,
    });

    // 3️⃣ Send the OTP by email (with retry logic)
    try {
      await otpService.sendLoginOTP(email, otp);
      console.log(`✅ OTP email sent successfully to ${email}`);
    } catch (emailError) {
      console.error(
        `❌ Failed to send OTP email to ${email}:`,
        emailError.message,
      );
      return res.status(500).json({
        message: "OTP generated but failed to send email. Please try again.",
        success: false,
        error: emailError.message,
      });
    }

    return res.status(200).json({
      message:
        "OTP sent to your email. Sessions will be logged out after OTP verification.",
      success: true,
      needOtpVerification: true,
      email,
    });
  } catch (err) {
    console.error("❌ logoutOtherDevices error:", err);
    return res
      .status(500)
      .json({ message: "Server error", success: false, error: err.message });
  }
};

// ================= VERIFY LOGIN OTP & CREATE NEW SESSION =================
export const verifyLoginOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res
        .status(400)
        .json({ message: "Email and OTP required", success: false });
    }

    const stored = loginOTPStore.get(email);
    if (!stored) {
      return res
        .status(400)
        .json({ message: "No OTP found – request a new one", success: false });
    }

    if (Date.now() > stored.expiresAt) {
      loginOTPStore.delete(email);
      return res.status(400).json({ message: "OTP expired", success: false });
    }

    if (stored.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    const user = await User.findById(stored.userId);
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    }

    // Logout all existing sessions ONLY after OTP verification succeeds
    await Session.updateMany(
      { userId: user._id, isActive: true },
      { $set: { isActive: false, logoutAt: new Date() } },
    );

    // OTP is valid → create a **new** session for this device
    const sessionId = new mongoose.Types.ObjectId();
    const accessToken = generateAccessToken(
      user._id,
      sessionId.toString(),
      user.role,
    );
    const refreshToken = generateRefreshToken(
      user._id,
      sessionId.toString(),
      user.role,
    );

    await Session.create({
      _id: sessionId,
      userId: user._id,
      refreshToken,
      isActive: true,
    });
    await markUserOnline(user);

    // Clean up the OTP entry
    loginOTPStore.delete(email);

    // Optional: if client sends GPS on OTP-login, store it (and append history event=login)
    await saveLoginLocationIfProvided({ req, userId: user._id });

    // Set cookies (same options you use elsewhere)
    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 15 * 60 * 1000,
    });
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Return the tokens and user info (useful for Postman or SPA)
    return res.status(200).json({
      message: "Login successful",
      success: true,
      accessToken,
      refreshToken,
      user: user.toJSON(),
      role: user.role,
    });
  } catch (err) {
    console.error("verifyLoginOTP error:", err);
    return res.status(500).json({ message: "Server error", success: false });
  }
};

// ================= REFRESH ACCESS TOKEN =================
export const refreshAccessToken = async (req, res) => {
  try {
    const incomingRefreshToken =
      req.cookies?.refreshToken || req.body?.refreshToken;

    if (!incomingRefreshToken) {
      return res.status(401).json({ message: "No refresh token" });
    }

    let decoded;
    try {
      decoded = jwt.verify(incomingRefreshToken, process.env.REFRESH_SECRET);
    } catch (err) {
      return res.status(401).json({ message: "Invalid refresh token" });
    }

    if (!mongoose.isValidObjectId(decoded.sessionId)) {
      return res.status(401).json({ message: "Invalid session" });
    }

    // Find session using sessionId from refresh token
    const session = await Session.findById(decoded.sessionId);

    if (!session || !session.isActive) {
      return res.status(401).json({ message: "Session expired" });
    }

    if (session.refreshToken !== incomingRefreshToken) {
      return res.status(401).json({ message: "Token mismatch" });
    }

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(401).json({ message: "User not found" });
    }

    // ✅ FIXED: Pass sessionId to generateAccessToken
    const newAccessToken = generateAccessToken(user._id, session._id);
    const newRefreshToken = generateRefreshToken(user._id, session._id);

    // Update session with new refresh token
    session.refreshToken = newRefreshToken;
    await session.save();
    await markUserOnline(user);

    // Set cookies (for browser clients)
    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });

    res.cookie("refreshToken", newRefreshToken, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
    });

    // Return both tokens for Postman/frontend
    return res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken, // Also return this
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= LOGOUT (FIXED - Properly invalidates session) =================
export const logout = async (req, res) => {
  try {
    // Get userId from request (set by auth middleware)
    let userId = req.userId || req.user?._id;
    const refreshToken = req.cookies?.refreshToken;

    // console.log("🔓 Logout - UserId from request:", userId);
    // console.log("🔓 Logout - Refresh token present:", !!refreshToken);

    // If no userId but we have refresh token, try to decode it
    if (!userId && refreshToken) {
      try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
        userId = decoded.userId;
        console.log(
          "✅ Got userId from refresh token in logout function:",
          userId,
        );
      } catch (error) {
        console.log("⚠️ Could not decode refresh token:", error.message);
      }
    }

    // Invalidate session(s)
    if (userId) {
      if (refreshToken) {
        // Invalidate the specific session with this refresh token
        const result = await Session.updateOne(
          { userId, refreshToken, isActive: true },
          { isActive: false, logoutAt: new Date() },
        );

        if (result.modifiedCount === 0) {
          // If no specific session found, invalidate all active sessions for this user
          const allResult = await Session.updateMany(
            { userId, isActive: true },
            { isActive: false, logoutAt: new Date() },
          );
          console.log(
            `✅ All ${allResult.modifiedCount} sessions invalidated for user: ${userId}`,
          );
        } else {
          console.log(`✅ Specific session invalidated for user: ${userId}`);
        }
      } else {
        // No refresh token provided, invalidate ALL active sessions
        const result = await Session.updateMany(
          { userId, isActive: true },
          { isActive: false, logoutAt: new Date() },
        );
        console.log(
          `✅ All ${result.modifiedCount} sessions invalidated for user: ${userId}`,
        );
      }
    } else {
      console.log("⚠️ No userId found, skipping session invalidation");
    }

    await markUserOfflineIfNoActiveSessions(userId);

    // Clear cookies regardless
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
    };

    res.clearCookie("accessToken", cookieOptions);
    res.clearCookie("refreshToken", cookieOptions);

    console.log("✅ Cookies cleared successfully");

    return res.status(200).json({
      message: "Logged out successfully",
      success: true,
    });
  } catch (error) {
    console.error("Logout error:", error);

    // Even on error, try to clear cookies
    try {
      res.clearCookie("accessToken", { path: "/" });
      res.clearCookie("refreshToken", { path: "/" });
    } catch (cookieError) {
      console.error("Error clearing cookies:", cookieError);
    }

    return res.status(500).json({
      message: "Error in logout",
      success: false,
      error: error.message,
    });
  }
};

// ================= LOGOUT =================

// ================= LOGOUT FROM ALL DEVICES =================
export const logoutAllDevices = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    await Session.updateMany(
      { userId, isActive: true },
      { isActive: false, logoutAt: new Date() },
    );
    await markUserOfflineIfNoActiveSessions(userId);

    res.clearCookie("accessToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });
    res.clearCookie("refreshToken", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
    });

    return res
      .status(200)
      .json({ message: "Logged out from all devices", success: true });
  } catch (error) {
    console.error("Logout all error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error logging out" });
  }
};

// ================= GET ALL SESSIONS =================
export const getMySessions = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "User not authenticated" });
    }

    const sessions = await Session.find({ userId, isActive: true })
      .select("-refreshToken")
      .sort({ createdAt: -1 });

    return res
      .status(200)
      .json({ success: true, sessions, count: sessions.length });
  } catch (error) {
    console.error("Get sessions error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error fetching sessions" });
  }
};

// ================= GET ALL COUNSELLORS =================
export const getAllCounsellors = async (req, res) => {
  try {
    const { specialization, location, consultationMode, minExperience } =
      req.query;
    let filter = { role: "counsellor", isActive: true, profileCompleted: true };

    if (specialization) filter.specialization = { $in: [specialization] };
    if (location) filter.location = { $regex: location, $options: "i" };
    if (consultationMode) filter.consultationMode = { $in: [consultationMode] };
    if (minExperience) filter.experience = { $gte: Number(minExperience) };

    const counsellors = await User.find(filter)
      .select("-password")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      message: "Counsellors fetched successfully",
      success: true,
      counsellors,
      count: counsellors.length,
    });
  } catch (error) {
    console.log("Get counsellors error:", error);
    return res
      .status(500)
      .json({ message: "Error fetching counsellors", success: false });
  }
};

// ================= TEMP DEBUG: check counsellor by email =================
export const debugCounsellorByEmail = async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: 'email query required' });
    const user = await User.findOne({ email }).select('fullName email role isActive profileCompleted specialization experience qualification education location googleId');
    if (!user) return res.status(404).json({ message: 'not found' });
    return res.status(200).json({ user });
  } catch (e) {
    return res.status(500).json({ message: e.message });
  }
};

// ================= GET SINGLE COUNSELLOR =================
export const getCounsellorById = async (req, res) => {
  try {
    const { counsellorId } = req.params;
    const counsellor = await User.findOne({
      _id: counsellorId,
      role: "counsellor",
      isActive: true,
    });

    if (!counsellor) {
      return res
        .status(404)
        .json({ message: "Counsellor not found", success: false });
    }

    return res.status(200).json({
      message: "Counsellor fetched successfully",
      success: true,
      counsellor: counsellor.toJSON(),
    });
  } catch (error) {
    console.log("Get counsellor error:", error);
    return res
      .status(500)
      .json({ message: "Error fetching counsellor", success: false });
  }
};

// ================= GET MY PROFILE =================

// controllers/profileController.js

// ================= GET COMPLETE PROFILE =================
export const getMyProfile = async (req, res) => {
  try {
    const userId = req.userId || req.user?._id;
    const user = await User.findById(userId).select(
      "-password -emailOTP -phoneOTP",
    );

    if (!user) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    // Format the response with all fields including new patient profile fields
    const formattedProfile = {
      // Basic Info
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      age: user.age,
      gender: user.gender,
      role: user.role,
      profilePhoto: user.profilePhoto,
      avatar: user.avatar,
      isActive: user.isActive,
      profileCompleted: user.profileCompleted,

      // New Patient Profile Fields
      dateOfBirth: user.dateOfBirth
        ? new Date(user.dateOfBirth).toISOString().split("T")[0]
        : null,
      bloodGroup: user.bloodGroup || null,

      address: user.address || {
        line1: "",
        line2: "",
        city: "",
        state: "",
        pincode: "",
        country: "India",
      },

      emergencyContact: user.emergencyContact || {
        name: "",
        relation: "",
        phone: "",
      },

      medicalInfo: user.medicalInfo || {
        height: "",
        weight: "",
        allergies: [],
        chronicConditions: [],
        currentMedications: [],
      },

      insuranceInfo: user.insuranceInfo || {
        provider: "",
        policyNumber: "",
        groupNumber: "",
        coverageAmount: "",
        validityDate: null,
        nominee: "",
        relationship: "",
        insuranceType: "",
      },
    };

    // Add counsellor-specific fields if user is counsellor
    if (user.role === "counsellor") {
      formattedProfile.qualification = user.qualification;
      formattedProfile.specialization = user.specialization;
      formattedProfile.experience = user.experience;
      formattedProfile.location = user.location;
      formattedProfile.consultationMode = user.consultationMode;
      formattedProfile.languages = user.languages;
      formattedProfile.aboutMe = user.aboutMe;
    }

    return res.status(200).json({
      message: "Profile fetched successfully",
      success: true,
      user: formattedProfile,
    });
  } catch (error) {
    console.log("Get profile error:", error);
    return res.status(500).json({
      message: "Error fetching profile",
      success: false,
    });
  }
};

// ================= UPLOAD PROFILE PHOTO =================
export const uploadProfilePhoto = async (req, res) => {
  try {
    const userId = req.user?._id || req.userId;
    const currentUser = await User.findById(userId);

    if (!currentUser) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    // Only counsellors can upload photos (as per your original logic)
    if (currentUser.role !== "counsellor") {
      if (req.file) deleteLocalFile(saveLocalFile(req.file));
      return res.status(403).json({
        message: "Only counsellors can upload photos",
        success: false,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "No file uploaded",
        success: false,
      });
    }

    // Delete old photo if exists
    if (currentUser.profilePhoto) {
      deleteLocalFile(currentUser.profilePhoto);
    }

    // Save new photo
    const photoPath = saveLocalFile(req.file);

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { profilePhoto: photoPath } },
      { new: true },
    ).select("-password");

    return res.status(200).json({
      message: "Profile photo updated successfully",
      success: true,
      profilePhoto: photoPath,
      user: updatedUser.toJSON(),
    });
  } catch (error) {
    console.error("Photo upload error:", error);
    if (req.file) deleteLocalFile(saveLocalFile(req.file));
    return res.status(500).json({
      message: "Error uploading photo",
      success: false,
      error: error.message,
    });
  }
};

// ================= FORGOT PASSWORD =================
export const forgotPassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "No account found with this email" });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    user.resetPasswordToken = crypto
      .createHash("sha256")
      .update(resetToken)
      .digest("hex");
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
    await user.save();

    const resetUrl = `${req.protocol}://${req.get("host")}/reset-password/${resetToken}`;

    try {
      await sendResetPasswordEmail(user.email, resetUrl, user.fullName);
    } catch (emailError) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save();
      return res
        .status(500)
        .json({ success: false, message: "Error sending reset email" });
    }

    res.status(200).json({
      success: true,
      message: "Password reset instructions sent to your email",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error processing request" });
  }
};

// ================= RESET PASSWORD =================
export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirmPassword } = req.body;

    if (password !== confirmPassword) {
      return res
        .status(400)
        .json({ success: false, message: "Passwords do not match" });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    const resetPasswordToken = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");
    const user = await User.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired reset token" });
    }

    const isSamePassword = await bcrypt.compare(password, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: "New password cannot be the same as old password",
      });
    }

    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    await Session.updateMany(
      { userId: user._id, isActive: true },
      { isActive: false, logoutAt: new Date() },
    );

    res
      .status(200)
      .json({ success: true, message: "Password reset successful" });
  } catch (error) {
    console.error("Reset password error:", error);
    res
      .status(500)
      .json({ success: false, message: "Error resetting password" });
  }
};

// ================= SET PASSWORD (for accounts without a password, e.g. Google accounts)
export const setPassword = async (req, res) => {
  try {
    const user = req.user;
    const { password } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!password || typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const freshUser = await User.findById(user._id);
    if (!freshUser) return res.status(404).json({ success: false, message: "User not found" });

    if (freshUser.password) {
      return res.status(400).json({ success: false, message: "Password already set for this account" });
    }

    freshUser.password = await bcrypt.hash(password, 10);
    // Ensure local auth provider is set so user can login with password later
    freshUser.authProvider = "local";
    await freshUser.save();

    return res.status(200).json({ success: true, message: "Password set successfully" });
  } catch (error) {
    console.error("setPassword error:", error);
    return res.status(500).json({ success: false, message: "Error setting password" });
  }
};

// ================= CHANGE PASSWORD (authenticated) =================
export const changePassword = async (req, res) => {
  try {
    const user = req.user;
    const { oldPassword, newPassword } = req.body;

    if (!user) {
      return res.status(401).json({ success: false, message: "Authentication required" });
    }
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }

    const freshUser = await User.findById(user._id).select('+password');
    if (!freshUser) return res.status(404).json({ success: false, message: "User not found" });

    if (!freshUser.password) {
      return res.status(400).json({ success: false, message: "No password set on this account. Use set-password first." });
    }

    const match = await bcrypt.compare(String(oldPassword || ''), freshUser.password);
    if (!match) {
      return res.status(401).json({ success: false, message: "Old password is incorrect" });
    }

    const isSame = await bcrypt.compare(newPassword, freshUser.password);
    if (isSame) {
      return res.status(400).json({ success: false, message: "New password cannot be the same as the old password" });
    }

    freshUser.password = await bcrypt.hash(newPassword, 10);
    await freshUser.save();

    // Invalidate all other active sessions for security
    await Session.updateMany({ userId: freshUser._id, isActive: true }, { isActive: false, logoutAt: new Date() });

    return res.status(200).json({ success: true, message: "Password changed successfully. Please log in again." });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({ success: false, message: "Error changing password" });
  }
};

// ================= SET PASSWORD BY OTP (unauthenticated, uses verifiedUsersStore)
export const setPasswordByOtp = async (req, res) => {
  try {
    const { email, password, otp } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = String(email).toLowerCase();
    const verification = verifiedUsersStore.get(normalizedEmail);
    let otpDoc = null;

    if (!verification?.isEmailVerified) {
      if (!otp) {
        return res.status(400).json({ success: false, message: "Email not verified or verification session missing" });
      }

      const otpUser = await User.findOne({ email: normalizedEmail });
      if (!otpUser) {
        return res.status(404).json({ success: false, message: "No user found with this email" });
      }

      otpDoc = await OTP.findOne({ userId: otpUser._id, otp: String(otp) });
      if (!otpDoc) {
        return res.status(400).json({ success: false, message: "Invalid OTP" });
      }
      if (otpDoc.expiresAt < Date.now()) {
        await OTP.deleteMany({ userId: otpUser._id });
        return res.status(400).json({ success: false, message: "OTP expired" });
      }
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ success: false, message: "No user found with this email" });
    }

    const wasPasswordSet = Boolean(user.password);
    if (wasPasswordSet) {
      const isSamePassword = await bcrypt.compare(password, user.password);
      if (isSamePassword) {
        return res.status(400).json({ success: false, message: "New password cannot be the same as the current password" });
      }
    }

    user.password = await bcrypt.hash(password, 10);
    user.authProvider = "local";
    await user.save();

    // Invalidate any active sessions for safety
    await Session.updateMany({ userId: user._id, isActive: true }, { isActive: false, logoutAt: new Date() });
    if (otpDoc) {
      await OTP.deleteMany({ userId: user._id });
    }

    // Optionally consume verification so it can't be reused for other actions
    verifiedUsersStore.delete(normalizedEmail);

    return res.status(200).json({
      success: true,
      message: wasPasswordSet
        ? "Password reset successfully. Please log in."
        : "Password set successfully. Please log in.",
    });
  } catch (error) {
    console.error("setPasswordByOtp error:", error);
    return res.status(500).json({ success: false, message: "Error setting password" });
  }
};

// ================= HELPER FUNCTIONS =================
export const registerUserOnly = async (req, res) => {
  return res.status(400).json({
    message: "Please use the new registration flow",
    success: false,
    instructions: {
      step1: "POST /api/auth/send-email-otp",
      step2: "POST /api/auth/verify-email-otp",
      step3: "POST /api/auth/send-phone-otp",
      step4: "POST /api/auth/verify-phone-otp",
      step5: "POST /api/auth/complete-registration",
    },
  });
};

export const registerCounsellor = async (req, res) => {
  return res.status(400).json({
    message: "Please use the new registration flow",
    success: false,
    instructions: {
      step1: "POST /api/auth/send-email-otp",
      step2: "POST /api/auth/verify-email-otp",
      step3: "POST /api/auth/send-phone-otp",
      step4: "POST /api/auth/verify-phone-otp",
      step5: "POST /api/auth/complete-registration with counsellor fields",
    },
  });
};

export const getAlluser = async (req, res) => {
  try {
    const users = await User.find().select("-password");
    return res.status(200).json({
      message: "Got all users",
      success: true,
      users,
      count: users.length,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error getting users", success: false });
  }
};

export const getUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    return res.status(200).json({
      message: "User fetched successfully",
      success: true,
      user: user.toJSON(),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error fetching user", success: false });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const { id } = req.body;
    const user = await User.findById(id);
    if (!user)
      return res
        .status(404)
        .json({ message: "User not found", success: false });
    if (user.profilePhoto) deleteLocalFile(user.profilePhoto);
    await Session.deleteMany({ userId: id });
    await User.findByIdAndDelete(id);
    return res
      .status(200)
      .json({ message: "User deleted successfully", success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error deleting user", success: false });
  }
};

export const checkRegistrationStatus = async (req, res) => {
  try {
    const { email } = req.params;
    const userVerification = verifiedUsersStore.get(email);

    if (!userVerification) {
      return res.status(404).json({
        success: false,
        exists: false,
        message: "No active registration session",
      });
    }

    return res.status(200).json({
      success: true,
      exists: true,
      email: email,
      isEmailVerified: userVerification.isEmailVerified,
      isPhoneVerified: userVerification.isPhoneVerified,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, message: "Error checking status" });
  }
};

export const resendEmailOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ message: "Email required", success: false });

    const userVerification = verifiedUsersStore.get(email);
    if (!userVerification)
      return res
        .status(404)
        .json({ message: "No pending verification", success: false });

    const otp = otpService.generateOTP();
    await otpService.sendEmailOTP(email, otp, "User");

    emailOTPStore.set(email, { otp, expiresAt: Date.now() + 10 * 60 * 1000 });

    return res
      .status(200)
      .json({ message: "Email OTP resent successfully", success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error resending OTP", success: false });
  }
};

export const resendPhoneOTP = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email)
      return res
        .status(400)
        .json({ message: "Email required", success: false });

    const userVerification = verifiedUsersStore.get(email);
    if (!userVerification || !userVerification.phoneNumber) {
      return res
        .status(404)
        .json({ message: "No phone number found", success: false });
    }

    const otp = otpService.generateOTP();
    const formattedPhone = `+91${userVerification.phoneNumber}`;

    await twilioClient.messages.create({
      body: `Your verification code is: ${otp}. This code will expire in 10 minutes.`,
      from: TWILIO_PHONE_NUMBER,
      to: formattedPhone,
    });

    phoneOTPStore.set(email, {
      otp,
      phoneNumber: userVerification.phoneNumber,
      formattedPhone,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    return res
      .status(200)
      .json({ message: "Phone OTP resent successfully", success: true });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Error resending phone OTP", success: false });
  }
};

// Aliases
export const refreshAccessTokenHandler = refreshAccessToken;
export const resendOTPS = resendEmailOTP;
export const checkVerificationStatus = checkRegistrationStatus;

// ──────────────────────────────────────────────────────────────────────────
// PROFILE-CHANGE OTP FLOW
//
// When a logged-in user edits their email or phone in the dashboard, we
// require them to prove ownership of the NEW value before the change is
// persisted. Flow:
//   1. Client calls POST /send-profile-change-otp { field, newValue }
//   2. Server sends OTP to NEW email/phone, stores it keyed on userId+field
//   3. Client calls POST /verify-profile-change-otp { field, newValue, otp }
//   4. On success, server moves the entry into verifiedProfileChanges
//   5. Client calls the existing PATCH /update/:userId with the new value
//   6. updateUserById refuses to persist email/phone changes unless a
//      verified entry exists in verifiedProfileChanges; on success the
//      entry is consumed (delete-once semantics)
//
// Auth middleware guarantees req.user is populated.
// ──────────────────────────────────────────────────────────────────────────

const profileChangeKey = (userId, field) => `${String(userId)}:${field}`;

const sendProfileChangeOtpViaEmail = async (toEmail, otp) => {
  await otpService.sendEmailOTP(toEmail, otp, "User");
};

const sendProfileChangeOtpViaSMS = async (formattedPhone, otp) => {
  const isTwilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER,
  );

  if (!isTwilioConfigured) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[profile-change] Twilio not configured; dev OTP for ${formattedPhone}: ${otp}`,
      );
      return { devOtp: otp };
    }
    throw new Error("SMS service is not configured");
  }

  const twilioModule = await import("twilio");
  const twilio = twilioModule.default || twilioModule;
  const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN,
  );
  await twilioClient.messages.create({
    body: `Your Mediconeckt verification code is: ${otp}. Use it to confirm your new phone number. Expires in 10 minutes.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: formattedPhone,
  });
  return {};
};

export const sendProfileChangeOTP = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }

    const { field, newValue } = req.body || {};
    if (!["email", "phone"].includes(field)) {
      return res
        .status(400)
        .json({ success: false, message: "field must be 'email' or 'phone'" });
    }
    if (typeof newValue !== "string" || !newValue.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "newValue is required" });
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (field === "email") {
      const normalized = newValue.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid email format" });
      }
      if (normalized === String(currentUser.email || "").toLowerCase()) {
        return res.status(400).json({
          success: false,
          message: "New email is the same as the current one",
        });
      }
      const taken = await User.findOne({
        email: normalized,
        _id: { $ne: userId },
      });
      if (taken) {
        return res.status(409).json({
          success: false,
          message: "This email is already in use by another account",
        });
      }

      const otp = otpService.generateOTP();
      profileChangeOTPStore.set(profileChangeKey(userId, "email"), {
        otp,
        newValue: normalized,
        expiresAt: Date.now() + PROFILE_CHANGE_OTP_TTL_MS,
      });

      try {
        await sendProfileChangeOtpViaEmail(normalized, otp);
      } catch (err) {
        profileChangeOTPStore.delete(profileChangeKey(userId, "email"));
        console.error("[profile-change] email send failed:", err.message);
        return res
          .status(500)
          .json({ success: false, message: "Failed to send OTP email" });
      }

      const devOtp =
        process.env.NODE_ENV !== "production" ? { devOtp: otp } : {};
      return res.status(200).json({
        success: true,
        message: `OTP sent to ${normalized}`,
        ...devOtp,
      });
    }

    // field === "phone"
    const cleaned = newValue.replace(/\D/g, "");
    if (cleaned.length !== 10) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number must be 10 digits" });
    }
    if (cleaned === String(currentUser.phoneNumber || "")) {
      return res.status(400).json({
        success: false,
        message: "New phone is the same as the current one",
      });
    }
    const taken = await User.findOne({
      phoneNumber: cleaned,
      _id: { $ne: userId },
    });
    if (taken) {
      return res.status(409).json({
        success: false,
        message: "This phone number is already in use by another account",
      });
    }

    const otp = otpService.generateOTP();
    const formattedPhone = `+91${cleaned}`;
    profileChangeOTPStore.set(profileChangeKey(userId, "phone"), {
      otp,
      newValue: cleaned,
      expiresAt: Date.now() + PROFILE_CHANGE_OTP_TTL_MS,
    });

    try {
      const result = await sendProfileChangeOtpViaSMS(formattedPhone, otp);
      const devOtp =
        result.devOtp && process.env.NODE_ENV !== "production"
          ? { devOtp: result.devOtp }
          : {};
      return res.status(200).json({
        success: true,
        message: `OTP sent to ${formattedPhone}`,
        ...devOtp,
      });
    } catch (err) {
      profileChangeOTPStore.delete(profileChangeKey(userId, "phone"));
      console.error("[profile-change] SMS send failed:", err.message);
      return res.status(503).json({
        success: false,
        message: err.message || "Failed to send OTP SMS",
      });
    }
  } catch (err) {
    console.error("sendProfileChangeOTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const verifyProfileChangeOTP = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Authentication required" });
    }

    const { field, newValue, otp } = req.body || {};
    if (!["email", "phone"].includes(field)) {
      return res
        .status(400)
        .json({ success: false, message: "field must be 'email' or 'phone'" });
    }
    if (!otp || !newValue) {
      return res
        .status(400)
        .json({ success: false, message: "newValue and otp are required" });
    }

    const key = profileChangeKey(userId, field);
    const stored = profileChangeOTPStore.get(key);
    if (!stored) {
      return res.status(400).json({
        success: false,
        message: "No OTP found. Please request a new one.",
      });
    }
    if (Date.now() > stored.expiresAt) {
      profileChangeOTPStore.delete(key);
      return res
        .status(400)
        .json({ success: false, message: "OTP expired. Request a new one." });
    }

    const normalisedNew =
      field === "email"
        ? String(newValue).trim().toLowerCase()
        : String(newValue).replace(/\D/g, "");

    if (stored.newValue !== normalisedNew) {
      return res.status(400).json({
        success: false,
        message:
          "The value you're verifying doesn't match the one OTP was sent for. Please re-send the OTP.",
      });
    }
    if (String(stored.otp) !== String(otp)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid OTP" });
    }

    // Mark as verified — updateUserById will consume this on Save.
    verifiedProfileChanges.set(key, {
      newValue: normalisedNew,
      expiresAt: Date.now() + PROFILE_CHANGE_VERIFIED_TTL_MS,
    });
    profileChangeOTPStore.delete(key);

    return res.status(200).json({
      success: true,
      message: `${field === "email" ? "Email" : "Phone"} verified. Hit Save within 15 minutes to apply.`,
    });
  } catch (err) {
    console.error("verifyProfileChangeOTP error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Internal helper used by updateUserById. Returns { ok, message } and
// consumes the verified entry on success so it can't be re-used.
export const consumeVerifiedProfileChange = (userId, field, attemptedValue) => {
  const key = profileChangeKey(userId, field);
  const verified = verifiedProfileChanges.get(key);
  if (!verified) {
    return {
      ok: false,
      message: `Please verify your new ${field === "email" ? "email" : "phone"} via OTP before saving.`,
    };
  }
  if (Date.now() > verified.expiresAt) {
    verifiedProfileChanges.delete(key);
    return {
      ok: false,
      message: `Verification for the new ${field} expired. Please verify again.`,
    };
  }
  const attempt =
    field === "email"
      ? String(attemptedValue).trim().toLowerCase()
      : String(attemptedValue).replace(/\D/g, "");
  if (verified.newValue !== attempt) {
    return {
      ok: false,
      message: `The ${field} you're saving doesn't match the one you verified.`,
    };
  }
  verifiedProfileChanges.delete(key);
  return { ok: true };
};
