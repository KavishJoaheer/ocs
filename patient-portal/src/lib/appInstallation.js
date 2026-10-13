export const INSTALL_DISMISSED_KEY = "ocs_care_install_dismissed_until";
export const INSTALL_CONFIRMED_KEY = "ocs_care_install_confirmed";
export const INSTALL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

export function getInstallEnvironment(navigator) {
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android|HarmonyOS/i.test(ua);
  const embedded = /FBAN|FBAV|Instagram|MicroMessenger|; wv\)|\bHuaweiWebView\b/i.test(ua);
  let browser = "other";
  if (ios) browser = "ios";
  else if (/SamsungBrowser/i.test(ua)) browser = "samsung";
  else if (/HuaweiBrowser|HUAWEIBrowser/i.test(ua)) browser = "huawei";
  else if (/EdgA?\//i.test(ua)) browser = "edge";
  else if (/Firefox\//i.test(ua)) browser = "firefox";
  else if (/Chrome\//i.test(ua)) browser = "chrome";
  return { browser, mobile: ios || android, embedded };
}

export function getInstallGuide(browser) {
  switch (browser) {
    case "ios":
      return {
        name: "iPhone or iPad",
        steps: [
          { icon: "share", title: "Open the Share menu", detail: "In Safari, tap Share (the square with an arrow). It may be inside the More menu." },
          { icon: "plus", title: "Choose Add to Home Screen", detail: "Scroll down the Share menu to find it." },
          { icon: "home", title: "Tap Add", detail: "Keep Open as Web App switched on, if shown. Look for OCS Care on your home screen." },
        ],
        note: "Using another browser? Open this page in Safari and follow these steps. You may need to sign in again when opening the new icon.",
      };
    case "samsung":
      return {
        name: "Samsung Internet",
        steps: [
          { icon: "menu", title: "Open the browser menu", detail: "Tap the three lines in Samsung Internet." },
          { icon: "plus", title: "Choose Add page to", detail: "Then choose Home screen or Apps screen, depending on your browser version." },
          { icon: "home", title: "Confirm Add or Install", detail: "Look for the OCS Care icon on your phone." },
        ],
        note: "Menu names can vary by browser version. If an install icon appears in the address bar, you can use that too.",
      };
    case "huawei":
      return {
        name: "Huawei Browser",
        steps: [
          { icon: "menu", title: "Open the browser menu", detail: "In Huawei Browser, open the menu for this page." },
          { icon: "plus", title: "Choose Add bookmark", detail: "Select Home screen as the destination. Some versions offer Add to home screen directly." },
          { icon: "home", title: "Confirm with the check mark or Add", detail: "Use the OCS Care icon on your home screen to return here." },
        ],
        note: "Huawei Browser may add a shortcut that opens in your browser. Options depend on your phone and browser version; Google Play is not needed for this shortcut.",
      };
    default:
      return {
        name: browser === "chrome" ? "Chrome" : browser === "edge" ? "Microsoft Edge" : browser === "firefox" ? "Firefox" : "Your browser",
        steps: [
          { icon: "menu", title: "Open the browser menu", detail: "Look for the three dots or the menu beside the address bar." },
          { icon: "plus", title: "Choose Install app or Add to Home screen", detail: "On a computer, look for the install icon in the address bar. Available options vary by browser." },
          { icon: "home", title: "Confirm Install or Add", detail: "Open OCS Care using the new icon. You may be asked to sign in again." },
        ],
        note: "If these options are missing, open this page in a supported browser. OCS Care remains available here without installation.",
      };
  }
}

let snapshot = { prompt: null, standalone: false, confirmed: false, dismissedUntil: 0 };
const listeners = new Set();
let started = false;

function readPreference(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function writePreference(key, value) {
  try { window.localStorage.setItem(key, String(value)); } catch { /* Session state still works. */ }
}

function update(values) {
  snapshot = { ...snapshot, ...values };
  listeners.forEach((listener) => listener());
}

function readDismissedUntil() {
  const value = Number(readPreference(INSTALL_DISMISSED_KEY));
  return Number.isFinite(value) && value > 0 ? Math.min(value, Date.now() + INSTALL_COOLDOWN_MS) : 0;
}

// Capture before React mounts so eligibility is retained across login and routes.
export function startAppInstallation() {
  if (started) return;
  started = true;
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const isStandalone = () => displayMode.matches || window.matchMedia("(display-mode: fullscreen)").matches || window.navigator.standalone === true;
  const syncDisplayMode = () => {
    const standalone = isStandalone();
    if (standalone) writePreference(INSTALL_CONFIRMED_KEY, "true");
    update({ standalone, confirmed: standalone || readPreference(INSTALL_CONFIRMED_KEY) === "true" });
  };
  syncDisplayMode();
  update({ dismissedUntil: readDismissedUntil() });
  if (displayMode.addEventListener) displayMode.addEventListener("change", syncDisplayMode);
  else displayMode.addListener?.(syncDisplayMode);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    // A fresh eligibility event also permits reinstallation after removal.
    writePreference(INSTALL_CONFIRMED_KEY, "false");
    update({ prompt: event, confirmed: false });
  });
  window.addEventListener("appinstalled", () => {
    writePreference(INSTALL_CONFIRMED_KEY, "true");
    update({ prompt: null, confirmed: true });
  });
  window.addEventListener("storage", () => {
    update({ dismissedUntil: readDismissedUntil() });
    syncDisplayMode();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncDisplayMode();
  });
}

export const getInstallationSnapshot = () => snapshot;
export function subscribeToInstallation(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissInstallation() {
  const dismissedUntil = Date.now() + INSTALL_COOLDOWN_MS;
  writePreference(INSTALL_DISMISSED_KEY, dismissedUntil);
  update({ dismissedUntil });
}

export async function promptInstallation() {
  const event = snapshot.prompt;
  if (!event) return "unavailable";
  update({ prompt: null });
  try {
    // Must be called directly from the patient's click, before any await.
    const result = await event.prompt();
    const choice = await (event.userChoice || result);
    dismissInstallation();
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "unavailable";
  }
}
