import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import twilio from "twilio";

const FROM_NAME = "Mindcrawller  Global Pvt Ltd";
// ⚠️ IMPORTANT: FROM_EMAIL must exactly match the authenticated domain in Brevo dashboard
// (same subdomain, same TLD). Mismatches will cause authentication failures.
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.EMAIL || "support@mindcrawller.com";

// Validate that FROM_EMAIL is set
if (!FROM_EMAIL || FROM_EMAIL === "support@mindcrawller.com") {
  console.warn('⚠️ WARNING: Using fallback sender email. Please verify it in Brevo dashboard.');
  console.warn('   Current FROM_EMAIL:', FROM_EMAIL);
  console.warn('   Set EMAIL_FROM in .env to a verified Brevo sender.');
} else {
  console.log('✅ Sender email configured:', FROM_EMAIL);
}

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
        email: "support@mindcrawller.com",
        name: "Mindcrawller Support",
      },
      // ✅ SPAM FIX: Add List-Unsubscribe header (critical for Gmail/Outlook)
      headers: {
        "List-Unsubscribe":
          "<mailto:support@mindcrawller.com?subject=unsubscribe>",
        "X-Mailer": "Mindcrawller Mail Service",
        "X-Priority": "3",
      },
      // ✅ SPAM FIX: Request AMP for Email (Gmail friendly)
      amp4email: false,
      // ✅ SPAM FIX: Enable proper tracking & authentication
      trackingParams: "utm_source=mindcrawller&utm_medium=email",
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
  <title>Email Verification - mindcrawller</title>
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
      <h2>Mindcrawller Global Pvt Ltd</h2>
      <p>Healthcare Connecting Platform</p>
    </div>
    <div class="content">
      <h3>Verify Your Email Address</h3>
      <p>Thank you for creating an account with Mindcrawller . To complete your registration and access all features of our healthcare platform, please verify your email address by entering the verification code below.</p>
      <p>Your one-time verification code is:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>Code Expiration:</strong> This verification code is valid for 10 minutes from when this email was sent. Do not share this code with anyone.</p>
      <p>Once verified, you will gain full access to your Mindcrawller account including appointments, health records, and doctor consultations.</p>
      <p><strong>Security Note:</strong> If you did not create a Mindcrawller account, you can safely ignore this email. No account will be activated without verification.</p>
      <hr class="divider" />
      <div class="footer">
        <p>This is a transactional email from Mindcrawller sent to confirm your email address.<br/>
        For support, contact us at <a href="mailto:support@mindcrawller.com">support@mindcrawller.com</a><br/>
        &copy; ${new Date().getFullYear()} Mindcrawller  Global Pvt Ltd | Bhopal, Madhya Pradesh, India</p>
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
  <title>Login Verification - Mindcrawller</title>
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
      <h2>Mindcrawller Global Pvt Ltd</h2>
      <p>Healthcare Connecting Platform</p>
    </div>
    <div class="content">
      <h3>Confirm Your Login</h3>
      <p>We received a request to sign in to your Mindcrawller account. To confirm this is you and keep your account secure, please enter the verification code below.</p>
      <p>Your one-time login verification code is:</p>
      <div class="otp-box">
        <div class="otp-code">${otp}</div>
      </div>
      <p><strong>Code Expiration:</strong> This verification code is valid for 10 minutes. Do not share this code with anyone, including Mindcrawller support staff.</p>
      <div class="warning">
        <p><strong>⚠️ Security Alert:</strong> If you did not attempt to log in, your account credentials may be compromised. Change your password immediately and contact our support team.</p>
      </div>
      <hr class="divider" />
      <div class="footer">
        <p>This is a transactional email from Mindcrawller sent for account security.<br/>
        For support, contact us at <a href="mailto:support@mindcrawller.com">support@mindcrawller.com</a><br/>
        &copy; ${new Date().getFullYear()} Mindcrawller  Global Pvt Ltd | Bhopal, Madhya Pradesh, India</p>
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
        `Mindcrawller Global Pvt Ltd - Login Verification\n\n` +
        `We received a request to sign in to your Mindcrawller account.\n` +
        `To keep your account secure, please verify with the code below:\n\n` +
        `Verification Code: ${otp}\n` +
        `Expires in: 10 minutes\n\n` +
        `SECURITY: Do not share this code with anyone.\n` +
        `If this wasn't you, change your password immediately at support@mindcrawller.com\n\n` +
        `© ${new Date().getFullYear()} Mindcrawller  Global Pvt Ltd | Bhopal, India`;

      const data = await sendBrevoEmail({
        to: email,
        subject: "[Mindcrawller ] Your login verification code",
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
      `Mindcrawller  Global Pvt Ltd - Email Verification\n\n` +
      `Thank you for registering with Mindcrawller.\n` +
      `Please verify your email to access all features.\n\n` +
      `Verification Code: ${otp}\n` +
      `Expires in: 10 minutes\n\n` +
      `Do not share this code. If you didn't sign up, ignore this email.\n\n` +
      `Questions? Contact: support@mindcrawller.com\n\n` +
      `© ${new Date().getFullYear()} Mindcrawller  Global Pvt Ltd | Bhopal, India`;

    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const data = await sendBrevoEmail({
          to: email,
          subject: "[Mindcrawller ] Email verification code",
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

  async sendForgotPasswordOTP(email, otp) {
    const year = new Date().getFullYear();
    const textContent =
      `Mindcrawller  Global Pvt Ltd - Password Reset\n\n` +
      `We received a request to reset your Mindcrawller account password.\n` +
      `Use the code below to continue:\n\n` +
      `Password reset code: ${otp}\n` +
      `Expires in: 10 minutes\n\n` +
      `Do not share this code. If you did not request a password reset, ignore this email.\n\n` +
      `Questions? Contact: support@mindcrawller.com\n\n` +
      `Copyright ${year} Mindcrawller  Global Pvt Ltd | Bhopal, India`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Password Reset - Mindcrawller</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:Arial,sans-serif;">
  <div style="max-width:600px;margin:20px auto;border:1px solid #e6e6e6;border-radius:10px;overflow:hidden;background:white;">
    <div style="background:#2e7d32;padding:20px;text-align:center;color:white;">
      <h2 style="margin:0;font-size:22px;">Mindcrawller  Global Pvt Ltd</h2>
      <p style="margin:6px 0 0;font-size:14px;">Healthcare Connecting Platform</p>
    </div>
    <div style="padding:30px;">
      <h3 style="color:#222;margin-top:0;">Reset Your Password</h3>
      <p style="color:#444;line-height:1.7;">We received a request to reset your password. Enter this one-time code in the app to continue.</p>
      <div style="text-align:center;margin:30px 0;">
        <div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#fff;padding:15px 30px;background:#2e7d32;border-radius:8px;display:inline-block;">${otp}</div>
      </div>
      <p style="color:#444;line-height:1.7;"><strong>Code Expiration:</strong> This code is valid for 10 minutes. Do not share it with anyone.</p>
      <p style="color:#444;line-height:1.7;">If you did not request a password reset, you can safely ignore this email.</p>
      <hr style="border:none;border-top:1px solid #e6e6e6;margin:24px 0;" />
      <p style="font-size:12px;color:#666;line-height:1.7;">This is a transactional email from Mindcrawller sent for account security.<br/>For support, contact us at <a href="mailto:support@mindcrawller.com" style="color:#2e7d32;text-decoration:none;">support@mindcrawller.com</a><br/>Copyright ${year} Mindcrawller  Global Pvt Ltd | Bhopal, Madhya Pradesh, India</p>
    </div>
  </div>
</body>
</html>`;

    try {
      const data = await sendBrevoEmail({
        to: email,
        subject: "[Mindcrawller ] Password reset code",
        html,
        text: textContent,
      });

      console.log(
        `Forgot password OTP sent to ${email} | MessageID: ${data?.messageId}`,
      );
      return data;
    } catch (error) {
      console.error(`Forgot password OTP failed for ${email}:`, error.message);
      throw error;
    }
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
