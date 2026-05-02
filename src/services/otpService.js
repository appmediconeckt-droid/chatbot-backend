import dotenv from "dotenv";
dotenv.config();

import crypto from "crypto";
import twilio from "twilio";

const FROM_NAME = "Mindcrawller Global Pvt Ltd";
const FROM_EMAIL = process.env.EMAIL_FROM;

async function sendBrevoEmail({ to, subject, html }) {
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
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || `Brevo API error ${response.status}`);
  }

  return data;
}

const buildEmailOTPHtml = (otp) => `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden;">
    <div style="background: #4CAF50; padding: 15px; text-align: center; color: white;">
      <h2 style="margin: 0;">Mindcrawller Global Pvt Ltd</h2>
    </div>
    <div style="padding: 20px;">
      <h3 style="color: #333;">Dear User,</h3>
      <p style="color: #555;">
        Thank you for registering with Mindcrawller. Please verify your email using the OTP below:
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <span style="font-size: 30px; letter-spacing: 6px; font-weight: bold; color: #4CAF50; padding: 15px 25px; background: #f4f4f4; border-radius: 8px; display: inline-block;">
          ${otp}
        </span>
      </div>
      <p style="color: #555;">⏳ This OTP is valid for <strong>10 minutes</strong>.</p>
      <p style="color: #555;">If you did not create this account, please ignore this email.</p>
      <hr/>
      <p style="font-size: 12px; color: #999;">
        © ${new Date().getFullYear()} Mindcrawller Global Pvt Ltd<br/>
        This is an automated email. Please do not reply.
      </p>
    </div>
  </div>
`;

const buildLoginOTPHtml = (otp) => `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden;">
    <div style="background: #4CAF50; padding: 15px; text-align: center; color: white;">
      <h2 style="margin: 0;">Mindcrawller Global Pvt Ltd</h2>
    </div>
    <div style="padding: 20px;">
      <h3 style="color: #333;">Login Security Check</h3>
      <p style="color: #555;">
        We received a request to log in to your account from a new session. Since you were already logged in elsewhere, we've deactivated other sessions for your security.
      </p>
      <p style="color: #555;">Please use the verification code below to complete your login:</p>
      <div style="text-align: center; margin: 30px 0;">
        <span style="font-size: 30px; letter-spacing: 6px; font-weight: bold; color: #4CAF50; padding: 15px 25px; background: #f4f4f4; border-radius: 8px; display: inline-block;">
          ${otp}
        </span>
      </div>
      <p style="color: #555;">⏳ This OTP is valid for <strong>10 minutes</strong>.</p>
      <p style="color: #555;">If you did not request this login, please change your password immediately.</p>
      <hr/>
      <p style="font-size: 12px; color: #999;">
        © ${new Date().getFullYear()} Mindcrawller Global Pvt Ltd<br/>
        This is an automated email. Please do not reply.
      </p>
    </div>
  </div>
`;

class OTPService {
  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  async sendLoginOTP(email, otp) {
    try {
      const data = await sendBrevoEmail({
        to: email,
        subject: "Login Verification OTP - Mindcrawller",
        html: buildLoginOTPHtml(otp),
      });
      return data;
    } catch (error) {
      console.error("❌ Login OTP sending failed:", error.message);
      throw error;
    }
  }

  async sendEmailOTP(email, otp) {
    console.log(`Attempting to send OTP ${otp} to ${email}`);

    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const data = await sendBrevoEmail({
          to: email,
          subject: "Email Verification OTP - Mindcrawller",
          html: buildEmailOTPHtml(otp),
        });

        console.log("✅ Email sent successfully!");
        console.log("Message ID:", data?.messageId);
        return data;
      } catch (error) {
        lastError = error;

        // Don't retry 4xx client errors (bad email, invalid key, etc.)
        const status = error?.response?.status || error?.status;
        if ((status >= 400 && status < 500) || attempt === maxRetries) {
          break;
        }

        console.log(
          `⏳ Retry attempt ${attempt + 1}/${maxRetries}... ${error?.message || "unknown error"}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }

    console.error("❌ Error sending email after retries:", lastError?.message);
    throw new Error(
      `Failed to send email: ${lastError?.message || "Unknown error"}`,
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
