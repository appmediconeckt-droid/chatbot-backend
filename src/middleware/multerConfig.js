import { storePrivateAsset, validateUploadContent } from "../services/privateAssets.js";
import { uploadToCloudinary } from "../utils/uploadHelper.js";
import multer from "multer";

const isCloudinaryConfigured = () =>
  Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );

// File filter for uploaded files
// File filter for uploaded files
const fileFilter = (req, file, cb) => {
  // Check if it's a profile photo
  if (
    file.fieldname === "profilePhoto" ||
    file.fieldname === "prescriptionSignature" ||
    file.fieldname === "prescriptionSeal"
  ) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    if (allowedTypes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only image files (jpeg, jpg, png, gif, webp) are allowed",
        ),
      );
    }
  }
  // Check if it's a certification document - FIXED: Accept certificationDocuments
  else if (file.fieldname === "certificationDocuments") {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|ai/;
    if (allowedTypes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images and PDF files are allowed for certifications"));
    }
  }
  // Check if it's a nested certification document (backward compatibility)
  else if (
    file.fieldname.includes("certifications") &&
    file.fieldname.includes("document")
  ) {
    const allowedTypes = /jpeg|jpg|png|gif|webp|pdf|ai/;
    if (allowedTypes.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only images and PDF files are allowed for certifications"));
    }
  } else {
    // For any other file field, reject
    cb(new Error(`Unexpected file field: ${file.fieldname}`));
  }
};

// Create multer instance that accepts any fields
// Create multer instance that accepts any fields
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 8,
    fields: 100,
    parts: 108,
    fieldSize: 6 * 1024 * 1024, // Generated avatars are submitted once as a data URI.
  },
  fileFilter: fileFilter,
});

const chatAttachmentFilter = (req, file, cb) => {
  if (file.fieldname !== "attachment") {
    cb(new Error(`Unexpected file field: ${file.fieldname}`));
    return;
  }

  const mimeType = (file.mimetype || "").toLowerCase();
  const allowedMimeTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ];

  const isAllowed =
    mimeType.startsWith("image/") ||
    mimeType.startsWith("audio/") ||
    mimeType.startsWith("video/") ||
    allowedMimeTypes.includes(mimeType);

  if (!isAllowed) {
    cb(new Error("Unsupported file type for chat attachment"));
    return;
  }

  cb(null, true);
};

const chatAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 1, fields: 20, parts: 21,
  },
  fileFilter: chatAttachmentFilter,
});

// Handle user upload - accept all fields
export const handleUserUpload = (req, res, next) => {
  const contentType = req.headers["content-type"] || "";

  // Skip if not multipart
  if (!contentType.includes("multipart/form-data")) {
    return next();
  }

  // Use .any() to accept all fields (both files and text)
  upload.any()(req, res, async (err) => {
    if (err) {
      console.error("Multer Error:", err);
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    try {
      // Ownership must be established before any storage side effect.
      if (req.params.userId && String(req.params.userId) !== String(req.user?._id)) return res.status(403).json({ error: "Access denied" });
      for (const file of req.files || []) validateUploadContent(file);
      const converted = [];
      for (const file of req.files || []) {
        if (file.fieldname === "profilePhoto") {
          if (!isCloudinaryConfigured()) throw new Error("Profile photo storage is unavailable");
          const result = await uploadToCloudinary(file.buffer, { folder: "profile-photos" });
          converted.push({ ...file, path: result.url, filename: result.publicId });
        } else {
          converted.push(await storePrivateAsset(req, file, file.fieldname.startsWith("prescription") ? "prescription" : "certification"));
        }
      }
      req.files = converted;
    } catch (error) { return res.status(400).json({ error: error.message }); }

    // Organize files by field name
    if (req.files && req.files.length > 0) {
      req.filesByField = {};

      req.files.forEach((file) => {
        if (!req.filesByField[file.fieldname]) {
          req.filesByField[file.fieldname] = [];
        }
        req.filesByField[file.fieldname].push(file);
      });

      // Set req.files for backward compatibility
      req.files = req.filesByField;

      console.log("Files processed:");
      Object.keys(req.filesByField).forEach((field) => {
        console.log(`  ${field}: ${req.filesByField[field].length} file(s)`);
      });
    }

    next();
  });
};

export const uploadChatAttachment = (req, res, next) => {
  const contentType = req.headers["content-type"] || "";

  if (!contentType.includes("multipart/form-data")) {
    next();
    return;
  }

  chatAttachmentUpload.single("attachment")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }

    try {
      if (req.file) req.file = await storePrivateAsset(req, req.file, "chat");
    } catch (error) { return res.status(400).json({ error: error.message }); }

    next();
  });
};

const prescriptionPdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname !== "attachment") return cb(new Error("Unexpected prescription file field"));
    if (String(file.mimetype).toLowerCase() !== "application/pdf") {
      return cb(new Error("Only PDF prescriptions are allowed"));
    }
    return cb(null, true);
  },
});

export const uploadPrescriptionPdf = (req, res, next) => {
  prescriptionPdfUpload.single("attachment")(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, error: error.message });
    return next();
  });
};

const prescriptionPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    if (file.fieldname !== "photo") return cb(new Error("Unexpected photo field"));
    if (!allowed.has(String(file.mimetype).toLowerCase())) {
      return cb(new Error("Only JPG, PNG, or WebP photos are allowed"));
    }
    return cb(null, true);
  },
});

export const uploadPrescriptionPhoto = (req, res, next) => {
  prescriptionPhotoUpload.single("photo")(req, res, (error) => {
    if (error) return res.status(400).json({ success: false, error: error.message });
    return next();
  });
};

// Handle user upload - accept all fields

// Export individual middlewares for backward compatibility
export const uploadProfilePhoto = upload.single("profilePhoto");
export const uploadCertificationFiles = upload.array(
  "certificationDocuments",
  10,
);
export const uploadUserData = handleUserUpload;
export { upload };
