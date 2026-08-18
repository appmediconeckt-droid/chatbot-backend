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

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
}

let serviceAccount;

try {
  serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT
  );
} catch (error) {
  console.error("❌ Invalid FIREBASE_SERVICE_ACCOUNT JSON");
  throw error;
}

const firebaseApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: cert(serviceAccount),
      });

const messaging = getMessaging(firebaseApp);

// Compatibility with existing code:
// admin.messaging().send(...)
const admin = {
  messaging: () => messaging,
};

console.log("✅ Firebase Admin initialized");

export { firebaseApp, messaging };
export default admin;