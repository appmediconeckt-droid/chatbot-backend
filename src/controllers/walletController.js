import Razorpay from 'razorpay';
import crypto from 'crypto';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import PDFDocument from 'pdfkit';
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

// Download Wallet Report
export const downloadReport = async (req, res) => {
    try {
        const userId = req.user._id;
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Fetch all transactions for the user
        const transactions = await Transaction.find({ userId }).sort({ createdAt: -1 });

        // Create a PDF document
        const doc = new PDFDocument({
            margin: 40,
            size: 'A4'
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="wallet-report-${new Date().toISOString().split('T')[0]}.pdf"`);

        // Pipe document to response
        doc.pipe(res);

        // ===== HEADER =====
        doc.fontSize(26).font('Helvetica-Bold').fillColor('#667eea').text('WALLET REPORT', { align: 'center' });
        doc.fontSize(10).font('Helvetica').fillColor('#666666');
        doc.text(`Generated: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, { align: 'center' });
        doc.moveTo(40, doc.y + 8).lineTo(555, doc.y + 8).stroke('#667eea');
        doc.moveDown(1);

        // ===== USER INFORMATION SECTION =====
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#0b1c30').text('👤 User Information');
        doc.fontSize(10).font('Helvetica').fillColor('#333333');
        doc.text(`Name: ${user.name || 'N/A'}`);
        doc.text(`Email: ${user.email || 'N/A'}`);
        doc.text(`Phone: ${user.phone || 'N/A'}`);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#667eea').text(`Current Balance: ₹${(user.walletBalance || 0).toFixed(2)}`);
        doc.moveDown(0.8);

        // ===== SUMMARY SECTION =====
        const totalCredit = transactions.filter(t => t.type === 'credit').reduce((acc, t) => acc + t.amount, 0);
        const totalDebit = transactions.filter(t => t.type === 'debit').reduce((acc, t) => acc + t.amount, 0);

        doc.fontSize(13).font('Helvetica-Bold').fillColor('#0b1c30').text('📊 Transaction Summary');
        doc.fontSize(10).font('Helvetica').fillColor('#333333');
        doc.text(`Total Credits: ₹${totalCredit.toFixed(2)}`, 50);
        doc.text(`Total Debits: ₹${totalDebit.toFixed(2)}`, 50);
        doc.fontSize(11).font('Helvetica-Bold').fillColor('#059669').text(`Net Balance: ₹${(totalCredit - totalDebit).toFixed(2)}`);
        doc.moveDown(0.8);

        // ===== TRANSACTIONS TABLE =====
        doc.fontSize(13).font('Helvetica-Bold').fillColor('#0b1c30').text('💳 Recent Transactions');
        doc.moveDown(0.5);

        // Table configuration
        const pageWidth = doc.page.width - 80;
        const tableLeft = 40;
        const columnWidths = {
            date: 70,
            type: 50,
            description: 150,
            status: 70,
            amount: 80
        };

        const headers = ['Date', 'Type', 'Description', 'Status', 'Amount'];
        let currentY = doc.y;

        // Draw header row with background
        doc.rect(tableLeft, currentY, pageWidth, 25).fillAndStroke('#667eea', '#667eea');
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');

        let xPos = tableLeft + 5;
        doc.text(headers[0], xPos, currentY + 7, { width: columnWidths.date - 5, align: 'left' });
        xPos += columnWidths.date;

        doc.text(headers[1], xPos, currentY + 7, { width: columnWidths.type - 5, align: 'left' });
        xPos += columnWidths.type;

        doc.text(headers[2], xPos, currentY + 7, { width: columnWidths.description - 5, align: 'left' });
        xPos += columnWidths.description;

        doc.text(headers[3], xPos, currentY + 7, { width: columnWidths.status - 5, align: 'center' });
        xPos += columnWidths.status;

        doc.text(headers[4], xPos, currentY + 7, { width: columnWidths.amount - 5, align: 'right' });

        currentY += 28;
        doc.fontSize(9).font('Helvetica').fillColor('#333333');

        // Draw table rows
        let rowCount = 0;
        const maxRowsPerPage = 15;

        for (const tx of transactions) {
            // Check if we need a new page
            if (rowCount >= maxRowsPerPage) {
                doc.addPage();
                currentY = 40;
                rowCount = 0;

                // Redraw header on new page
                doc.rect(tableLeft, currentY, pageWidth, 25).fillAndStroke('#667eea', '#667eea');
                doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff');

                let xPos = tableLeft + 5;
                doc.text(headers[0], xPos, currentY + 7, { width: columnWidths.date - 5, align: 'left' });
                xPos += columnWidths.date;
                doc.text(headers[1], xPos, currentY + 7, { width: columnWidths.type - 5, align: 'left' });
                xPos += columnWidths.type;
                doc.text(headers[2], xPos, currentY + 7, { width: columnWidths.description - 5, align: 'left' });
                xPos += columnWidths.description;
                doc.text(headers[3], xPos, currentY + 7, { width: columnWidths.status - 5, align: 'center' });
                xPos += columnWidths.status;
                doc.text(headers[4], xPos, currentY + 7, { width: columnWidths.amount - 5, align: 'right' });

                currentY += 28;
                doc.fontSize(9).font('Helvetica').fillColor('#333333');
            }

            // Prepare data
            const date = new Date(tx.createdAt).toLocaleDateString('en-IN', { month: '2-digit', day: '2-digit', year: '2-digit' });
            const type = tx.type === 'credit' ? '✓ ADD' : '✗ USE';
            const description = (tx.description || 'Wallet Transaction').substring(0, 25);
            const status = tx.status === 'completed' ? '✓ Done' : '⏳ Pending';
            const amount = `₹${tx.amount.toFixed(2)}`;

            // Alternate row background
            if (rowCount % 2 === 0) {
                doc.rect(tableLeft, currentY, pageWidth, 20).fill('#f8f9ff');
            }

            doc.fontSize(9).font('Helvetica').fillColor('#333333');

            let xPos = tableLeft + 5;
            doc.text(date, xPos, currentY + 5, { width: columnWidths.date - 5, align: 'left' });
            xPos += columnWidths.date;

            const typeColor = tx.type === 'credit' ? '#059669' : '#dc2626';
            doc.fillColor(typeColor).text(type, xPos, currentY + 5, { width: columnWidths.type - 5, align: 'left' });
            xPos += columnWidths.type;

            doc.fillColor('#333333').text(description, xPos, currentY + 5, { width: columnWidths.description - 5, align: 'left' });
            xPos += columnWidths.description;

            const statusColor = tx.status === 'completed' ? '#059669' : '#f59e0b';
            doc.fillColor(statusColor).text(status, xPos, currentY + 5, { width: columnWidths.status - 5, align: 'center' });
            xPos += columnWidths.status;

            const amountColor = tx.type === 'credit' ? '#059669' : '#333333';
            doc.fillColor(amountColor).font('Helvetica-Bold').text(amount, xPos, currentY + 5, { width: columnWidths.amount - 5, align: 'right' });

            currentY += 20;
            rowCount++;
        }

        // Draw bottom line
        doc.moveTo(tableLeft, currentY).lineTo(tableLeft + pageWidth, currentY).stroke('#ddd');

        // ===== FOOTER =====
        doc.moveDown(2);
        doc.fontSize(8).font('Helvetica').fillColor('#999999');
        doc.text('This is an automatically generated wallet report. For queries, please contact our support team.', { align: 'center' });
        doc.text(`Report ID: ${userId.toString().slice(-8).toUpperCase()}`, { align: 'center' });

        // Finalize PDF
        doc.end();
    } catch (error) {
        console.error('Error generating wallet report:', error);
        res.status(500).json({ message: 'Failed to generate report' });
    }
};
