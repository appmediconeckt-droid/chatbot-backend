// import { cert, getApps, initializeApp } from "firebase-admin/app";
// import { getMessaging } from "firebase-admin/messaging";
// import serviceAccount from "./serviceAccountKey.json" with { type: "json" };

// if (getApps().length === 0) {
//   initializeApp({
//     credential: cert(serviceAccount),
//   });
// }

// export default getMessaging();


import {
  initializeApp,
  cert,
  getApps,
} from "firebase-admin/app";

import { getMessaging } from "firebase-admin/messaging";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;

// Railway / Production
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );

    console.log("✅ Firebase credentials loaded from ENV");
  } catch (error) {
    console.error("❌ Invalid FIREBASE_SERVICE_ACCOUNT JSON");
    throw error;
  }
}

// Local development
else {
  const serviceAccountPath = path.join(
    __dirname,
    "serviceAccountKey.json"
  );

  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(
      "Firebase service account not found in ENV or serviceAccountKey.json"
    );
  }

  serviceAccount = JSON.parse(
    fs.readFileSync(serviceAccountPath, "utf8")
  );

  console.log("✅ Firebase credentials loaded from local JSON");
}

const firebaseApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount),
      });

const messaging = getMessaging(firebaseApp);

const admin = {
  messaging: () => messaging,
};

console.log("✅ Firebase Admin initialized");

export { firebaseApp, messaging };
export default admin;

// import {
//   initializeApp,
//   cert,
//   getApps,
// } from "firebase-admin/app";

// import { getMessaging } from "firebase-admin/messaging";

// if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
//   throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
// }

// let serviceAccount;

// try {
//   serviceAccount = JSON.parse(
//     process.env.FIREBASE_SERVICE_ACCOUNT
//   );
// } catch (error) {
//   console.error("❌ Invalid FIREBASE_SERVICE_ACCOUNT JSON");
//   throw error;
// }

// const firebaseApp =
//   getApps().length > 0
//     ? getApps()[0]
//     : initializeApp({
//         credential: cert(serviceAccount),
//       });

// const messaging = getMessaging(firebaseApp);

// // Compatibility with existing code:
// // admin.messaging().send(...)
// const admin = {
//   messaging: () => messaging,
// };

// console.log("✅ Firebase Admin initialized");

// export { firebaseApp, messaging };
// export default admin;