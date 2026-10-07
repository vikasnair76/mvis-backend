import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  type User,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../../services/firebase";
import { GOOGLE_WEB_CLIENT_ID } from "../../../services/googleSignInConfig";

/**
 * The Calendar scope is requested at sign-in so `connectGoogleCalendar` can
 * reuse the same session. `services/googleSignInConfig.configureGoogleSignIn`
 * does NOT request it, which is why the configure call lives here.
 */
const GOOGLE_SIGN_IN_SCOPES = ["https://www.googleapis.com/auth/calendar"];

let configured = false;

function ensureConfigured() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    scopes: GOOGLE_SIGN_IN_SCOPES,
    offlineAccess: false,
    forceCodeForRefreshToken: false,
  });
  configured = true;
}

async function saveSignedInUserProfile(user: User) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      email: user.email ?? null,
      name: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      lastLoginAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      subscriptionTier: "free",
    },
    { merge: true }
  );
}

/** Google → Firebase sign-in, profile upsert, and sign-out. */
export function useGoogleSignIn() {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    ensureConfigured();
  }, []);

  const signIn = useCallback(async () => {
    if (busy) return;

    try {
      setBusy(true);

      await GoogleSignin.hasPlayServices();
      const result = await GoogleSignin.signIn();
      const idToken = result.data?.idToken ?? null;

      if (!idToken) {
        Alert.alert("Sign-in failed", "No idToken returned from Google.");
        return;
      }

      const credential = GoogleAuthProvider.credential(idToken);
      const { user } = await signInWithCredential(auth, credential);

      await saveSignedInUserProfile(user);

      Alert.alert("Signed in", `Welcome, ${user.displayName ?? "friend"}!`);
    } catch (e: any) {
      console.error("[Settings] Google sign-in failed", e);
      Alert.alert("Sign-in failed", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const logOut = useCallback(async () => {
    try {
      await GoogleSignin.signOut();
    } catch (e) {
      console.log("[Settings] Google signOut skipped:", e);
    }

    await signOut(auth);
    Alert.alert("Logged out");
  }, []);

  return { busy, signIn, logOut };
}
