

// controllers/authController.js
// middleware/authMiddleware.js
import jwt from 'jsonwebtoken';
import User from '../models/userModel.js';
import RefreshToken from '../models/refreshTokenModel.js';

export const authMiddleware = async (req, res, next) => {
    try {
        // Get token from Authorization header or cookie
        let token = req.headers.authorization;
        
        if (token && token.startsWith('Bearer ')) {
            token = token.split(' ')[1];
        } else if (req.cookies?.accessToken) {
            token = req.cookies.accessToken;
        }
        
        if (!token) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required. No token provided.'
            });
        }
        
        // Verify token
        let decoded;
        try {
            // This checks the 15-minute token
            decoded = jwt.verify(token, process.env.ACCESS_SECRET);
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    error: 'Token expired',
                    code: 'TOKEN_EXPIRED'
                });
            }
            return res.status(401).json({
                success: false,
                error: 'Invalid token'
            });
        }
        
        // Get user from database
        const user = await User.findById(decoded.userId || decoded._id);
        
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }
        
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'Account is deactivated'
            });
        }
        
        // Attach user info to request
        req.user = user;
        req.userId = user._id;
        req.userRole = user.role;
        
        next();
    } catch (error) {
        console.error('middleware error:', error);
        return res.status(500).json({
            success: false,
            error: 'Authentication error'
        });
    }
};

// Optional: Role-based middleware
export const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }
        
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions'
            });
        }
        
        next();
    };
};

// Optional: Admin only middleware
export const adminOnly = (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            error: 'Admin access required'
        });
    }
    next();
};

// Optional: Counsellor only middleware
export const counsellorOnly = (req, res, next) => {
    if (!req.user || req.user.role !== 'counsellor') {
        return res.status(403).json({
            success: false,
            error: 'Counsellor access required'
        });
    }
    next();
};


// middleware/authMiddleware.js - COMPLETE FIX
// import jwt from 'jsonwebtoken';
// import User from '../models/userModel.js';
// import Session from '../models/sessionModel.js';
// import { verifyAccessToken, generateAccessToken } from '../utils/token.js';

// export const authMiddleware = async (req, res, next) => {
//     try {
//         // Get access token from header or cookie
//         let accessToken = req.headers.authorization?.split(' ')[1];
        
//         if (!accessToken && req.cookies?.accessToken) {
//             accessToken = req.cookies.accessToken;
//         }
        
//         const refreshToken = req.cookies?.refreshToken;
        
//         // If no access token, try refresh token immediately
//         if (!accessToken) {
//             if (refreshToken) {
//                 return await tryRefreshAndContinue(req, res, next, refreshToken);
//             }
//             return res.status(401).json({
//                 success: false,
//                 error: 'Authentication required. No token provided.'
//             });
//         }
        
//         // Try to verify access token
//         let decoded;
//         try {
//             decoded = verifyAccessToken(accessToken);
//         } catch (error) {
//             // If token expired, try to refresh
//             if (error.name === 'TokenExpiredError' && refreshToken) {
//                 console.log('Access token expired, attempting refresh...');
//                 return await tryRefreshAndContinue(req, res, next, refreshToken);
//             }
//             // If token is invalid for other reasons
//             return res.status(401).json({
//                 success: false,
//                 error: 'Invalid token',
//                 code: 'INVALID_TOKEN'
//             });
//         }
        
//         // Token is valid, verify session exists
//         const session = await Session.findOne({
//             _id: decoded.sessionId,
//             userId: decoded.userId,
//             isActive: true
//         });
        
//         if (!session) {
//             return res.status(401).json({
//                 success: false,
//                 error: 'Session not found or expired',
//                 code: 'SESSION_EXPIRED'
//             });
//         }
        
//         // Get user
//         const user = await User.findById(decoded.userId);
//         if (!user || !user.isActive) {
//             return res.status(401).json({
//                 success: false,
//                 error: 'User not found or deactivated'
//             });
//         }
        
//         // Attach to request
//         req.user = user;
//         req.userId = user._id;
//         req.sessionId = session._id;
        
//         next();
        
//     } catch (error) {
//         console.error('Auth middleware error:', error);
//         return res.status(500).json({
//             success: false,
//             error: 'Authentication error'
//         });
//     }
// };

// // Helper function to refresh token and continue
// const tryRefreshAndContinue = async (req, res, next, refreshToken) => {
//     try {
//         // Verify refresh token
//         const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET || process.env.REFRESH_SECRET);
        
//         // Check session
//         const session = await Session.findOne({
//             userId: decoded.userId,
//             refreshToken: refreshToken,
//             isActive: true
//         });
        
//         if (!session) {
//             return res.status(401).json({
//                 success: false,
//                 error: 'Invalid session',
//                 code: 'INVALID_SESSION'
//             });
//         }
        
//         // Check user
//         const user = await User.findById(decoded.userId);
//         if (!user || !user.isActive) {
//             return res.status(401).json({
//                 success: false,
//                 error: 'User not found'
//             });
//         }
        
//         // Generate new access token
//         const newAccessToken = generateAccessToken(user._id, session._id);
        
//         // Set new cookie
//         res.cookie('accessToken', newAccessToken, {
//             httpOnly: true,
//             secure: process.env.NODE_ENV === 'production',
//             sameSite: 'strict',
//             maxAge: 15 * 60 * 1000
//         });
        
//         // Also set in header for frontend to capture
//         res.setHeader('X-New-Access-Token', newAccessToken);
        
//         // Attach user to request
//         req.user = user;
//         req.userId = user._id;
//         req.sessionId = session._id;
//         req.newAccessToken = newAccessToken;
        
//         next();
        
//     } catch (error) {
//         console.error('Refresh failed:', error.message);
//         return res.status(401).json({
//             success: false,
//             error: 'Session expired. Please login again.',
//             code: 'REFRESH_FAILED'
//         });
//     }
// };