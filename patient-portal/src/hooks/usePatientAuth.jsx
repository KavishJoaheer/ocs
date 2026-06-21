import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api, getStoredAuthToken, setStoredAuthToken } from "../lib/api.js";
import { PATIENT_DATA_EVENT, startPatientRealtime, stopPatientRealtime } from "../lib/realtime.js";
import { syncPushSubscriptionIfGranted } from "../lib/pushNotifications.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredAuthToken());
  const [user, setUser] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

  const logout = useCallback(async ({ remote = true } = {}) => {
    const activeToken = getStoredAuthToken();

    if (remote && activeToken) {
      try {
        await api.post("/patient-auth/logout", undefined, {
          headers: { Authorization: `Bearer ${activeToken}` },
        });
      } catch {
        // Best effort cleanup only.
      }
    }

    setStoredAuthToken(null);
    setToken(null);
    setUser(null);
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const payload = await api.post(
      "/patient-auth/login",
      { email, password },
      { skipAuth: true },
    );

    setStoredAuthToken(payload.token);
    setToken(payload.token);
    setUser(payload.user);
    void syncPushSubscriptionIfGranted();

    return payload.user;
  }, []);

  const register = useCallback(async ({ email, password, full_name, phone, national_id }) => {
    const payload = await api.post(
      "/patient-auth/register",
      { email, password, full_name, phone, national_id },
      { skipAuth: true },
    );

    setStoredAuthToken(payload.token);
    setToken(payload.token);
    setUser(payload.user);
    void syncPushSubscriptionIfGranted();

    return payload.user;
  }, []);

  const updateUser = useCallback((updater) => {
    setUser((current) => {
      if (!current) return current;
      return typeof updater === "function" ? updater(current) : updater;
    });
  }, []);

  useEffect(() => {
    const handleUnauthorized = (event) => {
      const invalidToken = event.detail?.token;
      const activeToken = getStoredAuthToken();

      if (invalidToken && activeToken && invalidToken !== activeToken) {
        return;
      }

      logout({ remote: false });
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, [logout]);

  useEffect(() => {
    let ignore = false;

    async function restoreSession() {
      const restoringToken = token;

      if (!token) {
        if (!ignore) setIsBootstrapping(false);
        return;
      }

      try {
        const payload = await api.get("/patient-auth/me");
        if (!ignore) setUser(payload.user);
      } catch {
        if (!ignore && getStoredAuthToken() === restoringToken) {
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
  useEffect(() => {
    if (token && user) {
      startPatientRealtime();
    } else {
      stopPatientRealtime();
    }

    return () => stopPatientRealtime();
  }, [token, user]);

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
      logout,
      updateUser,
    }),
    [isBootstrapping, login, register, logout, token, updateUser, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function usePatientAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("usePatientAuth must be used within an AuthProvider.");
  }

  return context;
}
