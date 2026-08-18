import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import serviceAccount from "./serviceAccountKey.json" with { type: "json" };

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}

export default getMessaging();
