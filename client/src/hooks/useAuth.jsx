import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api, getStoredAuthToken, setStoredAuthToken } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredAuthToken());
  const [user, setUser] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [hcmUnreadCount, setHcmUnreadCount] = useState(0);

  const logout = useCallback(async ({ remote = true } = {}) => {
    const activeToken = getStoredAuthToken();

    if (remote && activeToken) {
      try {
        await api.post("/auth/logout", undefined, {
          headers: {
            Authorization: `Bearer ${activeToken}`,
          },
        });
      } catch {
        // Best effort cleanup only.
      }
    }

    setStoredAuthToken(null);
    setToken(null);
    setUser(null);
    setHcmUnreadCount(0);
  }, []);

  const login = useCallback(async ({ username, password }) => {
    const payload = await api.post(
      "/auth/login",
      { username, password },
      { skipAuth: true },
    );

    setStoredAuthToken(payload.token);
    setToken(payload.token);
    setUser(payload.user);

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
    const activeToken = getStoredAuthToken();

    if (!activeToken || !user || user.role === "admin") {
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
  }, [user]);

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
        if (!ignore) {
          setIsBootstrapping(false);
        }
        return;
      }

      try {
        const payload = await api.get("/auth/me");
        if (!ignore) {
          setUser(payload.user);
        }
      } catch {
        if (!ignore && getStoredAuthToken() === restoringToken) {
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

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
