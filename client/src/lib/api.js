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
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...(options.headers || {}),
  };

  if (!options.skipAuth && authToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body: options.body
      ? isFormData
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });

  if (response.status === 204) {
    return null;
  }

  if (options.responseType === "blob") {
    if (!response.ok) {
      const text = await response.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

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

    return {
      blob: await response.blob(),
      contentType: response.headers.get("content-type") || "",
      filename: response.headers.get("x-file-name") || "",
    };
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
  getBlob: (path, options = {}) => apiRequest(path, { ...options, responseType: "blob" }),
  post: (path, body, options = {}) => apiRequest(path, { ...options, method: "POST", body }),
  put: (path, body, options = {}) => apiRequest(path, { ...options, method: "PUT", body }),
  patch: (path, body, options = {}) => apiRequest(path, { ...options, method: "PATCH", body }),
  delete: (path, options = {}) => apiRequest(path, { ...options, method: "DELETE" }),
};
