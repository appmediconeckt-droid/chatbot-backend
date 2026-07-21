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

const getInstantPayoutConfig = () => {
    const feePercent = Math.max(0, Number(process.env.INSTANT_PAYOUT_FEE_PERCENT || 2));
    const etaMinutes = Math.max(1, Number(process.env.INSTANT_PAYOUT_ETA_MINUTES || 30));
    const standardEtaDays = Math.max(1, Number(process.env.STANDARD_PAYOUT_ETA_DAYS || 3));
    return { feePercent, etaMinutes, standardEtaDays };
};

const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

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

        const earningRecords = await CounselorEarning.find({ counselorId })
            // Counselor-facing earnings must never expose the user's real
            // name or profile photo. Only the chosen anonymous handle is sent.
            .populate('userId', 'anonymous')
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        // Older earning records predate earningStatus. If the user's wallet was
        // debited and an earning record exists, the earning itself is complete;
        // payoutStatus only describes withdrawal/settlement.
        const earnings = earningRecords.map((item) => ({
            ...item,
            userId: item.userId ? {
                _id: item.userId._id,
                anonymous: String(item.userId.anonymous || '').trim() || 'Anonymous User'
            } : {
                _id: null,
                anonymous: 'Anonymous User'
            },
            earningStatus: item.earningStatus || 'completed'
        }));

        const withdrawals = await Transaction.find({
            userId: counselorId,
            description: /withdrawal/i
        }).sort({ createdAt: -1 }).limit(20).lean();

        const totalEarned = earnings.reduce((sum, item) => sum + (item.earningAmount || 0), 0);
        // The counselor wallet is the actual withdrawable amount. Summing all
        // pending earning rows would keep showing already-requested withdrawals.
        const pendingPayout = Number(counselor?.walletBalance || 0);
        const grossRevenue = earnings.reduce((sum, item) => sum + (item.totalAmount || 0), 0);
        const platformCommission = earnings.reduce((sum, item) => sum + (item.commission || 0), 0);
        const commissionRate = Number(process.env.PLATFORM_COMMISSION_PERCENT || 20);
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const monthlyEarned = earnings
            .filter((item) => new Date(item.createdAt) >= monthStart)
            .reduce((sum, item) => sum + (item.earningAmount || 0), 0);
        const instantPayoutCount = Math.max(
            Number(counselor?.instantPayoutCount || 0),
            await Transaction.countDocuments({
                userId: counselorId,
                description: /withdrawal/i,
                'metadata.payoutType': 'instant'
            })
        );
        const payoutConfig = getInstantPayoutConfig();

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
            payoutOptions: {
                instant: {
                    available: true,
                    isFirstFree: instantPayoutCount === 0,
                    feePercent: instantPayoutCount === 0 ? 0 : payoutConfig.feePercent,
                    regularFeePercent: payoutConfig.feePercent,
                    etaMinutes: payoutConfig.etaMinutes
                },
                standard: {
                    feePercent: 0,
                    etaDays: payoutConfig.standardEtaDays
                }
            },
            earnings,
            withdrawals,
            payoutAccount: counselor?.payoutAccount?.isVerified ? {
                accountName: counselor.payoutAccount.accountName,
                bankName: counselor.payoutAccount.bankName,
                ifsc: counselor.payoutAccount.ifsc,
                last4: String(counselor.payoutAccount.accountNumber || '').slice(-4),
                isVerified: true,
                verifiedAt: counselor.payoutAccount.verifiedAt
            } : null
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
        const payoutType = req.body.payoutType === 'instant' ? 'instant' : 'standard';

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        const counselor = await User.findById(counselorId);
        if (!counselor) {
            return res.status(404).json({ message: 'Counselor not found' });
        }

        let payoutAccount = counselor.payoutAccount;
        let shouldSavePayoutAccount = false;
        if (!payoutAccount?.isVerified) {
            const accountName = String(req.body.accountName || '').trim();
            const accountNumber = String(req.body.accountNumber || '').replace(/\s+/g, '');
            const ifsc = String(req.body.ifsc || '').trim().toUpperCase();
            const bankName = String(req.body.bankName || '').trim();
            if (!accountName || !accountNumber || !ifsc || !bankName) {
                return res.status(400).json({ message: 'Complete bank details are required for the first withdrawal' });
            }
            if (!/^\d{8,20}$/.test(accountNumber)) {
                return res.status(400).json({ message: 'Enter a valid 8 to 20 digit account number' });
            }
            if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
                return res.status(400).json({ message: 'Enter a valid IFSC code' });
            }
            counselor.payoutAccount = {
                accountName, accountNumber, ifsc, bankName,
                isVerified: true, verifiedAt: new Date()
            };
            payoutAccount = counselor.payoutAccount;
            shouldSavePayoutAccount = true;
        }

        // Sync the counter for accounts that made instant withdrawals before the
        // dedicated counter was introduced, then reserve funds atomically.
        const previousInstantPayouts = payoutType === 'instant'
            ? await Transaction.countDocuments({
                userId: counselorId,
                description: /withdrawal/i,
                'metadata.payoutType': 'instant'
            })
            : 0;
        if (payoutType === 'instant' && counselor.instantPayoutCount == null) {
            await User.updateOne(
                { _id: counselorId, instantPayoutCount: { $exists: false } },
                { $set: { instantPayoutCount: 0 } }
            );
        }
        if (payoutType === 'instant' && previousInstantPayouts > Number(counselor.instantPayoutCount || 0)) {
            await User.updateOne(
                { _id: counselorId },
                { $max: { instantPayoutCount: previousInstantPayouts } }
            );
            counselor.instantPayoutCount = previousInstantPayouts;
        }

        const payoutConfig = getInstantPayoutConfig();
        const isFirstInstantFree = payoutType === 'instant' && Number(counselor.instantPayoutCount || 0) === 0;
        const feePercent = payoutType === 'instant' && !isFirstInstantFree ? payoutConfig.feePercent : 0;
        const feeAmount = roundMoney(amount * feePercent / 100);
        const netAmount = roundMoney(amount - feeAmount);
        if (netAmount <= 0) {
            return res.status(400).json({ message: 'Withdrawal amount must be greater than the instant payout fee' });
        }

        const update = { $inc: { walletBalance: -amount } };
        if (payoutType === 'instant') update.$inc.instantPayoutCount = 1;
        if (shouldSavePayoutAccount) update.$set = { payoutAccount };
        if (!payoutAccount?.isVerified) {
            return res.status(400).json({ message: 'A verified payout account is required' });
        }
        const withdrawalFilter = { _id: counselorId, walletBalance: { $gte: amount } };
        if (payoutType === 'instant') {
            withdrawalFilter.instantPayoutCount = Number(counselor.instantPayoutCount || 0);
        }
        const updatedCounselor = await User.findOneAndUpdate(
            withdrawalFilter,
            update,
            { new: true }
        );
        if (!updatedCounselor) {
            return res.status(409).json({ message: 'Balance or instant payout eligibility changed. Please refresh and try again.' });
        }

        let transaction;
        try {
            transaction = await Transaction.create({
                userId: counselorId,
                amount,
                status: 'pending',
                type: 'debit',
                description: 'Counselor withdrawal request',
                metadata: {
                    accountName: payoutAccount.accountName,
                    accountNumber: payoutAccount.accountNumber,
                    ifsc: payoutAccount.ifsc,
                    bankName: payoutAccount.bankName,
                    payoutAccountVerified: true,
                    payoutType,
                    requestedAmount: amount,
                    feePercent,
                    feeAmount,
                    netAmount,
                    firstInstantFree: isFirstInstantFree,
                    estimatedArrival: payoutType === 'instant'
                        ? `Within ${payoutConfig.etaMinutes} minutes`
                        : `Within ${payoutConfig.standardEtaDays} business days`
                }
            });
        } catch (transactionError) {
            const rollback = { $inc: { walletBalance: amount } };
            if (payoutType === 'instant') rollback.$inc.instantPayoutCount = -1;
            await User.updateOne({ _id: counselorId }, rollback);
            throw transactionError;
        }

        res.status(200).json({
            success: true,
            message: payoutType === 'instant'
                ? `Instant withdrawal submitted. You will receive ₹${netAmount.toFixed(2)} within ${payoutConfig.etaMinutes} minutes.`
                : 'Standard withdrawal request submitted',
            balance: updatedCounselor.walletBalance,
            withdrawal: transaction,
            payoutSummary: { payoutType, requestedAmount: amount, feePercent, feeAmount, netAmount },
            payoutAccount: {
                accountName: payoutAccount.accountName,
                bankName: payoutAccount.bankName,
                ifsc: payoutAccount.ifsc,
                last4: String(payoutAccount.accountNumber || '').slice(-4),
                isVerified: true
            }
        });
    } catch (error) {
        console.error('Error requesting withdrawal:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
