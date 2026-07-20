import Razorpay from 'razorpay';
import crypto from 'crypto';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import CounselorEarning from '../models/CounselorEarning.js';
import dotenv from 'dotenv';
import { createNotificationSafely } from '../services/notificationService.js';

dotenv.config();

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_ID',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET'
});

// Create Razorpay Order
export const createOrder = async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user._id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        const options = {
            amount: amount * 100, // amount in smallest currency unit (paise for INR)
            currency: 'INR',
            receipt: `receipt_${Date.now()}`
        };

        const order = await razorpay.orders.create(options);

        // Save pending transaction
        const transaction = new Transaction({
            userId,
            razorpayOrderId: order.id,
            amount,
            status: 'pending'
        });
        await transaction.save();

        res.status(200).json({
            success: true,
            order_id: order.id,
            amount: options.amount,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Verify Razorpay Payment
export const verifyPayment = async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        const userId = req.user._id;

        const hmac = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET');
        hmac.update(razorpay_order_id + "|" + razorpay_payment_id);
        const generated_signature = hmac.digest('hex');

        if (generated_signature === razorpay_signature) {
            // Payment verified
            const transaction = await Transaction.findOne({ razorpayOrderId: razorpay_order_id });
            if (!transaction) {
                return res.status(404).json({ message: 'Transaction not found' });
            }

            if (transaction.status === 'completed') {
                return res.status(400).json({ message: 'Payment already verified' });
            }

            transaction.razorpayPaymentId = razorpay_payment_id;
            transaction.razorpaySignature = razorpay_signature;
            transaction.status = 'completed';
            await transaction.save();

            // Update user wallet balance
            const user = await User.findById(userId);
            user.walletBalance = (user.walletBalance || 0) + transaction.amount;
            await user.save();

            await createNotificationSafely({
                recipientId: userId,
                type: 'payment',
                title: 'Wallet payment successful',
                message: `₹${transaction.amount.toFixed(2)} was added to your wallet.`,
                data: {
                    transactionId: transaction._id,
                    amount: transaction.amount,
                    transactionType: 'credit',
                    balance: user.walletBalance
                },
                actionUrl: '/wallet'
            });

            res.status(200).json({
                success: true,
                message: 'Payment verified and wallet updated',
                balance: user.walletBalance
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid payment signature' });
        }
    } catch (error) {
        console.error('Error verifying Razorpay payment:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get Wallet Balance and History
export const getWalletData = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId);
        const transactionFilter = { userId };
        const from = req.query.from ? new Date(`${req.query.from}T00:00:00.000+05:30`) : null;
        const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999+05:30`) : null;

        if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
            return res.status(400).json({ message: 'Invalid date range' });
        }
        if (from && to && from > to) {
            return res.status(400).json({ message: 'From date cannot be after To date' });
        }
        if (from || to) {
            transactionFilter.createdAt = {};
            if (from) transactionFilter.createdAt.$gte = from;
            if (to) transactionFilter.createdAt.$lte = to;
        }

        // A selected statement range returns the complete range (up to a safe
        // export limit); the regular wallet view keeps a smaller recent list.
        const transactions = await Transaction.find(transactionFilter)
            .populate('counselorId', 'fullName profilePhoto specialization')
            .sort({ createdAt: -1 })
            .limit(from || to ? 1000 : 50)
            .lean();

        // Calculate Monthly Spending
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const debitDateFilter = from || to
            ? transactionFilter.createdAt
            : { $gte: startOfMonth };
        const monthlyDebits = await Transaction.find({
            userId,
            type: 'debit',
            status: 'completed',
            createdAt: debitDateFilter
        });

        const totalSpent = monthlyDebits.reduce((acc, curr) => acc + curr.amount, 0);

        // Simple grouping for summary (example: based on description)
        const summary = {
            consultations: monthlyDebits
                .filter(d => d.description.toLowerCase().includes('consult'))
                .reduce((acc, curr) => acc + curr.amount, 0),
            other: monthlyDebits
                .filter(d => !d.description.toLowerCase().includes('consult'))
                .reduce((acc, curr) => acc + curr.amount, 0)
        };

        res.status(200).json({
            balance: user.walletBalance || 0,
            transactions,
            spendingSummary: {
                total: totalSpent,
                period: {
                    from: from?.toISOString() || startOfMonth.toISOString(),
                    to: to?.toISOString() || new Date().toISOString()
                },
                breakdown: [
                    { label: 'Consultations', amount: summary.consultations, percentage: totalSpent > 0 ? (summary.consultations / totalSpent) * 100 : 0 },
                    { label: 'Other', amount: summary.other, percentage: totalSpent > 0 ? (summary.other / totalSpent) * 100 : 0 }
                ]
            }
        });
    } catch (error) {
        console.error('Error fetching wallet data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getCounselorWalletData = async (req, res) => {
    try {
        const counselorId = req.user._id;
        const counselor = await User.findById(counselorId).lean();

        const earnings = await CounselorEarning.find({ counselorId })
            .populate('userId', 'fullName profilePhoto')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        const withdrawals = await Transaction.find({
            userId: counselorId,
            description: /withdrawal/i
        }).sort({ createdAt: -1 }).limit(20).lean();

        const totalEarned = earnings.reduce((sum, item) => sum + (item.earningAmount || 0), 0);
        const pendingPayout = earnings
            .filter((item) => item.payoutStatus === 'pending')
            .reduce((sum, item) => sum + (item.earningAmount || 0), 0);
        const grossRevenue = earnings.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
        const platformCommission = earnings.reduce((sum, item) => sum + (item.commission || 0), 0);
        const commissionRate = Number(process.env.PLATFORM_COMMISSION_PERCENT || 20);
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthlyEarned = earnings
            .filter((item) => new Date(item.createdAt) >= monthStart)
            .reduce((sum, item) => sum + (item.earningAmount || 0), 0);

        res.status(200).json({
            balance: counselor?.walletBalance || 0,
            totalEarned,
            pendingPayout,
            grossRevenue,
            platformCommission,
            monthlyEarned,
            split: {
                counselorPercentage: 100 - commissionRate,
                platformPercentage: commissionRate
            },
            earnings,
            withdrawals,
            payoutAccount: counselor?.payoutAccount || null
        });
    } catch (error) {
        console.error('Error fetching counselor wallet data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const requestWithdrawal = async (req, res) => {
    try {
        const counselorId = req.user._id;
        const amount = Number(req.body.amount);

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        const counselor = await User.findById(counselorId);
        if (!counselor) {
            return res.status(404).json({ message: 'Counselor not found' });
        }

        if ((counselor.walletBalance || 0) < amount) {
            return res.status(400).json({ message: 'Insufficient balance' });
        }

        counselor.walletBalance = (counselor.walletBalance || 0) - amount;
        await counselor.save();

        const transaction = await Transaction.create({
            userId: counselorId,
            amount,
            status: 'pending',
            type: 'debit',
            description: 'Counselor withdrawal request',
            metadata: {
                accountName: req.body.accountName || '',
                accountNumber: req.body.accountNumber || '',
                ifsc: req.body.ifsc || '',
                bankName: req.body.bankName || ''
            }
        });

        res.status(200).json({
            success: true,
            message: 'Withdrawal request submitted',
            balance: counselor.walletBalance,
            withdrawal: transaction
        });
    } catch (error) {
        console.error('Error requesting withdrawal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
