import { GoogleSignin } from "@react-native-google-signin/google-signin";
//import { configureGoogleSignIn } from "./googleSignInConfig";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
];

let googleCalendarConfigured = false;

function ensureGoogleCalendarConfigured() {
  if (googleCalendarConfigured) return;

  GoogleSignin.configure({
    scopes: CALENDAR_SCOPES,
    webClientId: "YOUR_WEB_CLIENT_ID_HERE",
    offlineAccess: true,
  });

  googleCalendarConfigured = true;
}

let addCalendarScopesPromise: Promise<unknown> | null = null;

/** async function safelyAddCalendarScopes() {
  //configureGoogleSignIn();
  ensureGoogleCalendarConfigured();

  if (addCalendarScopesPromise) {
    await addCalendarScopesPromise;
    return;
  }

  addCalendarScopesPromise = GoogleSignin.addScopes({
    scopes: CALENDAR_SCOPES,
  });

  try {
    await addCalendarScopesPromise;
  } finally {
    addCalendarScopesPromise = null;
  }
} **/

export async function connectGoogleCalendar() {
  const currentUser = GoogleSignin.getCurrentUser();

  if (!currentUser) {
    throw new Error("No Google user is signed in.");
  }

  const tokens = await GoogleSignin.getTokens();

  if (!tokens.accessToken) {
    throw new Error("No access token returned from Google.");
  }

  return tokens.accessToken;
}