const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const AUTH_TOKEN_KEY = "ocs_medecins_auth_token";

export function getStoredAuthToken() {
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredAuthToken(token) {
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

async function apiRequest(path, options = {}) {
  const authToken = getStoredAuthToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };

  if (!options.skipAuth && authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401 && authToken) {
      if (getStoredAuthToken() === authToken) {
        setStoredAuthToken(null);
      }

      window.dispatchEvent(
        new CustomEvent("auth:unauthorized", {
          detail: {
            token: authToken,
          },
        }),
      );
    }

    throw new Error(data?.error || "Something went wrong.");
  }

  return data;
}

export const api = {
  get: (path) => apiRequest(path),
  post: (path, body, options = {}) => apiRequest(path, { ...options, method: "POST", body }),
  put: (path, body, options = {}) => apiRequest(path, { ...options, method: "PUT", body }),
  patch: (path, body, options = {}) => apiRequest(path, { ...options, method: "PATCH", body }),
  delete: (path, options = {}) => apiRequest(path, { ...options, method: "DELETE" }),
};
