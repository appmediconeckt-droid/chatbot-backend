// scripts/test-profile-upload.js
//
// Verifies the two fixes we made to counsellor profile-photo upload:
//   1. multer + CloudinaryStorage actually uploads the file and sets
//      req.file.path / req.file.filename (NOT req.file.buffer).
//   2. The completeRegistration handler's new code path uses .path/.filename
//      to build userData.profilePhoto correctly.
//
// We do NOT call the real /complete-registration endpoint because that
// requires email + phone OTP verification flow which can't be automated
// without a real inbox. Instead we mount the same multer middleware on a
// throwaway Express app and inspect what it produces.
//
// Run with: node scripts/test-profile-upload.js
//
// Exits 0 on pass, 1 on any failure.

import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { uploadProfilePhoto } from "../src/middleware/multerConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_IMAGE = path.resolve(
  __dirname,
  "..",
  "src",
  "uploads",
  "profilePhoto-1774430266285-275749671.jpg",
);

const log = (ok, msg) => {
  const tag = ok ? "✅ PASS" : "❌ FAIL";
  console.log(`${tag}  ${msg}`);
  return ok;
};

const required = [
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
];
for (const v of required) {
  if (!process.env[v]) {
    console.error(`Missing env var ${v}. Aborting.`);
    process.exit(1);
  }
}

if (!fs.existsSync(TEST_IMAGE)) {
  console.error(`Test image not found at ${TEST_IMAGE}`);
  process.exit(1);
}

// Mini app that mounts only the middleware we want to test.
const app = express();
app.post("/__test-upload", uploadProfilePhoto, (req, res) => {
  // Mirror the EXACT logic that completeRegistration now uses.
  let savedPhoto = null;
  if (req.file && req.file.path) {
    savedPhoto = {
      url: req.file.path,
      publicId: req.file.filename,
    };
  }
  res.json({
    receivedFile: req.file
      ? {
          fieldname: req.file.fieldname,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          // CloudinaryStorage sets these — the old code looked for .buffer
          // (multer.memoryStorage) which never existed here.
          hasPath: typeof req.file.path === "string" && req.file.path.length > 0,
          hasFilename:
            typeof req.file.filename === "string" && req.file.filename.length > 0,
          hasBuffer: !!req.file.buffer,
          path: req.file.path,
          filename: req.file.filename,
        }
      : null,
    savedPhoto,
  });
});

const server = app.listen(0); // random free port
const { port } = server.address();
console.log(`\nTest server listening on http://localhost:${port}\n`);

// Build a multipart body by hand so we don't add another dependency.
function multipartUpload(filePath, fieldName, url) {
  return new Promise((resolve, reject) => {
    const boundary = `----nodetest${Date.now()}`;
    const fileBuf = fs.readFileSync(filePath);
    const head = Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${fieldName}"; filename="${path.basename(filePath)}"\r\n` +
        `Content-Type: image/jpeg\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([head, fileBuf, tail]);

    const u = new URL(url);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch (e) {
            reject(new Error(`Non-JSON response: ${data}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

let allOk = true;
try {
  console.log(`Uploading ${path.basename(TEST_IMAGE)} (${fs.statSync(TEST_IMAGE).size} bytes)…`);
  const { status, body } = await multipartUpload(
    TEST_IMAGE,
    "profilePhoto",
    `http://localhost:${port}/__test-upload`,
  );

  console.log("\nResponse:", JSON.stringify(body, null, 2), "\n");

  allOk &= log(status === 200, `HTTP 200 (got ${status})`);
  allOk &= log(!!body.receivedFile, "req.file is present after multer ran");

  if (body.receivedFile) {
    const f = body.receivedFile;
    allOk &= log(
      f.fieldname === "profilePhoto",
      `fieldname is "profilePhoto" (got "${f.fieldname}")`,
    );
    allOk &= log(
      f.hasPath,
      "req.file.path is set (Cloudinary secure URL) — this is the fix",
    );
    allOk &= log(
      f.hasFilename,
      "req.file.filename is set (Cloudinary public_id) — this is the fix",
    );
    allOk &= log(
      !f.hasBuffer,
      "req.file.buffer is NOT set (correct — CloudinaryStorage doesn't buffer)",
    );
    allOk &= log(
      typeof f.path === "string" && f.path.startsWith("https://res.cloudinary.com/"),
      `URL points to res.cloudinary.com (got: ${String(f.path).slice(0, 80)}…)`,
    );
  }

  allOk &= log(
    !!body.savedPhoto,
    "controller would build userData.profilePhoto",
  );
  if (body.savedPhoto) {
    allOk &= log(
      body.savedPhoto.url === body.receivedFile.path,
      "userData.profilePhoto.url === req.file.path",
    );
    allOk &= log(
      body.savedPhoto.publicId === body.receivedFile.filename,
      "userData.profilePhoto.publicId === req.file.filename",
    );
  }
} catch (err) {
  log(false, `Test threw: ${err.message}`);
  allOk = false;
} finally {
  server.close();
}

console.log("");
if (allOk) {
  console.log("🎉 All assertions passed. Profile photo upload fix is working.");
  process.exit(0);
} else {
  console.log("💥 Some assertions failed. See log above.");
  process.exit(1);
}
