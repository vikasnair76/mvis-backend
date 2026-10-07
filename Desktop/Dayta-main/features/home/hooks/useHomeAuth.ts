import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../../../services/firebase";

/** Current uid plus whether Firebase has finished restoring the session. */
export function useHomeAuth() {
  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);
  const [authHydrated, setAuthHydrated] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setUid(user?.uid ?? null);
      setAuthHydrated(true);
    });
    return () => unsub();
  }, []);

  return { uid, authHydrated };
}
