import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    paymentMode: { type: String, enum: ['demo'], default: 'demo' },
    demoRequestId: { type: String },
    redeemable: { type: Boolean, default: false, immutable: true },
    appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    razorpayOrderId: {
        type: String
    },
    razorpayPaymentId: {
        type: String,
        index: true
    },
    razorpaySignature: {
        type: String
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'INR'
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'hold', 'refunded', 'demo_pending', 'demo_completed', 'demo_refunded'],
        default: 'pending'
    },
    description: {
        type: String,
        default: 'Wallet Top-up'
    },
    type: {
        type: String,
        enum: ['credit', 'debit', 'refund'],
        default: 'credit'
    },
    counselorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat'
    },
    sessionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ChatSession'
    },
    relatedTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction'
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { timestamps: true });

transactionSchema.index({ userId: 1, demoRequestId: 1 }, { unique: true, partialFilterExpression: { demoRequestId: { $type: 'string' } } });

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
