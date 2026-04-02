// src/utils/uploadHelper.js (add to your existing file)
// import cloudinary from "../utils/cloudinary.js";
// ✅ Correct import
import cloudinary from "../config/cloudinary.js";
// Your existing code here...

// Add these new functions:
export const uploadToCloudinary = (fileBuffer, options = {}) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: options.folder || "profile-photos",
                transformation: options.transformation || [
                    { width: 500, height: 500, crop: "limit" }
                ],
                ...options
            },
            (error, result) => {
                if (error) {
                    console.error("Cloudinary upload error:", error);
                    reject(error);
                } else {
                    resolve({
                        url: result.secure_url,
                        publicId: result.public_id,
                        format: result.format,
                        bytes: result.bytes,
                        width: result.width,
                        height: result.height,
                        createdAt: result.created_at
                    });
                }
            }
        );
        
        uploadStream.end(fileBuffer);
    });
};

export const deleteFromCloudinary = async (publicId) => {
    try {
        if (!publicId) return null;
        const result = await cloudinary.uploader.destroy(publicId);
        console.log(`Deleted from Cloudinary: ${publicId}, Result: ${result.result}`);
        return result;
    } catch (error) {
        console.error("Error deleting from Cloudinary:", error);
        throw error;
    }
};