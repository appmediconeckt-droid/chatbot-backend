// import { cert, getApps, initializeApp } from "firebase-admin/app";
// import { getMessaging } from "firebase-admin/messaging";
// import serviceAccount from "./serviceAccountKey.json" with { type: "json" };

// if (getApps().length === 0) {
//   initializeApp({
//     credential: cert(serviceAccount),
//   });
// }

// export default getMessaging();
import admin from "firebase-admin";

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is missing");
}

const serviceAccount = JSON.parse(
  process.env.FIREBASE_SERVICE_ACCOUNT
);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

export default admin;