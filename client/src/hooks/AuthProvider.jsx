import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api, getStoredAuthToken, setStoredAuthToken } from "../lib/api.js";
import { flushOfflineQueue, setOfflineQueueUserContext } from "../lib/inventoryOfflineSync.js";
import { clearOfflineMutationsForUser, countOfflineMutations } from "../lib/offlineQueue.js";
import {
  clearPatientOfflineCache,
  prefetchPatientOfflineDirectory,
} from "../lib/patientOfflineSync.js";
import { refreshPushSubscriptionOnLogin } from "../lib/pushNotifications.js";
import { AuthContext } from "./authContext.js";

const COOKIE_SESSION = "cookie-session";

export function AuthProvider({ children }) {
  // Always probe /me on first load: the real session token is intentionally
  // hidden in an HttpOnly cookie and cannot be read by React.
  const [token, setToken] = useState(() => getStoredAuthToken() || COOKIE_SESSION);
  const [user, setUser] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [hcmUnreadCount, setHcmUnreadCount] = useState(0);

  const logout = useCallback(async ({ remote = true } = {}) => {
    const activeToken = getStoredAuthToken();
    const departingUserId = user?.id ?? null;

    // A queued mutation is real stock and billing data captured offline, so try
    // to drain it while this session's token is still valid.
    let pendingOffline = 0;
    if (departingUserId != null) {
      try {
        pendingOffline = await countOfflineMutations({ userId: departingUserId });
        if (pendingOffline > 0) {
          await flushOfflineQueue({ silent: true });
          pendingOffline = await countOfflineMutations({ userId: departingUserId });
        }
      } catch {
        // An unreadable queue counts as pending so we never delete blindly.
        pendingOffline = 1;
      }
    }

    if (remote) {
      try {
        await api.post("/auth/logout", undefined, {
          headers: activeToken ? { Authorization: `Bearer ${activeToken}` } : {},
        });
      } catch {
        // Best effort cleanup only.
      }
    }

    setStoredAuthToken(null);
    setToken(null);
    setUser(null);
    setHcmUnreadCount(0);
    // Detach the offline queue from this user immediately so any subsequent
    // login on the same device starts with a clean scope. Entries stay scoped
    // to their own user id, so they can only ever replay for that user.
    setOfflineQueueUserContext(null);
    if (departingUserId != null && pendingOffline === 0) {
      try {
        await clearOfflineMutationsForUser(departingUserId);
      } catch {
        // Best effort cleanup only.
      }
    }
    if (pendingOffline > 0) {
      toast.error(
        `${pendingOffline} offline ${pendingOffline === 1 ? "update has" : "updates have"} not synced yet. They are kept on this device — sign back in here to finish syncing.`,
        { duration: 9000 },
      );
    }
    await clearPatientOfflineCache();
  }, [user?.id]);

  const login = useCallback(async ({ username, password }) => {
    const payload = await api.post(
      "/auth/login",
      { username, password },
      { skipAuth: true },
    );

    setStoredAuthToken(null);
    setToken(COOKIE_SESSION);
    setUser(payload.user);
    setOfflineQueueUserContext(payload.user?.id ?? null);

    if (payload.user?.role === "doctor") {
      void prefetchPatientOfflineDirectory(payload.user.id);
    }

    void refreshPushSubscriptionOnLogin(payload.user?.role);

    return payload.user;
  }, []);

  const updateUser = useCallback((updater) => {
    setUser((current) => {
      if (!current) {
        return current;
      }

      return typeof updater === "function" ? updater(current) : updater;
    });
  }, []);

  const refreshHcmUnreadCount = useCallback(async ({ silent = false } = {}) => {
    if (!token || !user || user.role === "admin") {
      setHcmUnreadCount(0);
      return 0;
    }

    try {
      const payload = await api.get("/hcm-news/unread-status");
      const nextCount = Number(payload?.unread_count || 0);

      setHcmUnreadCount((current) => {
        if (!silent && nextCount > current) {
          toast("New HCM update available.");
        }

        return nextCount;
      });

      return nextCount;
    } catch {
      return 0;
    }
  }, [token, user]);

  useEffect(() => {
    const handleUnauthorized = () => {
      logout({ remote: false });
    };

    window.addEventListener("auth:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("auth:unauthorized", handleUnauthorized);
  }, [logout]);

  useEffect(() => {
    if (user?.role !== "doctor" || !user?.id) {
      return undefined;
    }

    // Refill the encrypted patient cache the moment connectivity returns so
    // the doctor walking back into a clinic Wi-Fi area is always covered.
    const handleOnline = () => {
      void prefetchPatientOfflineDirectory(user.id, { force: true });
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [user?.id, user?.role]);

  useEffect(() => {
    let ignore = false;

    async function restoreSession() {
      if (!token) {
        if (!ignore) {
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const payload = await api.get("/auth/me");
        if (!ignore) {
          setStoredAuthToken(null);
          setToken(COOKIE_SESSION);
          setUser(payload.user);
          setOfflineQueueUserContext(payload.user?.id ?? null);
          if (payload.user?.role === "doctor") {
            void prefetchPatientOfflineDirectory(payload.user.id);
          }
          void refreshPushSubscriptionOnLogin(payload.user?.role);
        }
      } catch {
        if (!ignore) {
          setStoredAuthToken(null);
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!ignore) {
          setIsBootstrapping(false);
        }
      }
    }

    restoreSession();

    return () => {
      ignore = true;
    };
  }, [token]);

  useEffect(() => {
    let ignore = false;

    async function bootstrapUnread() {
      if (!token || !user || user.role === "admin") {
        if (!ignore) {
          setHcmUnreadCount(0);
        }
        return;
      }

      await refreshHcmUnreadCount({ silent: true });
    }

    bootstrapUnread();

    if (!token || !user || user.role === "admin") {
      return () => {
        ignore = true;
      };
    }

    const intervalId = window.setInterval(() => {
      if (!ignore) {
        refreshHcmUnreadCount();
      }
    }, 30000);

    return () => {
      ignore = true;
      window.clearInterval(intervalId);
    };
  }, [refreshHcmUnreadCount, token, user]);

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && token),
      isBootstrapping,
      hcmUnreadCount,
      login,
      logout,
      refreshHcmUnreadCount,
      updateUser,
    }),
    [hcmUnreadCount, isBootstrapping, login, logout, refreshHcmUnreadCount, token, updateUser, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
