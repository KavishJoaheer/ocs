import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import FutureSignInDialog from "../components/auth/FutureSignInDialog.jsx";
import { api, getStoredAuthToken, setStoredAuthToken, setActingPatientId } from "../lib/api.js";
import { PATIENT_DATA_EVENT, startPatientRealtime, stopPatientRealtime } from "../lib/realtime.js";
import { syncPushSubscriptionIfGranted } from "../lib/pushNotifications.js";

const AuthContext = createContext(null);
const COOKIE_SESSION = "cookie-session";

export function AuthProvider({ children }) {
  const [signOutPatientId, setSignOutPatientId] = useState(null);
  const [signOutState, setSignOutState] = useState(null);
  const [token, setToken] = useState(() => getStoredAuthToken() || COOKIE_SESSION);
  const [user, setUser] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const logout = useCallback(async ({ remote = true, redirectState } = {}) => {
    const activeToken = getStoredAuthToken();

    if (remote) {
      try {
        await api.post("/patient-auth/logout", undefined, {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }

    if (redirectState) setSignOutState(redirectState);
    setStoredAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const closeSignOutPrompt = useCallback(() => setSignOutPatientId(null), []);
  const requestLogout = useCallback(async () => {
    if (user?.has_password === false) {
      setSignOutPatientId(user.id);
      return;
    }
    try { await logout({ redirectState: { signedOut: true } }); }
    catch (error) { toast.error(error.message || "Could not sign out. Please try again."); }
  }, [user, logout]);
  const skipFutureSignIn = useCallback(async () => {
    await logout({ redirectState: { magicLinkRequired: true } });
    setSignOutPatientId(null);
  }, [logout]);
  const setupFutureSignIn = useCallback(async (form) => {
    const result = await api.post("/patient-auth/setup-future-sign-in", form);
    await logout({ remote: false, redirectState: { setupComplete: true, email: result.email } });
    setSignOutPatientId(null);
  }, [logout]);

  const login = useCallback(async ({ email, password }) => {
    const payload = await api.post(
      "/patient-auth/login",
      { email, password },
      { skipAuth: true },
    );

    setStoredAuthToken(null);
    setActingPatientId(null);
    setToken(COOKIE_SESSION);
    setUser(payload.user);
    setSignOutState(null);
    void syncPushSubscriptionIfGranted();

    return payload.user;
  }, []);

  const redeemMagicLink = useCallback(async (tokenValue) => {
    const payload = await api.post("/patient-auth/magic-link/redeem", { token: tokenValue }, { skipAuth: true });
    setStoredAuthToken(null);
    setActingPatientId(null);
    setToken(COOKIE_SESSION);
    setUser(payload.user);
    setSignOutState(null);
    void syncPushSubscriptionIfGranted();
    return payload.user;
  }, []);

  const register = useCallback(async ({ email, password, full_name, phone, national_id, gender }) => {
    const payload = await api.post(
      "/patient-auth/register",
      { email, password, full_name, phone, national_id, gender },
      { skipAuth: true },
    );

    setStoredAuthToken(null);
    setActingPatientId(null);
    setToken(COOKIE_SESSION);
    setUser(payload.user);
    setSignOutState(null);
    void syncPushSubscriptionIfGranted();

    return payload.user;
  }, []);

  const updateUser = useCallback((updater) => {
    setUser((current) => {
      if (!current) return current;
      return typeof updater === "function" ? updater(current) : updater;
    });
  }, []);

  const changePassword = useCallback(async ({ current_password, new_password }) => {
    await api.post("/patient-auth/change-password", { current_password, new_password });
  }, []);

  useEffect(() => {
    const handleUnauthorized = () => {
      logout({ remote: false });
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, [logout]);

  useEffect(() => {
    let ignore = false;

    async function restoreSession() {
      if (!token) {
        if (!ignore) setIsBootstrapping(false);
        return;
      }

      try {
        const payload = await api.get("/patient-auth/me");
        if (!ignore) {
          setStoredAuthToken(null);
          setToken(COOKIE_SESSION);
          setUser(payload.user);
        }
      } catch {
        if (!ignore) {
          setStoredAuthToken(null);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!ignore) setIsBootstrapping(false);
      }
    }

    restoreSession();
    return () => { ignore = true; };
  }, [token]);

  // Keep the realtime stream tied to the session lifecycle so the patient's
  // dashboard/records refresh live when staff or the insurer make changes.
  const sessionUserId = user?.id;
  useEffect(() => {
    if (token && sessionUserId) {
      startPatientRealtime();
    } else {
      stopPatientRealtime();
    }

    return () => stopPatientRealtime();
  }, [token, sessionUserId]);

  // Refresh the session user when staff links or updates the patient record so
  // link banners and visit-request guards clear without a manual re-login.
  useEffect(() => {
    if (!token) {
      return undefined;
    }

    let ignore = false;

    async function refreshSessionUser() {
      try {
        const payload = await api.get("/patient-auth/me");
        if (!ignore) {
          setUser(payload.user);
        }
      } catch {
        // Non-blocking — page-level live refresh still applies.
      }
    }

    window.addEventListener(PATIENT_DATA_EVENT, refreshSessionUser);
    return () => {
      ignore = true;
      window.removeEventListener(PATIENT_DATA_EVENT, refreshSessionUser);
    };
  }, [token]);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && token),
      isBootstrapping,
      login,
      register,
      redeemMagicLink,
      logout,
      requestLogout,
      signOutState,
      changePassword,
      updateUser,
    }),
    [isBootstrapping, login, register, redeemMagicLink, logout, requestLogout, signOutState, changePassword, token, updateUser, user],
  );

  return <AuthContext.Provider value={value}>
    {children}
    {user && signOutPatientId === user.id && <FutureSignInDialog onSetup={setupFutureSignIn} onSkip={skipFutureSignIn} onClose={closeSignOutPrompt} />}
  </AuthContext.Provider>;
}

export function usePatientAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("usePatientAuth must be used within an AuthProvider.");
  }

  return context;
}
