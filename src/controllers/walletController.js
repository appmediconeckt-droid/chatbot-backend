import Razorpay from 'razorpay';
import crypto from 'crypto';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import dotenv from 'dotenv';

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
        
        // Fetch last 10 transactions
        const transactions = await Transaction.find({ userId }).sort({ createdAt: -1 }).limit(10);

        // Calculate Monthly Spending
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthlyDebits = await Transaction.find({
            userId,
            type: 'debit',
            status: 'completed',
            createdAt: { $gte: startOfMonth }
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
