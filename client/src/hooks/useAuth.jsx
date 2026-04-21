import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getStoredAuthToken, setStoredAuthToken } from "../lib/api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredAuthToken());
  const [user, setUser] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);

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

  const value = useMemo(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(user && token),
      isBootstrapping,
      login,
      logout,
      updateUser,
    }),
    [isBootstrapping, login, logout, token, updateUser, user],
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
