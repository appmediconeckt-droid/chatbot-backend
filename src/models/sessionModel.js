

import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
       
    },
    refreshToken: {
        type: String,
        required: true,
        unique: true, 
    },
    isActive: {
        type: Boolean,
        default: true
    },
  
    logoutAt: {
        type: Date,
        default: null
    }
}, { 
    timestamps: true
});


export default mongoose.model("Session", sessionSchema);