import cloudinary from "../config/cloudinary.js";
import User from "../models/userModel.js"; // Your user model

// Upload profile photo with Cloudinary
export const uploadProfilePhotoController = async (req, res) => {
    try {
        // Check if file exists
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        // For Option 1 (multer-storage-cloudinary)
        // The file is already uploaded to Cloudinary, req.file contains:
        // req.file.path = Cloudinary URL
        // req.file.filename = Cloudinary public_id
        
        // For Option 1:
        const imageUrl = req.file.path;
        const publicId = req.file.filename;
        
        // For Option 2 (memory storage):
        // Upload from buffer to Cloudinary
        // const result = await new Promise((resolve, reject) => {
        //     cloudinary.uploader.upload_stream(
        //         {
        //             folder: "profile-photos",
        //             transformation: [{ width: 500, height: 500, crop: "limit" }]
        //         },
        //         (error, result) => {
        //             if (error) reject(error);
        //             else resolve(result);
        //         }
        //     ).end(req.file.buffer);
        // });
        // const imageUrl = result.secure_url;
        // const publicId = result.public_id;
        
        // Save to database
        const user = await User.findByIdAndUpdate(
            req.user.id, // Assuming you have authentication middleware
            {
                profilePhoto: {
                    url: imageUrl,
                    publicId: publicId
                }
            },
            { new: true }
        );
        
        res.status(200).json({
            success: true,
            message: "Profile photo uploaded successfully",
            data: {
                url: imageUrl,
                publicId: publicId
            }
        });
        
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({
            success: false,
            message: "Error uploading file",
            error: error.message
        });
    }
};

// Delete profile photo
export const deleteProfilePhotoController = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        if (!user.profilePhoto || !user.profilePhoto.publicId) {
            return res.status(404).json({ message: "No profile photo found" });
        }
        
        // Delete from Cloudinary
        await cloudinary.uploader.destroy(user.profilePhoto.publicId);
        
        // Remove from database
        user.profilePhoto = undefined;
        await user.save();
        
        res.status(200).json({
            success: true,
            message: "Profile photo deleted successfully"
        });
        
    } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({
            success: false,
            message: "Error deleting photo",
            error: error.message
        });
    }
};