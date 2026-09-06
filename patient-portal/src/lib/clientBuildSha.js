const EMBEDDED =
  typeof __OCS_CLIENT_BUILD_SHA__ !== "undefined" ? String(__OCS_CLIENT_BUILD_SHA__ || "").trim() : "";

export const CLIENT_BUILD_SHA = EMBEDDED;

if (typeof window !== "undefined") {
  window.__OCS_CLIENT_BUILD_SHA__ = CLIENT_BUILD_SHA;
}
