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

// PDF translations for multiple languages
const pdfTranslations = {
    en: {
        title: 'WALLET REPORT',
        generated: 'Generated',
        userInfo: 'User Information',
        summary: 'Transaction Summary',
        transactions: 'Recent Transactions',
        name: 'Name',
        email: 'Email',
        phone: 'Phone',
        balance: 'Current Balance',
        totalCredits: 'Total Credits',
        totalDebits: 'Total Debits',
        netBalance: 'Net Balance',
        date: 'Date',
        type: 'Type',
        description: 'Description',
        status: 'Status',
        amount: 'Amount',
        credit: 'Credit',
        debit: 'Debit',
        completed: 'Completed',
        pending: 'Pending',
        footer: 'This is an automatically generated wallet report. For queries, please contact support.',
        reportId: 'Report ID'
    },
    hi: {
        title: 'वॉलेट रिपोर्ट',
        generated: 'तैयार की गई',
        userInfo: 'उपयोगकर्ता की जानकारी',
        summary: 'लेनदेन सारांश',
        transactions: 'हाल के लेनदेन',
        name: 'नाम',
        email: 'ईमेल',
        phone: 'फोन',
        balance: 'वर्तमान शेष',
        totalCredits: 'कुल क्रेडिट',
        totalDebits: 'कुल डेबिट',
        netBalance: 'शुद्ध शेष',
        date: 'तारीख',
        type: 'प्रकार',
        description: 'विवरण',
        status: 'स्थिति',
        amount: 'रकम',
        credit: 'जमा',
        debit: 'निकासी',
        completed: 'पूर्ण',
        pending: 'लंबित',
        footer: 'यह एक स्वचालित रूप से उत्पन्न वॉलेट रिपोर्ट है। प्रश्नों के लिए, कृपया समर्थन से संपर्क करें।',
        reportId: 'रिपोर्ट आईडी'
    },
    ta: {
        title: 'கார்டிஸ் அறிக்கை',
        generated: 'உருவாக்கப்பட்டது',
        userInfo: 'பயனர் தகவல்',
        summary: 'பரிவர்த்தனை சுருக்கம்',
        transactions: 'சமீபத்திய பரிவர்த்தனைகள்',
        name: 'பெயர்',
        email: 'மின்னஞ்சல்',
        phone: 'தொலைபேசி',
        balance: 'தற்போதைய இருப்பு',
        totalCredits: 'மொத்த கடன்',
        totalDebits: 'மொத்த பற்று',
        netBalance: 'நிகர இருப்பு',
        date: 'தேதி',
        type: 'வகை',
        description: 'விளக்கம்',
        status: 'நிலை',
        amount: 'தொகை',
        credit: 'கடன்',
        debit: 'பற்று',
        completed: 'முடிந்தது',
        pending: 'நிலுவையில் உள்ளது',
        footer: 'இது தானாக உருவாக்கப்பட்ட கார்டிஸ் அறிக்கை. கேள்விகளுக்கு, தயவுசெய்து ஆதரவைத் தொடர்புகொள்ளவும்.',
        reportId: 'அறிக்கை குறுவொளி'
    },
    mr: {
        title: 'वॉलेट अहवाल',
        generated: 'तयार केले',
        userInfo: 'वापरकर्ता माहिती',
        summary: 'व्यवहार सारांश',
        transactions: 'अलीकडील व्यवहार',
        name: 'नाव',
        email: 'ईमेल',
        phone: 'फोन',
        balance: 'सध्याची शिल्लक',
        totalCredits: 'एकूण क्रेडिट',
        totalDebits: 'एकूण डेबिट',
        netBalance: 'शुद्ध शिल्लक',
        date: 'तारीख',
        type: 'प्रकार',
        description: 'वर्णन',
        status: 'स्थिती',
        amount: 'रकम',
        credit: 'जमा',
        debit: 'निकाल',
        completed: 'पूर्ण',
        pending: 'प्रलंबित',
        footer: 'हे स्वयंचलितपणे व्यक्त केलेले वॉलेट अहवाल आहे. प्रश्नांसाठी, कृपया समर्थनाशी संपर्क साधा.',
        reportId: 'अहवाल आयडी'
    },
    te: {
        title: 'వాలెట్ నివేదిక',
        generated: 'జనరేట్ చేయబడింది',
        userInfo: 'వినియోగదారు సమాచారం',
        summary: 'లావాదేవీ సారాంశం',
        transactions: 'ఇటీవలి లావాదేవీలు',
        name: 'పేరు',
        email: 'ఈమెయిల్',
        phone: 'ఫోన్',
        balance: 'ప్రస్తుత బ్యాలెన్స్',
        totalCredits: 'మొత్తం క్రెడిట్‌లు',
        totalDebits: 'మొత్తం డెబిట్‌లు',
        netBalance: 'నెట్ బ్యాలెన్స్',
        date: 'తేదీ',
        type: 'రకం',
        description: 'వివరణ',
        status: 'స్థితి',
        amount: 'మొత్తం',
        credit: 'క్రెడిట్',
        debit: 'డెబిట్',
        completed: 'పూర్తిచేయబడింది',
        pending: 'పెండింగ్',
        footer: 'ఇది స్వయంచాలకంగా ఉత్పత్తి చేయబడిన వాలెట్ నివేదిక. ప్రశ్నల కోసం, దయచేసి సపోర్టును సంప్రదించండి.',
        reportId: 'నివేదిక ఐడీ'
    }
};

// Download Wallet Report
export const downloadReport = async (req, res) => {
    try {
        const userId = req.user._id;
        const lang = req.query.lang || 'en';
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Get translations for the selected language
        const t = pdfTranslations[lang] || pdfTranslations['en'];

        // Fetch all transactions for the user
        const transactions = await Transaction.find({ userId }).sort({ createdAt: -1 });

        // Create a PDF document
        const doc = new PDFDocument({
            margin: 40,
            size: 'A4',
            bufferPages: true
        });

        // Set response headers
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="wallet-report-${new Date().toISOString().split('T')[0]}.pdf"`);

        // Pipe document to response
        doc.pipe(res);

        // Use a standard font that works well
        const font = 'Helvetica';
        const fontBold = 'Helvetica-Bold';

        // ===== HEADER =====
        doc.fontSize(22).font(fontBold).fillColor('#667eea').text(t.title, { align: 'center' });
        doc.fontSize(10).font(font).fillColor('#666666');
        doc.text(`${t.generated}: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`, { align: 'center' });
        doc.moveTo(40, doc.y + 8).lineTo(555, doc.y + 8).stroke('#667eea');
        doc.moveDown(1);

        // ===== USER INFORMATION SECTION =====
        doc.fontSize(12).font(fontBold).fillColor('#0b1c30').text(t.userInfo);
        doc.fontSize(10).font(font).fillColor('#333333');
        doc.text(`${t.name}: ${user.name || 'N/A'}`);
        doc.text(`${t.email}: ${user.email || 'N/A'}`);
        doc.text(`${t.phone}: ${user.phone || 'N/A'}`);
        doc.fontSize(11).font(fontBold).fillColor('#667eea').text(`${t.balance}: ₹${(user.walletBalance || 0).toFixed(2)}`);
        doc.moveDown(0.8);

        // ===== SUMMARY SECTION =====
        const totalCredit = transactions.filter(t => t.type === 'credit').reduce((acc, tx) => acc + tx.amount, 0);
        const totalDebit = transactions.filter(t => t.type === 'debit').reduce((acc, tx) => acc + tx.amount, 0);

        doc.fontSize(12).font(fontBold).fillColor('#0b1c30').text(t.summary);
        doc.fontSize(10).font(font).fillColor('#333333');
        doc.text(`${t.totalCredits}: ₹${totalCredit.toFixed(2)}`, 50);
        doc.text(`${t.totalDebits}: ₹${totalDebit.toFixed(2)}`, 50);
        doc.fontSize(11).font(fontBold).fillColor('#059669').text(`${t.netBalance}: ₹${(totalCredit - totalDebit).toFixed(2)}`);
        doc.moveDown(0.8);

        // ===== TRANSACTIONS TABLE =====
        doc.fontSize(12).font(fontBold).fillColor('#0b1c30').text(t.transactions);
        doc.moveDown(0.5);

        // Simple table rendering
        const tableTop = doc.y;
        const pageWidth = doc.page.width - 80;
        const tableLeft = 40;

        // Headers
        const headers = [t.date, t.type, t.description, t.status, t.amount];
        const colWidths = [60, 50, 140, 70, 80];

        // Draw header background
        doc.rect(tableLeft, tableTop, pageWidth, 22).fillAndStroke('#667eea', '#667eea');
        doc.fontSize(9).font(fontBold).fillColor('#ffffff');

        let xPos = tableLeft + 5;
        for (let i = 0; i < headers.length; i++) {
            doc.text(headers[i], xPos, tableTop + 6, { width: colWidths[i] - 5, align: 'left' });
            xPos += colWidths[i];
        }

        let currentY = tableTop + 25;
        doc.fontSize(8).font(font).fillColor('#333333');

        let rowCount = 0;
        const maxRowsPerPage = 16;

        for (const tx of transactions) {
            if (rowCount >= maxRowsPerPage) {
                doc.addPage();
                currentY = 40;
                rowCount = 0;

                // Redraw header on new page
                doc.rect(tableLeft, currentY, pageWidth, 22).fillAndStroke('#667eea', '#667eea');
                doc.fontSize(9).font(fontBold).fillColor('#ffffff');

                xPos = tableLeft + 5;
                for (let i = 0; i < headers.length; i++) {
                    doc.text(headers[i], xPos, currentY + 6, { width: colWidths[i] - 5, align: 'left' });
                    xPos += colWidths[i];
                }

                currentY += 25;
                doc.fontSize(8).font(font).fillColor('#333333');
            }

            // Alternate row background
            if (rowCount % 2 === 0) {
                doc.rect(tableLeft, currentY, pageWidth, 18).fill('#f8f9ff');
            }

            const date = new Date(tx.createdAt).toLocaleDateString();
            const type = tx.type === 'credit' ? t.credit : t.debit;
            const desc = (tx.description || 'Transaction').substring(0, 20);
            const status = tx.status === 'completed' ? t.completed : t.pending;
            const amount = `₹${tx.amount.toFixed(2)}`;

            doc.fontSize(8).font(font).fillColor('#333333');
            xPos = tableLeft + 5;

            doc.text(date, xPos, currentY + 4, { width: colWidths[0] - 5, align: 'left' });
            xPos += colWidths[0];

            const typeColor = tx.type === 'credit' ? '#059669' : '#dc2626';
            doc.fillColor(typeColor).text(type, xPos, currentY + 4, { width: colWidths[1] - 5, align: 'left' });
            xPos += colWidths[1];

            doc.fillColor('#333333').text(desc, xPos, currentY + 4, { width: colWidths[2] - 5, align: 'left' });
            xPos += colWidths[2];

            const statusColor = tx.status === 'completed' ? '#059669' : '#f59e0b';
            doc.fillColor(statusColor).text(status, xPos, currentY + 4, { width: colWidths[3] - 5, align: 'center' });
            xPos += colWidths[3];

            doc.fillColor('#667eea').font(fontBold).text(amount, xPos, currentY + 4, { width: colWidths[4] - 5, align: 'right' });

            currentY += 18;
            rowCount++;
        }

        // Draw bottom line
        doc.moveTo(tableLeft, currentY).lineTo(tableLeft + pageWidth, currentY).stroke('#ddd');

        // ===== FOOTER =====
        doc.moveDown(2);
        doc.fontSize(8).font(font).fillColor('#999999');
        doc.text(t.footer, { align: 'center' });
        doc.text(`${t.reportId}: ${userId.toString().slice(-8).toUpperCase()}`, { align: 'center' });

        // Finalize PDF
        doc.end();
    } catch (error) {
        console.error('Error generating wallet report:', error);
        res.status(500).json({ message: 'Failed to generate report' });
    }
};
