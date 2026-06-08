export class NetworkError extends Error {
  constructor(message = "Network connection unavailable.", cause) {
    super(message);
    this.name = "NetworkError";
    this.isNetworkError = true;
    this.cause = cause;
  }
}

export function isBrowserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isNetworkFailure(error) {
  if (isBrowserOffline()) {
    return true;
  }

  if (error?.isNetworkError) {
    return true;
  }

  if (error instanceof TypeError) {
    const message = String(error.message || "").toLowerCase();
    return (
      message.includes("failed to fetch") ||
      message.includes("networkerror") ||
      message.includes("load failed") ||
      message.includes("network request failed")
    );
  }

  return false;
}

export function toNetworkError(error) {
  if (error instanceof NetworkError) {
    return error;
  }

  if (isNetworkFailure(error)) {
    return new NetworkError("Network connection unavailable.", error);
  }

  return error;
}
