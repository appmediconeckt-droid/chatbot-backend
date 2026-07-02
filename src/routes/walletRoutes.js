import express from 'express';
import {
  createOrder,
  verifyPayment,
  getWalletData,
  getCounselorWalletData,
  requestWithdrawal,
} from '../controllers/walletController.js';
import { authenticateToken, authorizeRoles } from '../middleware/auth.js';

const router = express.Router();

// Wallet functionality is typically for users only
router.get('/data', authenticateToken, authorizeRoles("user"), getWalletData);
router.post('/create-order', authenticateToken, authorizeRoles("user"), createOrder);
router.post('/verify-payment', authenticateToken, authorizeRoles("user"), verifyPayment);
router.get('/counselor', authenticateToken, authorizeRoles("counsellor"), getCounselorWalletData);
router.post('/withdraw', authenticateToken, authorizeRoles("counsellor"), requestWithdrawal);

export default router;
