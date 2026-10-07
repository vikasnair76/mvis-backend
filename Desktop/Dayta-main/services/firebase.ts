import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
import * as firebaseAuth from "firebase/auth";
import {
  browserLocalPersistence,
  getAuth,
  initializeAuth,
  setPersistence,
  type Persistence,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { Platform } from "react-native";

const getReactNativePersistence = (
  firebaseAuth as unknown as {
    getReactNativePersistence: (
      storage: typeof AsyncStorage
    ) => Persistence;
  }
).getReactNativePersistence;

const firebaseConfig = {
  apiKey: "AIzaSyCiVTaic487ufU66Asurub2JEOP5mCGrEE",
  authDomain: "dayta---goalsettingapp.firebaseapp.com",
  projectId: "dayta---goalsettingapp",
  storageBucket: "dayta---goalsettingapp.firebasestorage.app",
  messagingSenderId: "110225211882",
  appId: "1:110225211882:web:921806d5c49607c776f293",
  measurementId: "G-HQM70BGR7W",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const authInstance =
  Platform.OS === "web"
    ? getAuth(app)
    : (() => {
        try {
          return initializeAuth(app, {
            persistence: getReactNativePersistence(AsyncStorage),
          });
        } catch {
          return getAuth(app);
        }
      })();

export const auth = authInstance;
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

// Only set browser persistence on actual web.
if (Platform.OS === "web") {
  setPersistence(auth, browserLocalPersistence).catch((e) =>
    console.error("Auth persistence error:", e)
  );
}
