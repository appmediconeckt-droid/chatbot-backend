import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dns from "node:dns";
import connectDB from "../src/config/db.js";
import User from "../src/models/userModel.js";
import { APP_REVIEW_TEST_EMAILS } from "../src/services/otpService.js";

dotenv.config();
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const TEST_PASSWORD = process.env.PLAY_REVIEW_TEST_PASSWORD || "Humaeli@123";
const seededEmails = new Set([
  "appstore.user@humaeli.com",
  "appstore.counsellor@humaeli.com",
  ...APP_REVIEW_TEST_EMAILS,
]);

const commonProfile = {
  authProvider: "local",
  profileCompleted: true,
  isEmailVerified: true,
  isPhoneVerified: true,
  isActive: true,
  isVerified: true,
  hasPassword: true,
  locationConsent: true,
  locationData: {
    current: {
      type: "Point",
      coordinates: [0, 0],
      address: "Indore, Madhya Pradesh, India",
      city: "Indore",
      state: "Madhya Pradesh",
      country: "India",
      capturedAt: new Date(),
    },
    history: [],
  },
};

const accounts = [
  {
    fullName: "App Review User",
    anonymous: "Review User",
    email: "appstore.user@humaeli.com",
    phoneNumber: "9000000001",
    phoneCountryCode: "+91",
    age: 28,
    gender: "male",
    role: "user",
    dateOfBirth: new Date("1998-01-01T00:00:00.000Z"),
    profilePhoto: {
      url: "https://api.dicebear.com/7.x/adventurer/png?seed=AppReviewUser",
      publicId: null,
    },
  },
  {
    fullName: "App Review Counsellor",
    anonymous: "Review Counsellor",
    email: "appstore.counsellor@humaeli.com",
    phoneNumber: "9000000002",
    phoneCountryCode: "+91",
    age: 32,
    gender: "female",
    role: "counsellor",
    dateOfBirth: new Date("1994-01-01T00:00:00.000Z"),
    qualification: "M.Sc. Psychology",
    education: "M.Sc. Psychology",
    specialization: ["Mental Wellness"],
    experience: 5,
    location: "Indore",
    consultationMode: ["online"],
    languages: ["English", "Hindi"],
    aboutMe: "App Store review account for testing the counsellor experience.",
    address: {
      line1: "Humaeli App Review Clinic",
      line2: "",
      city: "Indore",
      state: "Madhya Pradesh",
      pincode: "452001",
      country: "India",
    },
    certifications: [
      {
        name: "App Review Testing Certificate",
        issuedBy: "Humaeli",
        issueDate: new Date("2026-01-01T00:00:00.000Z"),
        expiryDate: null,
        documentUrl: "https://humaeli.com/app-review-certificate.pdf",
        documentPublicId: null,
        documentName: "app-review-certificate.pdf",
      },
    ],
    profilePhoto: {
      url: "https://api.dicebear.com/7.x/adventurer/png?seed=AppReviewCounsellor",
      publicId: null,
    },
  },
  {
    fullName: "Humaeli Play Review User",
    anonymous: "Review User",
    email: "playstore.user@humaeli.com",
    phoneNumber: "9000000003",
    phoneCountryCode: "+91",
    age: 28,
    gender: "male",
    role: "user",
    dateOfBirth: new Date("1998-01-01T00:00:00.000Z"),
    profilePhoto: {
      url: "https://api.dicebear.com/7.x/adventurer/png?seed=PlayReviewUser",
      publicId: null,
    },
  },
  {
    fullName: "Humaeli Play Review Counsellor",
    anonymous: "Review Counsellor",
    email: "playstore.counsellor@humaeli.com",
    phoneNumber: "9000000004",
    phoneCountryCode: "+91",
    age: 32,
    gender: "female",
    role: "counsellor",
    dateOfBirth: new Date("1994-01-01T00:00:00.000Z"),
    qualification: "M.Sc. Psychology",
    education: "M.Sc. Psychology",
    specialization: ["Mental Wellness"],
    experience: 5,
    location: "Indore",
    consultationMode: ["online"],
    languages: ["English", "Hindi"],
    aboutMe: "Play Store review account for testing the counsellor experience.",
    address: {
      line1: "Humaeli Play Review Clinic",
      line2: "",
      city: "Indore",
      state: "Madhya Pradesh",
      pincode: "452001",
      country: "India",
    },
    certifications: [
      {
        name: "Play Review Testing Certificate",
        issuedBy: "Humaeli",
        issueDate: new Date("2026-01-01T00:00:00.000Z"),
        expiryDate: null,
        documentUrl: "https://humaeli.com/play-review-certificate.pdf",
        documentPublicId: null,
        documentName: "play-review-certificate.pdf",
      },
    ],
    profilePhoto: {
      url: "https://api.dicebear.com/7.x/adventurer/png?seed=PlayReviewCounsellor",
      publicId: null,
    },
  },
];

async function getAvailablePhoneNumber(preferredPhoneNumber, email) {
  const preferred = String(preferredPhoneNumber);
  const width = preferred.length;
  let candidate = BigInt(preferred);

  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const phoneNumber = candidate.toString().padStart(width, "0");
    const existing = await User.findOne({
      phoneNumber,
      email: { $ne: email },
    }).select("_id");

    if (!existing) return phoneNumber;
    candidate += 1n;
  }

  throw new Error(`Unable to find an available test phone number for ${email}`);
}

async function seedPlayReviewAccounts() {
  await connectDB();
  const password = await bcrypt.hash(TEST_PASSWORD, 10);

  for (const account of accounts.filter((account) => seededEmails.has(account.email))) {
    const phoneNumber = await getAvailablePhoneNumber(
      account.phoneNumber,
      account.email,
    );

    await User.findOneAndUpdate(
      { email: account.email },
      {
        $set: {
          ...commonProfile,
          ...account,
          phoneNumber,
          password,
        },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );

    console.log(`Seeded ${account.role}: ${account.email}`);
  }
}

seedPlayReviewAccounts()
  .then(async () => {
    console.log("Play review accounts are ready.");
    await mongoose.disconnect();
  })
  .catch(async (error) => {
    console.error("Failed to seed Play review accounts:", error.message);
    await mongoose.disconnect();
    process.exitCode = 1;
  });
