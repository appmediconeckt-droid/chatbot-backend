// Local isolated test worker. Receives only a disposable Mongo URI via IPC env.
import express from 'express';
import mongoose from 'mongoose';
import { loginUser, logoutOtherDevicesAndSendOTP, verifyLoginOTP, logout, refreshAccessToken } from '../../src/controllers/authController.js';
import { authMiddleware } from '../../src/middleware/authMiddleware.js';
import { authRateLimit } from '../../src/middleware/authRateLimit.js';
await mongoose.connect(process.env.OTP_TEST_MONGO_URI);
const app=express(); app.use(express.json());
app.post('/api/auth/login', authRateLimit, loginUser);
app.post('/api/auth/logout-other-devices', authRateLimit, logoutOtherDevicesAndSendOTP);
app.post('/api/auth/verify-login-otp', authRateLimit, verifyLoginOTP);
app.post('/api/auth/logout', authMiddleware, logout);
app.post('/api/auth/refresh-token', refreshAccessToken);
app.get('/api/auth/me', authMiddleware, (req,res)=>res.json({role:req.user.role}));
const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('SIGTERM',()=>server.close(async()=>{await mongoose.disconnect();process.exit(0);}));
