import { GoogleSignin } from "@react-native-google-signin/google-signin";

export const GOOGLE_WEB_CLIENT_ID =
  "110225211882-f22f4m1qfrqg8v32eroeuunmogu7ttdo.apps.googleusercontent.com";

let configured = false;

export function configureGoogleSignIn() {
  if (configured) return;

  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    offlineAccess: false,
    forceCodeForRefreshToken: false,
  });

  configured = true;
}