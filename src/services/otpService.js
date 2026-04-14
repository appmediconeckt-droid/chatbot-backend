// //its for mail services/otpService.js
import dotenv from "dotenv";
dotenv.config();
// import crypto from "crypto";
// import nodemailer from "nodemailer";
// import twilio from "twilio";

// // Add this for debugging
// console.log('Email User:', process.env.EMAIL_USER ? 'Set' : 'Missing');
// console.log('Email Pass:', process.env.EMAIL_PASS ? 'Set' : 'Missing');
// console.log('All env vars:', Object.keys(process.env).filter(key => key.includes('EMAIL')));

// class OTPService {

//     constructor() {
//         // Email configuration
//         this.emailTransporter = nodemailer.createTransport({
//             service: 'gmail',
//             auth: {
//                 user: process.env.EMAIL_USER,
//                 pass: process.env.EMAIL_PASS
//             }
//         });

//         // Twilio configuration for SMS
//         this.twilioClient = twilio(
//             process.env.TWILIO_ACCOUNT_SID,
//             process.env.TWILIO_AUTH_TOKEN
//         );
//     }

//     generateOTP() {
//         return crypto.randomInt(100000, 999999).toString();
//     }

//     async sendEmailOTP(email, otp) {
//     const mailOptions = {
//         from: `"Mindcrawller Global Pvt Ltd" <${process.env.EMAIL_USER}>`,
//         to: email,
//         subject: 'Email Verification OTP - Mindcrawller',
//         html: `
//         <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden;">

//             <div style="background: #4CAF50; padding: 15px; text-align: center; color: white;">
//                 <h2 style="margin: 0;">Mindcrawller Global Pvt Ltd</h2>
//             </div>

//             <div style="padding: 20px;">
//                 <h3 style="color: #333;">Dear User,</h3>

//                 <p style="color: #555;">
//                     Thank you for registering with Mindcrawller. Please verify your email using the OTP below:
//                 </p>

//                 <div style="text-align: center; margin: 30px 0;">
//                     <span style="
//                         font-size: 30px;
//                         letter-spacing: 6px;
//                         font-weight: bold;
//                         color: #4CAF50;
//                         padding: 15px 25px;
//                         background: #f4f4f4;
//                         border-radius: 8px;
//                         display: inline-block;
//                     ">
//                         ${otp}
//                     </span>
//                 </div>

//                 <p style="color: #555;">
//                     ⏳ This OTP is valid for <strong>10 minutes</strong>.
//                 </p>

//                 <p style="color: #555;">
//                     If you did not create this account, please ignore this email.
//                 </p>

//                 <hr/>

//                 <p style="font-size: 12px; color: #999;">
//                     © ${new Date().getFullYear()} Mindcrawller Global Pvt Ltd <br/>
//                     This is an automated email. Please do not reply.
//                 </p>
//             </div>
//         </div>
//         `
//     };

//     await this.emailTransporter.sendMail(mailOptions);
// }
// //   async sendEmailOTP(email, otp, ) {
// //     const mailOptions = {
// //         from: `"Mindcrawller Global Pvt Ltd" <${process.env.EMAIL_USER}>`,
// //         to: email,
// //         subject: 'Login Verification OTP - Mindcrawller',
// //         html: `
// //         <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e6e6e6; border-radius: 10px; overflow: hidden;">

// //             <div style="background: #4CAF50; padding: 15px; text-align: center; color: white;">
// //                 <h2 style="margin: 0;">Mindcrawller Global Pvt Ltd</h2>
// //             </div>

// //             <div style="padding: 20px;">

// //                 <p style="color: #555;">
// //                     We received a login request for your account. Please use the OTP below to continue:
// //                 </p>

// //                 <div style="text-align: center; margin: 30px 0;">
// //                     <span style="
// //                         font-size: 30px;
// //                         letter-spacing: 6px;
// //                         font-weight: bold;
// //                         color: #4CAF50;
// //                         padding: 15px 25px;
// //                         background: #f4f4f4;
// //                         border-radius: 8px;
// //                         display: inline-block;
// //                     ">
// //                         ${otp}
// //                     </span>
// //                 </div>

// //                 <p style="color: #555;">
// //                     ⏳ This OTP is valid for <strong>10 minutes</strong>.
// //                 </p>

// //                 <p style="color: #555;">
// //                     If you did not request this login, please ignore this email or secure your account.
// //                 </p>

// //                 <hr/>

// //                 <p style="font-size: 12px; color: #999;">
// //                     © ${new Date().getFullYear()} Mindcrawller Global Pvt Ltd <br/>
// //                     This is an automated email. Please do not reply.
// //                 </p>
// //             </div>
// //         </div>
// //         `
// //     };

// //     await this.emailTransporter.sendMail(mailOptions);
// // }

//     async sendPhoneOTP(phone, otp) {
//         try {
//             await this.twilioClient.messages.create({
//                 body: `Your MindCruller phone verification OTP is: ${otp}. This OTP will expire in 10 minutes.`,
//                 from: process.env.TWILIO_PHONE_NUMBER,
//                 to: phone
//             });
//         } catch (error) {
//             console.error("SMS sending error:", error);
//             throw new Error("Failed to send SMS. Please check phone number.");
//         }
//     }

//     storeOTP(user, type, otp) {
//         const expiresAt = new Date();
//         expiresAt.setMinutes(expiresAt.getMinutes() + 10);

//         if (type === 'email') {
//             user.emailOTP = { code: otp, expiresAt };
//         } else if (type === 'phone') {
//             user.phoneOTP = { code: otp, expiresAt };
//         }
//     }

//     verifyOTP(user, type, enteredOTP) {
//         const otpData = type === 'email' ? user.emailOTP : user.phoneOTP;

//         if (!otpData || !otpData.code) {
//             return { valid: false, message: 'OTP not found or already verified' };
//         }

//         if (new Date() > otpData.expiresAt) {
//             return { valid: false, message: 'OTP has expired. Please request a new one.' };
//         }

//         if (otpData.code !== enteredOTP) {
//             return { valid: false, message: 'Invalid OTP. Please check and try again.' };
//         }

//         return { valid: true, message: 'OTP verified successfully' };
//     }

//     clearOTP(user, type) {
//         if (type === 'email') {
//             user.emailOTP = null;
//         } else if (type === 'phone') {
//             user.phoneOTP = null;
//         }
//     }
// }

// export default new OTPService();

// otpService.js
import crypto from "crypto";
import dns from "node:dns";
import nodemailer from "nodemailer";
import twilio from "twilio";

// Render environments can fail on IPv6-only SMTP routes; prefer IPv4 lookups.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch (err) {
  console.warn("Could not set DNS default result order:", err?.message || err);
}

class OTPService {
  constructor() {
    // Log credential details (be careful with production!)
    const emailUser = process.env.EMAIL_USER;
    const emailPass = process.env.EMAIL_PASS;

    // console.log('EMAIL_USER type:', typeof emailUser);
    // console.log('EMAIL_USER length:', emailUser ? emailUser.length : 0);
    // console.log('EMAIL_USER value:', emailUser);
    // console.log('EMAIL_PASS type:', typeof emailPass);
    // console.log('EMAIL_PASS length:', emailPass ? emailPass.length : 0);
    // console.log('EMAIL_PASS first 4 chars:', emailPass ? emailPass.substring(0, 4) : 'undefined');

    // Check if credentials are actually empty strings
    // if (emailUser === '' || emailUser === undefined || emailUser === null) {
    //     console.error('❌ EMAIL_USER is empty or undefined!');
    // }
    // if (emailPass === '' || emailPass === undefined || emailPass === null) {
    //     console.error('❌ EMAIL_PASS is empty or undefined!');
    // }

    const smtpHost = process.env.EMAIL_HOST || "smtp.gmail.com";
    const smtpPort = Number(process.env.EMAIL_PORT || 587);
    const smtpSecure = process.env.EMAIL_SECURE
      ? process.env.EMAIL_SECURE === "true"
      : smtpPort === 465;
    const forceIPv4 = process.env.EMAIL_FORCE_IPV4 !== "false";

    // Create transporter with explicit auth
    this.emailTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure, // true for 465 (SSL), false for 587 (STARTTLS)
      requireTLS: !smtpSecure,
      auth: {
        user: emailUser,
        pass: emailPass,
      },
      // IPv6 routing can fail on some Render networks; force IPv4 unless disabled.
      family: forceIPv4 ? 4 : undefined,
      debug: process.env.EMAIL_DEBUG === "true",
      logger: process.env.EMAIL_DEBUG === "true",
      tls: {
        rejectUnauthorized:
          process.env.EMAIL_TLS_REJECT_UNAUTHORIZED !== "false",
        servername: smtpHost,
        minVersion: "TLSv1.2",
      },
      connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT || 15000),
      greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT || 15000),
      socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT || 20000),
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 5,
    });

    // Verify connection
    this.verifyConnection();
  }

  async verifyConnection() {
    try {
      await this.emailTransporter.verify();
      // console.log('✅ SMTP connection verified successfully');
    } catch (error) {
      console.error("❌ SMTP verification failed:", error.message);
      // console.error('Please check your email credentials and Gmail settings');
    }
  }

  generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
  }

  async sendEmailOTP(email, otp) {
    try {
      console.log(`Attempting to send OTP ${otp} to ${email}`);

      const mailOptions = {
        from: `"Mindcrawller Global Pvt Ltd" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: "Email Verification OTP - Mindcrawller",
        html: `
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
                            <span style="
                                font-size: 30px;
                                letter-spacing: 6px;
                                font-weight: bold;
                                color: #4CAF50;
                                padding: 15px 25px;
                                background: #f4f4f4;
                                border-radius: 8px;
                                display: inline-block;
                            ">
                                ${otp}
                            </span>
                        </div>

                        <p style="color: #555;">
                            ⏳ This OTP is valid for <strong>10 minutes</strong>.
                        </p>

                        <p style="color: #555;">
                            If you did not create this account, please ignore this email.
                        </p>

                        <hr/>

                        <p style="font-size: 12px; color: #999;">
                            © ${new Date().getFullYear()} Mindcrawller Global Pvt Ltd <br/>
                            This is an automated email. Please do not reply.
                        </p>
                    </div>
                </div>
                `,
      };

      // Retry logic for transient failures
      const maxRetries = 3;
      let retriesLeft = maxRetries;
      let lastError;

      while (retriesLeft > 0) {
        try {
          const info = await this.emailTransporter.sendMail(mailOptions);
          console.log("✅ Email sent successfully!");
          console.log("Message ID:", info.messageId);
          console.log("Response:", info.response);
          return info;
        } catch (error) {
          lastError = error;
          retriesLeft -= 1;

          const errorCode = String(error?.code || "").toUpperCase();
          const errorMessage = String(error?.message || "").toUpperCase();
          const isRetryableNetworkError =
            [
              "ETIMEDOUT",
              "ECONNREFUSED",
              "ENETUNREACH",
              "EAI_AGAIN",
              "ESOCKET",
            ].includes(errorCode) ||
            errorMessage.includes("ENETUNREACH") ||
            errorMessage.includes("ETIMEDOUT");

          if (retriesLeft > 0 && isRetryableNetworkError) {
            const attemptNumber = maxRetries - retriesLeft;
            console.log(
              `⏳ Retry attempt ${attemptNumber + 1}/${maxRetries}... Error: ${errorCode || "UNKNOWN"}`,
            );
            // Exponential backoff: 2s, 4s
            await new Promise((resolve) =>
              setTimeout(resolve, 2000 * Math.max(1, attemptNumber)),
            );
          } else {
            break;
          }
        }
      }

      // If all retries failed, throw the last error
      console.error(`❌ Error sending email after ${maxRetries} retries:`);
      console.error("Error code:", lastError?.code);
      console.error("Error message:", lastError?.message);
      throw new Error(
        `Failed to send email: ${lastError?.message || "Unknown SMTP error"}`,
      );
    } catch (error) {
      console.error("❌ Email sending failed:", error.message);
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
