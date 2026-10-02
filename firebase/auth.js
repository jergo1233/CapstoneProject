import { clearOfflinePrivate, configureOfflinePersistence } from './offline-cache.mjs';
import { getServices } from "./client.js";
import { signInWithEmailAndPassword, signOut, setPersistence, browserSessionPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

export async function getRoleProfile(user, role) {
  if (!user) return null;
  const { db } = await getServices();
  const profile = await getDoc(doc(db, role === "Admin" ? "admins" : "residents", user.uid));
  return profile.exists() && profile.data().role === role && (role !== 'Admin' || profile.data().active !== false) ? profile.data() : null;
}
export async function hasRole(user, role) {
  return Boolean(await getRoleProfile(user, role));
}
export async function login(email, password, role, remember = false) {
  const { auth } = await getServices();
  await setPersistence(auth, browserSessionPersistence);
  clearOfflinePrivate();
  const { user } = await signInWithEmailAndPassword(auth, email.trim(), password);
  try {
    if (!await hasRole(user, role)) throw new Error(`This account has no ${role.toLowerCase()} profile. Contact the project administrator.`);
    if (role === 'Resident' && remember) {
      await setPersistence(auth, browserLocalPersistence);
      configureOfflinePersistence(user.uid, true);
    } else {
      configureOfflinePersistence(user.uid, false);
    }
  } catch (error) {
    clearOfflinePrivate();
    await signOut(auth);
    throw error;
  }
}
export async function logout() {
  const { auth } = await getServices();
  await signOut(auth);
  clearOfflinePrivate();
}
export function authMessage(error) {
  if (error.code === "auth/email-already-in-use") return "This email is already registered. Sign in instead.";
  if (error.code === "auth/weak-password") return "Please choose a stronger password.";
  if (error.code === "auth/network-request-failed") return "Connection failed. Check your internet connection and try again.";
  if (error.code === "auth/too-many-requests") return "Too many attempts. Please try again later.";
  if (error.code?.startsWith("auth/")) return "Unable to sign in. Check your email and password, or contact the project administrator.";
  if (error.code) return "Unable to access your account profile. Check the Firebase setup and permissions.";
  return error.message;
}
