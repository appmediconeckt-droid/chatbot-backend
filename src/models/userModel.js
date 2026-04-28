
// models/userModel.js
import mongoose from "mongoose";
import { type } from "os";

const userSchema = new mongoose.Schema({
    fullName: {
        type: String,
        trim: true,
        required: true
    },
    email: {
        type: String,
        trim: true,
        required: true,
        unique: true,
        lowercase: true
    },
    anonymous: {
        type: String,
    },
    phoneNumber: {
        type: String,
        unique: true,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    sessionId: {
        type: String,
        default: null
    },
    age: {
        type: Number,
    },
    gender: {
        type: String,
        enum: ["male", "female", "other"],
        default: "male"
    },
    role: {
        type: String,
        enum: ["user", "counsellor", "admin"],
        default: "user"
    },
    profileCompleted: {
        type: Boolean,
        default: false
    },
    
    // OTP Verification Fields
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    isPhoneVerified: {
        type: Boolean,
        default: false
    },
    emailOTP: {
        code: String,
        expiresAt: Date
    },
    phoneOTP: {
        code: String,
        expiresAt: Date
    },
    
    // Patient Profile Fields (for regular users)
    dateOfBirth: {
        type: Date,
        default: null
    },
    bloodGroup: {
        type: String,
        enum: ["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-", ""],
        default: null
    },
    address: {
        line1: { type: String, default: "" },
        line2: { type: String, default: "" },
        city: { type: String, default: "" },
        state: { type: String, default: "" },
        pincode: { type: String, default: "" },
        country: { type: String, default: "India" }
    },
    emergencyContact: {
        name: { type: String, default: "" },
        relation: { type: String, default: "" },
        phone: { type: String, default: "" }
    },
    medicalInfo: {
        height: { type: String, default: "" },
        weight: { type: String, default: "" },
        allergies: { type: [String], default: [] },
        chronicConditions: { type: [String], default: [] },
        currentMedications: { type: [String], default: [] }
    },
    insuranceInfo: {
        provider: { type: String, default: "" },
        policyNumber: { type: String, default: "" },
        groupNumber: { type: String, default: "" },
        coverageAmount: { type: String, default: "" },
        validityDate: { type: Date, default: null },
        nominee: { type: String, default: "" },
        relationship: { type: String, default: "" },
        insuranceType: { type: String, default: "" }
    },
    
    // Counsellor-specific fields
    qualification: {
        type: String,
        required: function() { return this.role === "counsellor"; }
    },
    specialization: {
        type: [String],
        required: function() { return this.role === "counsellor"; }
    },
    experience: {
        type: Number,
        required: function() { return this.role === "counsellor"; }
    },
    location: {
        type: String,
        required: function() { return this.role === "counsellor"; }
    },
    consultationMode: {
        type: [String],
        enum: ["online", "offline", "both"],
        default: ["online"],
        required: function() { return this.role === "counsellor"; }
    },
    languages: {
        type: [String],
        default: [],
        required: function() { return this.role === "counsellor"; }
    },
    aboutMe: {
        type: String,
        maxlength: 500
    },
    
    education: {
        type: String,
        default: ""
    },
    
    certifications: [{
        name: {
            type: String,
            required: true
        },
        issuedBy: {
            type: String,
            default: ""
        },
        issueDate: {
            type: Date,
            default: null
        },
        expiryDate: {
            type: Date,
            default: null
        },
        documentUrl: {
            type: String,
            default: null
        },
        documentPublicId: {
            type: String,
            default: null
        },
        documentName: {
            type: String,
            default: ""
        }
    }],
    
    uniqueCode: {
        type: String,
        unique: true,
        sparse: true,
      
    },
    
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    totalSessions: {
        type: Number,
        default: 0
    },
    activeClients: {
        type: Number,
        default: 0
    },
    profilePhoto: {
        url: String,
        publicId: String,
        format: String,
        bytes: Number
    },
    profilePhotoPublicId: {
        type: String,
        default: null
    },
    
    isActive: {
        type: Boolean,
        default: true
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: {
        type: Date,
        default: null
    },
    refreshToken:{
        type: String
    },
    walletBalance: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// ✅ NO PRE-SAVE HOOK - We'll generate uniqueCode in the controller

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function() {
    const user = this.toObject();
    delete user.password;
    delete user.profilePhotoPublicId;
    delete user.emailOTP;
    delete user.phoneOTP;
    return user;
};

// Prevent duplicate model compilation
let User;
try {
    User = mongoose.model('User');
} catch (error) {
    User = mongoose.model('User', userSchema);
}

export default User;
