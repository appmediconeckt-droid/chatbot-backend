import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

// Read-only inventory. Never import the app, Mongoose models, connectDB,
// workers or migration modules: those can have startup write side effects.
const productionRead = process.argv.includes("--read-only-production-inventory");
let uri = process.env.HUMAELI_INVENTORY_MONGO_URI || "";
if (!uri && productionRead) uri = dotenv.parse(await readFile(".env", "utf8")).MONGO_URI || "";
if (!uri) throw new Error("An explicitly selected inventory database is required");
if (!productionRead && !/^mongodb:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(uri)) throw new Error("Remote inventory requires explicit read-only mode");

const selections = [
  ["messages", "consultationAttachments", "$attachmentUrl"],
  ["users", "professionalCertificates", "$certifications.documentUrl", "$certifications"],
  ["users", "professionalSignatures", "$prescriptionSignature.url"],
  ["users", "professionalSeals", "$prescriptionSeal.url"],
  ["prescriptions", "prescriptionPDFs", "$pdf.url"],
  ["prescriptions", "prescriptionSignatureSnapshots", "$psychiatristSnapshot.prescriptionSignature"],
  ["prescriptions", "prescriptionSealSnapshots", "$psychiatristSnapshot.prescriptionSeal"],
  ["calls", "callRecordings", "$recordingUrl"],
];
const client = new MongoClient(uri, { monitorCommands: true, serverSelectionTimeoutMS: 10000, maxPoolSize: 1, readPreference: "secondaryPreferred" });
const commands = new Set(); client.on("commandStarted", event => commands.add(event.commandName));
try {
  await client.connect(); const db = client.db(); const categories = {};
  for (const [collection, label, field, unwind] of selections) {
    const pipeline = unwind ? [{ $unwind: { path: unwind, preserveNullAndEmptyArrays: false } }] : [];
    pipeline.push({ $project: { _id: 0, url: { $cond: [{ $eq: [{ $type: field }, "string"] }, field, ""] } } }, { $match: { url: { $ne: "" } } },
      { $group: { _id: { $switch: { branches: [
        { case: { $regexMatch: { input: "$url", regex: "^https?://res\\.cloudinary\\.com/[^/]+/(?:image|video|raw)/upload/", options: "i" } }, then: "cloudinaryPublicUploadURL" },
        { case: { $regexMatch: { input: "$url", regex: "^https?://res\\.cloudinary\\.com/[^/]+/(?:image|video|raw)/(?:private|authenticated)/", options: "i" } }, then: "cloudinaryRestrictedTypeURL" },
        { case: { $regexMatch: { input: "$url", regex: "(?:^|/)api/private-files/" } }, then: "privateApiReference" },
        { case: { $regexMatch: { input: "$url", regex: "/uploads/" } }, then: "legacyLocalUploadReference" },
        { case: { $regexMatch: { input: "$url", regex: "^data:", options: "i" } }, then: "inlineDataReference" },
      ], default: "otherReferenceNeedsClassification" } }, references: { $sum: 1 } } });
    const rows = await db.collection(collection).aggregate(pipeline, { maxTimeMS: 15000 }).toArray();
    categories[label] = Object.fromEntries(rows.map(row => [row._id, row.references]));
  }
  console.log(JSON.stringify({ mode: "read-only-counts", target: productionRead ? "configured-shared-database" : "explicit-local-database", categories, applicationWriteCommands: [...commands].filter(name => ["insert", "update", "delete", "findAndModify", "createIndexes", "dropIndexes", "drop", "dropDatabase", "create"].includes(name)).length,
    observedCommandNames: [...commands].sort(), limitations: ["Counts are references, not unique assets", "URL syntax is not proof of current public accessibility or ownership", "No files downloaded, provider permission checked or asset migrated", "Reads across categories are not one atomic snapshot", "Directory profile photos deliberately excluded"] }, null, 2));
} catch (error) {
  // Driver errors can contain hosts or credential-bearing URI fragments.
  console.error(JSON.stringify({ status: "INVENTORY_UNAVAILABLE", errorType: /^[A-Za-z]+$/.test(error.name || "") ? error.name : "DatabaseError" }));
  process.exitCode = 1;
} finally { await client.close(); }
