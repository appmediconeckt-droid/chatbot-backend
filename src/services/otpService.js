import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import twilio from "twilio";

const FROM_NAME = "Mediconeckt Global Pvt Ltd";
// ⚠️ IMPORTANT: FROM_EMAIL must exactly match the authenticated domain in Brevo dashboard
// (same subdomain, same TLD). Mismatches will cause authentication failures.
const FROM_EMAIL = process.env.EMAIL_FROM;

async function sendBrevoEmail({ to, subject, html, text }) {
  // Ensure textContent is never undefined (MIME_HTML_ONLY compliance)
  const safeText = text || "Please enable HTML to view this email.";

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { name: FROM_NAME, email: FROM_EMAIL },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: safeText,
      replyTo: {
        email: "support@mediconeckt.com",
        name: "Mediconeckt Support",
      },
      // ✅ SPAM FIX: Add List-Unsubscribe header (critical for Gmail/Outlook)
      headers: {
        "List-Unsubscribe":
          "<mailto:support@mediconeckt.com?subject=unsubscribe>",
        "X-Mailer": "Mediconeckt Mail Service",
        "X-Priority": "3",
      },
      // ✅ SPAM FIX: Request AMP for Email (Gmail friendly)
      amp4email: false,
      // ✅ SPAM FIX: Enable proper tracking & authentication
      trackingParams: "utm_source=mediconeckt&utm_medium=email",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || `Brevo API error ${response.status}`);
  }

  return data;
}

const buildEmailOTPHtml = (otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Email Verification - Mediconeckt</title>
  <style>
    body { margin: 0; padding: 0; background: #f9f9f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
    .container { max-width: 600px; margin: 20px auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden; background: white; }
    .header { background: #2e7d32; padding: 20px; text-align: center; color: white; }
    .header h2 { margin: 0; font-size: 22px; font-weight: 600; }
    .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 30px; }
    .content h3 { color: #222; margin-top: 0; margin-bottom: 15px; }
    .content p { color: #444; line-height: 1.7; margin: 12px 0; }
    .otp-box { text-align: center; margin: 30px 0; }
    .otp-code { font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #ffffff; padding: 15px 30px; background: #2e7d32; border-radius: 8px; display: inline-block; }
    .divider { border: none; border-top: 1px solid #e6e6e6; margin: 24px 0; }
    .footer { font-size: 12px; color: #666; line-height: 1.7; }
    .footer a { color: #2e7d32; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Mediconeckt Global Pvt Ltd</h2>
      <p>Healthcare Connecting Platform</p>
    </div>
    <div class="content">
      <h3>Verify Your Email Address</h3>
      <p>Thank you for creating an account with Mediconeckt. To complete your registration and access all features of our healthcare platform, please verify your email address by entering the verification code below.</p>
      <p>Your one-time verification code is:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>Code Expiration:</strong> This verification code is valid for 10 minutes from when this email was sent. Do not share this code with anyone.</p>
      <p>Once verified, you will gain full access to your Mediconeckt account including appointments, health records, and doctor consultations.</p>
      <p><strong>Security Note:</strong> If you did not create a Mediconeckt account, you can safely ignore this email. No account will be activated without verification.</p>
      <hr class="divider" />
      <div class="footer">
        <p>This is a transactional email from Mediconeckt sent to confirm your email address.<br/>
        For support, contact us at <a href="mailto:support@mediconeckt.com">support@mediconeckt.com</a><br/>
        &copy; ${new Date().getFullYear()} Mediconeckt Global Pvt Ltd | Bhopal, Madhya Pradesh, India</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

const buildLoginOTPHtml = (otp) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Login Verification - Mediconeckt</title>
  <style>
    body { margin: 0; padding: 0; background: #f9f9f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; }
    .container { max-width: 600px; margin: 20px auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden; background: white; }
    .header { background: #2e7d32; padding: 20px; text-align: center; color: white; }
    .header h2 { margin: 0; font-size: 22px; font-weight: 600; }
    .header p { margin: 6px 0 0; font-size: 14px; opacity: 0.9; }
    .content { padding: 30px; }
    .content h3 { color: #222; margin-top: 0; margin-bottom: 15px; }
    .content p { color: #444; line-height: 1.7; margin: 12px 0; }
    .otp-box { text-align: center; margin: 30px 0; }
    .otp-code { font-size: 32px; letter-spacing: 8px; font-weight: bold; color: #ffffff; padding: 15px 30px; background: #2e7d32; border-radius: 8px; display: inline-block; }
    .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 15px; margin: 15px 0; border-radius: 4px; }
    .warning p { margin: 0; color: #856404; font-size: 14px; }
    .divider { border: none; border-top: 1px solid #e6e6e6; margin: 24px 0; }
    .footer { font-size: 12px; color: #666; line-height: 1.7; }
    .footer a { color: #2e7d32; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Mediconeckt Global Pvt Ltd</h2>
      <p>Healthcare Connecting Platform</p>
    </div>
    <div class="content">
      <h3>Confirm Your Login</h3>
      <p>We received a request to sign in to your Mediconeckt account. To confirm this is you and keep your account secure, please enter the verification code below.</p>
      <p>Your one-time login verification code is:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>Code Expiration:</strong> This verification code is valid for 10 minutes. Do not share this code with anyone, including Mediconeckt support staff.</p>
      <div class="warning">
        <p><strong>⚠️ Security Alert:</strong> If you did not attempt to log in, your account credentials may be compromised. Change your password immediately and contact our support team.</p>
      </div>
      <hr class="divider" />
      <div class="footer">
        <p>This is a transactional email from Mediconeckt sent for account security.<br/>
        For support, contact us at <a href="mailto:support@mediconeckt.com">support@mediconeckt.com</a><br/>
        &copy; ${new Date().getFullYear()} Mediconeckt Global Pvt Ltd | Bhopal, Madhya Pradesh, India</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

class OTPService {
  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  async sendLoginOTP(email, otp) {
    try {
      const textContent =
        `Mediconeckt Global Pvt Ltd - Login Verification\n\n` +
        `We received a request to sign in to your Mediconeckt account.\n` +
        `To keep your account secure, please verify with the code below:\n\n` +
        `Verification Code: ${otp}\n` +
        `Expires in: 10 minutes\n\n` +
        `SECURITY: Do not share this code with anyone.\n` +
        `If this wasn't you, change your password immediately at support@mediconeckt.com\n\n` +
        `© ${new Date().getFullYear()} Mediconeckt Global Pvt Ltd | Bhopal, India`;

      const data = await sendBrevoEmail({
        to: email,
        subject: "[Mediconeckt] Your login verification code",
        html: buildLoginOTPHtml(otp),
        text: textContent,
      });

      console.log(
        `✅ Login OTP sent to ${email} | MessageID: ${data?.messageId}`,
      );
      return data;
    } catch (error) {
      console.error(`❌ Login OTP failed for ${email}:`, error.message);
      throw error;
    }
  }

  async sendEmailOTP(email, otp) {
    console.log(`📧 Sending email verification OTP to ${email}`);

    const textContent =
      `Mediconeckt Global Pvt Ltd - Email Verification\n\n` +
      `Thank you for registering with Mediconeckt.\n` +
      `Please verify your email to access all features.\n\n` +
      `Verification Code: ${otp}\n` +
      `Expires in: 10 minutes\n\n` +
      `Do not share this code. If you didn't sign up, ignore this email.\n\n` +
      `Questions? Contact: support@mediconeckt.com\n\n` +
      `© ${new Date().getFullYear()} Mediconeckt Global Pvt Ltd | Bhopal, India`;

    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const data = await sendBrevoEmail({
          to: email,
          subject: "[Mediconeckt] Email verification code",
          html: buildEmailOTPHtml(otp),
          text: textContent,
        });

        console.log(
          `✅ Email OTP sent successfully to ${email} | MessageID: ${data?.messageId}`,
        );
        return data;
      } catch (error) {
        lastError = error;

        // Don't retry 4xx client errors (bad email, invalid key, etc.)
        const status = error?.response?.status || error?.status || 0;
        const isClientError = status >= 400 && status < 500;

        if (isClientError) {
          console.error(
            `❌ Client error (${status}) - not retrying: ${error?.message}`,
          );
          break;
        }

        if (attempt === maxRetries) {
          console.error(`❌ Final attempt (${attempt}/${maxRetries}) failed`);
          break;
        }

        const waitTime = 2000 * attempt;
        console.log(
          `⏳ Retry ${attempt + 1}/${maxRetries} in ${waitTime}ms... (${error?.message})`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    throw new Error(
      `Failed to send email OTP to ${email}: ${lastError?.message || "Unknown error"}`,
    );
  }

  verifyOTP(user, type, enteredOTP) {
    const otpData = type === "email" ? user.emailOTP : user.phoneOTP;

    if (!otpData || !otpData.code) {
      return { valid: false, message: "OTP not found or already verified" };
    }

    if (new Date() > otpData.expiresAt) {
      return {
        valid: false,
        message: "OTP has expired. Please request a new one.",
      };
    }

    if (otpData.code !== enteredOTP) {
      return {
        valid: false,
        message: "Invalid OTP. Please check and try again.",
      };
    }

    return { valid: true, message: "OTP verified successfully" };
  }

  clearOTP(user, type) {
    if (type === "email") {
      user.emailOTP = null;
    } else if (type === "phone") {
      user.phoneOTP = null;
    }
    console.log(`OTP cleared for ${type}`);
  }
}

export default new OTPService();
