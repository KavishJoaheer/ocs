import { test, expect } from "@playwright/test";

test.use({
  baseURL: `http://127.0.0.1:${process.env.E2E_INSTALL_PORT || process.env.E2E_PATIENT_PORT || "4174"}`,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
  serviceWorkers: "block",
});

const DISMISSED_KEY = "ocs_care_install_dismissed_until";
const CONFIRMED_KEY = "ocs_care_install_confirmed";
const user = { id: 1, patient_id: 1, full_name: "Maya Patient", email: "maya@test.local", link_status: "verified" };
const invite = (page) => page.locator(".care-install-card:visible");
const guide = (page) => page.getByRole("dialog", { name: "Your care, one tap away." });

// Exercise the built portal with deterministic API responses; no patient data or backend writes.
async function mockPortal(page, options = {}) {
  let signedIn = options.signedIn ?? true;
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    let status = 200;
    if (path === "/api/patient-auth/me") {
      if (signedIn) json = { user };
      else { status = 401; json = { error: "Please sign in" }; }
    } else if (path === "/api/patient-auth/login" || path === "/api/patient-auth/register") {
      signedIn = true;
      json = { user };
    } else if (path === "/api/patient-portal/dashboard") {
      json = { patient: { id: 1 }, next_appointment: null, last_consultation: null };
    } else if (path === "/api/patient-portal/visit-requests/active") {
      if (options.waitForActive) await options.waitForActive;
      json = { visit_request: options.activeVisit || null, family_visit_requests: [] };
      if (options.activeError) { status = 503; json = { error: "Visit status unavailable" }; }
    } else if (path === "/api/patient-portal/dependents") {
      json = { dependents: [] };
    } else if (path === "/api/patient-portal/profile") {
      json = { profile: { ...user, phone: "57001122", gender: "F" } };
    }
    await route.fulfill({ status, json });
  });
}

async function emitInstallPrompt(page, { outcome = "accepted", throws = false } = {}) {
  await page.evaluate(({ outcome, throws }) => {
    const event = new Event("beforeinstallprompt", { cancelable: true });
    window.installPromptCalls = 0;
    event.prompt = () => {
      window.installPromptCalls += 1;
      if (throws) throw new Error("Installation unavailable");
      return Promise.resolve({ outcome });
    };
    event.userChoice = Promise.resolve({ outcome });
    window.dispatchEvent(event);
    window.installPromptWasDeferred = event.defaultPrevented;
  }, { outcome, throws });
}

const phones = [
  { name: "iPhone", width: 390, ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1", browser: "ios", step: "Open the Share menu" },
  { name: "Samsung Internet", width: 360, ua: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36", browser: "samsung", step: "Choose Add page to" },
  { name: "Huawei Browser", width: 360, ua: "Mozilla/5.0 (Linux; Android 10; HUAWEI P40 Pro) AppleWebKit/537.36 Chrome/99.0.0.0 HuaweiBrowser/15.0.0.301 Mobile Safari/537.36", browser: "huawei", step: "Choose Add bookmark" },
  { name: "Chrome on Samsung", width: 412, ua: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36", browser: "chrome", step: "Choose Install app or Add to Home screen" },
];

for (const phone of phones) {
  test.describe(phone.name, () => {
    test.use({ userAgent: phone.ua, viewport: { width: phone.width, height: 800 } });
    test("dashboard invitation opens the correct guide and fits the screen", async ({ page }, testInfo) => {
      await mockPortal(page);
      await page.goto("/dashboard");
      await expect(invite(page)).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Request a doctor", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true, animations: "disabled" });
      await invite(page).getByRole("button", { name: "Add to home screen" }).click();
      await expect(guide(page)).toBeVisible();
      await expect(guide(page).getByLabel("Instructions for")).toHaveValue(phone.browser);
      await expect(guide(page).getByRole("heading", { name: phone.step, exact: true })).toBeVisible();
      await expect(guide(page).getByRole("button", { name: "Got it", exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (phone.browser === "huawei") await expect(guide(page)).toContainText("may add a shortcut");
      await page.screenshot({ path: testInfo.outputPath("installation-guide.png"), animations: "disabled" });
    });
  });
}

test("landing and sign-in stay focused; successful sign-in reveals the invitation", async ({ page }) => {
  await mockPortal(page, { signedIn: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Step into a world of Care/i })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('.landing-primary-cta')).toHaveAttribute("href", "/register");
  await expect(page.getByRole("link", { name: "Call OCS · 52 52 22 34", exact: true })).toHaveAttribute("href", "tel:52522234");
  await expect(page.getByRole("link", { name: "Get care", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Add OCS Care to your phone", exact: true }).click();
  await expect(guide(page)).toBeVisible();
  await guide(page).getByRole("button", { name: "Close installation guide" }).click();
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(invite(page)).toHaveCount(0);
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in to OCS Care", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(invite(page)).toBeVisible();
});

test("dismissal survives reload, expires after seven days, and help remains in Profile", async ({ page }) => {
  await mockPortal(page);
  await page.goto("/dashboard");
  await invite(page).getByRole("button", { name: "Maybe later" }).click();
  const until = await page.evaluate(key => Number(localStorage.getItem(key)), DISMISSED_KEY);
  expect(until - Date.now()).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
  await page.reload();
  await expect(page.getByRole("button", { name: "Request a doctor", exact: true })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await page.getByRole("button", { name: /Add OCS Care to your phone/ }).click();
  await expect(guide(page)).toBeVisible();
  await guide(page).getByRole("button", { name: "Got it", exact: true }).click();
  await page.evaluate(key => localStorage.setItem(key, String(Date.now() - 1000)), DISMISSED_KEY);
  await page.goto("/dashboard");
  await expect(invite(page)).toBeVisible();
});

test("new account reaches the dashboard before the invitation appears", async ({ page }) => {
  await mockPortal(page, { signedIn: false });
  await page.goto("/register");
  await page.getByLabel("Full name", { exact: true }).fill(user.full_name);
  await expect(invite(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Email address", { exact: true }).fill(user.email);
  await page.getByLabel("Phone number", { exact: true }).fill("57001122");
  await page.getByLabel("National ID number").fill("B290493310239F");
  await page.getByLabel("Gender").selectOption("F");
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByLabel("Confirm password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Create Patient Account", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(invite(page)).toBeVisible();
});

test("sign-in preserves the patient's requested destination without an install interruption", async ({ page }) => {
  await mockPortal(page, { signedIn: false });
  await page.goto("/profile");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("test-password");
  await page.getByRole("button", { name: "Sign in to OCS Care", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("button", { name: /Add OCS Care to your phone/ })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await expect(guide(page)).toHaveCount(0);
});

test("failed visit status keeps care above installation", async ({ page }) => {
  await mockPortal(page, { activeError: true });
  await page.goto("/dashboard");
  await expect(page.getByText("Visit status unavailable")).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
});

test("standalone Android display mode hides installation promotion", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36" });
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const media = matchMedia(query);
      if (query === "(display-mode: standalone)") Object.defineProperty(media, "matches", { value: true });
      return media;
    };
  });
  await mockPortal(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Request a doctor", exact: true })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
});

test("unavailable preference storage does not break the guide or session dismissal", async ({ page }) => {
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key.startsWith("ocs_care_install_")) throw new Error("Storage blocked"); return getItem.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("ocs_care_install_")) throw new Error("Storage blocked"); return setItem.call(this, key, value); };
  });
  await mockPortal(page);
  await page.goto("/dashboard");
  await invite(page).getByRole("button", { name: "Add to home screen" }).click();
  await expect(guide(page)).toBeVisible();
  await guide(page).getByRole("button", { name: "Maybe later", exact: true }).click();
  await expect(invite(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Request a doctor", exact: true })).toBeVisible();
});

test("native installation requires a click and is consumed only once", async ({ page }) => {
  await mockPortal(page);
  await page.goto("/dashboard");
  await expect(invite(page)).toBeVisible();
  await emitInstallPrompt(page);
  expect(await page.evaluate(() => window.installPromptWasDeferred)).toBe(true);
  expect(await page.evaluate(() => window.installPromptCalls)).toBe(0);
  await invite(page).getByRole("button", { name: "Install OCS Care", exact: true }).click();
  expect(await page.evaluate(() => window.installPromptCalls)).toBe(1);
  await expect(invite(page)).toHaveCount(0);
  // Accepting a dialog alone is not reported as confirmed installation.
  expect(await page.evaluate(key => localStorage.getItem(key), CONFIRMED_KEY)).not.toBe("true");
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  expect(await page.evaluate(key => localStorage.getItem(key), CONFIRMED_KEY)).toBe("true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Request a doctor", exact: true })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
});

test("native dismissal waits before asking again; unavailable installation offers instructions", async ({ page }) => {
  await mockPortal(page);
  await page.goto("/dashboard");
  await expect(invite(page)).toBeVisible();
  await emitInstallPrompt(page, { outcome: "dismissed" });
  await invite(page).getByRole("button", { name: "Install OCS Care", exact: true }).click();
  await expect(invite(page)).toHaveCount(0);
  await page.evaluate(key => localStorage.removeItem(key), DISMISSED_KEY);
  await page.reload();
  await expect(invite(page)).toBeVisible();
  await emitInstallPrompt(page, { throws: true });
  await invite(page).getByRole("button", { name: "Install OCS Care", exact: true }).click();
  await expect(guide(page)).toBeVisible();
});

test("an installed iPhone app shows no installation promotion", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
  await mockPortal(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Request a doctor", exact: true })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page.getByText("You’re using the OCS Care app").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Add OCS Care to your phone/ })).toHaveCount(0);
});

test("invitation waits for visit status and stays hidden during an active visit", async ({ page }) => {
  let release;
  const waitForActive = new Promise(resolve => { release = resolve; });
  await mockPortal(page, { waitForActive, activeVisit: { id: 8, patient_id: 1, status: "en_route", doctor_name: "Test Doctor", status_label: "On the way" } });
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Request a doctor", exact: true })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  release();
  await expect(page.getByText("Dr. Test Doctor is on the way.").last()).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
});

test("requesting a doctor hides the invitation without blocking the request", async ({ page }) => {
  await mockPortal(page);
  await page.goto("/dashboard");
  await expect(invite(page)).toBeVisible();
  await page.getByRole("button", { name: "Request a doctor", exact: true }).click();
  await expect(page.locator(".request-doctor-sheet")).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await expect(guide(page)).toHaveCount(0);
});

test("small screens keep the guide usable, trap focus, and restore it on Escape", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockPortal(page);
  await page.goto("/dashboard");
  const trigger = invite(page).getByRole("button", { name: "Add to home screen" });
  await trigger.click();
  await expect(guide(page).getByRole("button", { name: "Got it", exact: true })).toBeInViewport();
  await expect(guide(page).getByRole("button", { name: "Close installation guide" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(guide(page).getByRole("button", { name: "Maybe later", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(guide(page)).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("embedded browsers explain how to open externally and copy a safe public link", async ({ page, context }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Linux; Android 14; SM-A546B; wv) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram" }));
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mockPortal(page);
  await page.goto("/dashboard?private=value");
  await invite(page).getByRole("button", { name: "Add to home screen" }).click();
  await expect(guide(page)).toContainText("Open this page in your phone’s browser first");
  await guide(page).getByRole("button", { name: "Copy OCS Care link" }).click();
  await expect(guide(page).getByRole("status")).toContainText("Link copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(new URL(copied).pathname).toBe("/");
  expect(new URL(copied).search).toBe("");
});

test("desktop has manual installation help without an automatic mobile invitation", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript(() => Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" }));
  await mockPortal(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Good .* Maya/i })).toBeVisible();
  await expect(invite(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Add OCS Care to your phone", exact: true }).click();
  await expect(guide(page)).toBeVisible();
});

test("installation metadata serves the OCS Care name and home-screen icons", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest.short_name).toBe("OCS Care");
  expect(manifest.display).toBe("standalone");
  expect(manifest.id).toBe("/");
  expect(manifest.start_url).toBe("/");
  for (const icon of manifest.icons) {
    const iconResponse = await request.get(icon.src);
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }
  await mockPortal(page, { signedIn: false });
  await page.goto("/login");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "OCS Care");
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/pwa-192.png");
});
