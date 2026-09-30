import { setOfflineOwner } from './offline-cache.mjs';
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

let services;
export async function getServices() {
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    throw new Error("Firebase is not configured yet. Complete firebase/config.js first.");
  }
  if (!services) {
    services = (async () => {
      const app = initializeApp(firebaseConfig);
      const auth = getAuth(app);
      await auth.authStateReady();
      setOfflineOwner(auth.currentUser?.isAnonymous ? null : auth.currentUser?.uid);
      onAuthStateChanged(auth, user => setOfflineOwner(user?.isAnonymous ? null : user?.uid));
      return { auth, db: getFirestore(app) };
    })();
  }
  return services;
}
