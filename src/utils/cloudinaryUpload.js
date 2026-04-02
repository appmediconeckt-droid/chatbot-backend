// import jwt from "jsonwebtoken"
// export const generateAccessToken=(userId)=>{
//     return jwt.sign(
//         {userId},
//         process.env.ACCESS_SECRET,
//         {expiresIn:"10m"}
//     )
// }


// export const generateRefreshToken=(userId)=>{
//     return jwt.sign(
//         {userId},
//         process.env.REFRESH_SECRET,
//         {expiresIn:"10d"}
//     )
// }

// utils/token.js
// import jwt from "jsonwebtoken";

// export const generateAccessToken = (userId) => {
//   return jwt.sign(
//     { userId },
//     process.env.ACCESS_SECRET,
//     { expiresIn: '1d' } // 15 minutes
//   );
// };

// export const generateRefreshToken = (userId) => {
//   return jwt.sign(
//         { userId },
//         process.env.REFRESH_TOKEN_SECRET
//   );
// };

// // Helper to verify tokens
// export const verifyAccessToken = (token) => {
//   try {
//     return jwt.verify(token, process.env.ACCESS_SECRET);
//   } catch (error) {
//     throw error;
//   }
// };

// export const verifyRefreshToken = (token) => {
//   try {
//     return jwt.verify(token, process.env.REFRESH_SECRET);
//   } catch (error) {
//     throw error;
//   }
// };

// utils/token.js
import jwt from "jsonwebtoken";

export const generateAccessToken = (userId, sessionId) => {
    return jwt.sign(
        { userId, sessionId },   // 🔥 ADD THIS
        process.env.ACCESS_SECRET,
        { expiresIn: "15m" }
    );
};

export const generateRefreshToken = (userId) => {
    // Check if secret exists
    if (!process.env.REFRESH_SECRET) {
        console.error("REFRESH_SECRET is not defined in environment variables");
        throw new Error("JWT configuration error");
    }
    
    // NO EXPIRY - lifetime token
    return jwt.sign(
        { userId },
        process.env.REFRESH_SECRET
    );
};

export const verifyAccessToken = (token) => {
    try {
        return jwt.verify(token, process.env.ACCESS_SECRET);
    } catch (error) {
        throw error;
    }
};

export const verifyRefreshToken = (token) => {
    try {
        return jwt.verify(token, process.env.REFRESH_SECRET);
    } catch (error) {
        throw error;
    }
};