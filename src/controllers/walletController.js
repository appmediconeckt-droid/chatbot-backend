import Razorpay from 'razorpay';
import crypto from 'crypto';
import User from '../models/userModel.js';
import Transaction from '../models/transactionModel.js';
import PdfPrinter from 'pdfmake';
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
        generated: 'Generated on',
        userInfo: 'User Information',
        summary: 'Transaction Summary',
        transactions: 'Transaction Details',
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
        transactions: 'लेनदेन विवरण',
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
        title: 'வணிக அறிக்கை',
        generated: 'உருவாக்கப்பட்டது',
        userInfo: 'பயனர் தகவல்',
        summary: 'பரிவர்த்தனை சுருக்கம்',
        transactions: 'பரிவர்த்தனை விவரம்',
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
        footer: 'இது தானாக உருவாக்கப்பட்ட வணிக அறிக்கை. கேள்விகளுக்கு, தயவுசெய்து ஆதரவைத் தொடர்புகொள்ளவும்.',
        reportId: 'அறிக்கை குறுவொளி'
    },
    mr: {
        title: 'वॉलेट अहवाल',
        generated: 'तयार केले',
        userInfo: 'वापरकर्ता माहिती',
        summary: 'व्यवहार सारांश',
        transactions: 'व्यवहार तपशील',
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
        transactions: 'లావాదేవీ వివరాలు',
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

// Download Wallet Report with pdfmake
export const downloadReport = async (req, res) => {
    try {
        const userId = req.user._id;
        const lang = req.query.lang || 'en';
        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const t = pdfTranslations[lang] || pdfTranslations['en'];
        const transactions = await Transaction.find({ userId }).sort({ createdAt: -1 });

        const totalCredit = transactions.filter(tx => tx.type === 'credit').reduce((acc, tx) => acc + tx.amount, 0);
        const totalDebit = transactions.filter(tx => tx.type === 'debit').reduce((acc, tx) => acc + tx.amount, 0);

        // Build table rows
        const tableRows = [
            [
                { text: t.date, bold: true, color: 'white', fillColor: '#667eea' },
                { text: t.type, bold: true, color: 'white', fillColor: '#667eea' },
                { text: t.description, bold: true, color: 'white', fillColor: '#667eea' },
                { text: t.status, bold: true, color: 'white', fillColor: '#667eea' },
                { text: t.amount, bold: true, color: 'white', fillColor: '#667eea', alignment: 'right' }
            ]
        ];

        for (const tx of transactions) {
            tableRows.push([
                new Date(tx.createdAt).toLocaleDateString(),
                tx.type === 'credit' ? t.credit : t.debit,
                (tx.description || 'Transaction').substring(0, 25),
                tx.status === 'completed' ? t.completed : t.pending,
                { text: `₹${tx.amount.toFixed(2)}`, alignment: 'right' }
            ]);
        }

        // Define document
        const docDefinition = {
            content: [
                { text: t.title, fontSize: 24, bold: true, color: '#667eea', alignment: 'center' },
                { text: `${t.generated}: ${new Date().toLocaleDateString()}`, fontSize: 10, alignment: 'center', color: '#666666', margin: [0, 5, 0, 15] },

                { text: t.userInfo, fontSize: 14, bold: true, color: '#0b1c30', margin: [0, 10, 0, 8] },
                {
                    columns: [
                        { text: `${t.name}: ${user.name || 'N/A'}`, fontSize: 11 },
                        { text: `${t.email}: ${user.email || 'N/A'}`, fontSize: 11 }
                    ],
                    margin: [0, 0, 0, 5]
                },
                {
                    columns: [
                        { text: `${t.phone}: ${user.phone || 'N/A'}`, fontSize: 11 },
                        { text: `${t.balance}: ₹${(user.walletBalance || 0).toFixed(2)}`, fontSize: 12, bold: true, color: '#667eea' }
                    ],
                    margin: [0, 0, 0, 15]
                },

                { text: t.summary, fontSize: 14, bold: true, color: '#0b1c30', margin: [0, 10, 0, 8] },
                {
                    columns: [
                        { text: `${t.totalCredits}: ₹${totalCredit.toFixed(2)}`, fontSize: 11 },
                        { text: `${t.totalDebits}: ₹${totalDebit.toFixed(2)}`, fontSize: 11 },
                        { text: `${t.netBalance}: ₹${(totalCredit - totalDebit).toFixed(2)}`, fontSize: 12, bold: true, color: '#059669' }
                    ],
                    margin: [0, 0, 0, 15]
                },

                { text: t.transactions, fontSize: 14, bold: true, color: '#0b1c30', margin: [0, 10, 0, 8] },
                {
                    table: {
                        headerRows: 1,
                        widths: ['15%', '12%', '35%', '15%', '23%'],
                        body: tableRows
                    },
                    layout: {
                        fillColor: (rowIndex) => {
                            return rowIndex === 0 ? '#667eea' : (rowIndex % 2 === 0 ? '#f8f9ff' : 'white');
                        },
                        hLineColor: () => '#ddd',
                        vLineColor: () => '#ddd'
                    },
                    margin: [0, 0, 0, 15]
                },

                { text: t.footer, fontSize: 9, color: '#999999', alignment: 'center', margin: [0, 10, 0, 5] },
                { text: `${t.reportId}: ${userId.toString().slice(-8).toUpperCase()}`, fontSize: 9, color: '#999999', alignment: 'center' }
            ],
            defaultStyle: {
                font: 'Helvetica'
            }
        };

        const fonts = {
            Helvetica: {
                normal: 'Helvetica',
                bold: 'Helvetica-Bold',
                italics: 'Helvetica-Oblique',
                bolditalics: 'Helvetica-BoldOblique'
            }
        };

        const printer = new PdfPrinter(fonts);
        const pdfDoc = printer.createPdfKitDocument(docDefinition);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="wallet-report-${new Date().toISOString().split('T')[0]}.pdf"`);

        pdfDoc.pipe(res);
        pdfDoc.end();
    } catch (error) {
        console.error('Error generating wallet report:', error);
        res.status(500).json({ message: 'Failed to generate report', error: error.message });
    }
};
