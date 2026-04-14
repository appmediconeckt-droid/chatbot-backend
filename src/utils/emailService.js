// utils/emailService.js
import nodemailer from 'nodemailer';

export const sendResetPasswordEmail = async (email, resetUrl) => {
    console.log('📧 Attempting to send email to:', email);
    console.log('🔗 Reset URL:', resetUrl);
    
    try {
        // Check if environment variables are set
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
            console.error('❌ Email credentials missing in .env file');
            throw new Error('Email configuration missing');
        }

        // Create transporter
        const transporter = nodemailer.createTransport({
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT) || 587,
            secure: (parseInt(process.env.EMAIL_PORT) === 465), // true for 465 (SSL), false for 587 (TLS)
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            },
            tls: {
                rejectUnauthorized: false // Only for development
            },
            connectionTimeout: 10000, // 10 seconds
            socketTimeout: 10000, // 10 seconds
            maxConnections: 5,
            maxMessages: 100,
            rateDelta: 1000,
            rateLimit: 5
        });

        // Verify connection configuration
        await transporter.verify();
        console.log('✅ SMTP connection verified');

        // Email content
        const mailOptions = {
            from: `"Counsler App" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        .container {
                            font-family: Arial, sans-serif;
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            border: 1px solid #e0e0e0;
                            border-radius: 5px;
                        }
                        .button {
                            display: inline-block;
                            padding: 10px 20px;
                            background-color: #4CAF50;
                            color: white;
                            text-decoration: none;
                            border-radius: 5px;
                            margin: 20px 0;
                        }
                        .footer {
                            margin-top: 30px;
                            font-size: 12px;
                            color: #666;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h2>Password Reset Request</h2>
                        <p>Hello,</p>
                        <p>You requested to reset your password. Click the button below to reset it:</p>
                        <a href="${resetUrl}" class="button">Reset Password</a>
                        <p>Or copy this link to your browser:</p>
                        <p>${resetUrl}</p>
                        <p><strong>This link will expire in 10 minutes.</strong></p>
                        <p>If you didn't request this, please ignore this email.</p>
                        <div class="footer">
                            <p>This is an automated message, please do not reply.</p>
                        </div>
                    </div>
                </body>
                </html>
            `
        };

        // Send email
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent successfully:', info.messageId);
        
        if (process.env.NODE_ENV === 'development') {
            console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(info));
        }
        
        return info;

    } catch (error) {
        console.error('❌ Email sending failed:', {
            message: error.message,
            code: error.code,
            command: error.command,
            response: error.response
        });
        
        // Throw a more specific error message
        if (error.code === 'EAUTH') {
            throw new Error('Email authentication failed. Check your email credentials.');
        } else if (error.code === 'ESOCKET') {
            throw new Error('Could not connect to email server. Check your network.');
        } else {
            throw new Error(`Email could not be sent: ${error.message}`);
        }
    }
};