// // import mongoose from "mongoose";

// // const sessionSchema = new mongoose.Schema(
// // {
// //   userId: {
// //     type: mongoose.Schema.Types.ObjectId,
// //     ref: "User"
// //   },

// //   refreshToken: String,

// //   isActive: {
// //     type: Boolean,
// //     default: true
// //   }
// // },
// // { timestamps: true }
// // );

// // export default mongoose.model("Session", sessionSchema); 

// // models/sessionModel.js
// import mongoose from "mongoose";

// const sessionSchema = new mongoose.Schema({
//     userId: {
//         type: mongoose.Schema.Types.ObjectId,
//         ref: "User",
//         required: true
//     },
//     refreshToken: {
//         type: String,
//         required: true,
//         unique: true
//     },
//     isActive: {
//         type: Boolean,
//         default: true
//     },
//     logoutAt: {
//         type: Date,
//         default: null
//     }
//     // 🔥 REMOVED expiresAt field - tokens live forever
// }, { 
//     timestamps: true // This gives us createdAt and updatedAt
// });

// // Index for faster queries
// sessionSchema.index({ userId: 1 });
// sessionSchema.index({ refreshToken: 1 });
// sessionSchema.index({ isActive: 1 });

// export default mongoose.model("Session", sessionSchema);

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