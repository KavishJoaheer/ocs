import { test, expect } from "@playwright/test";

const STAFF = `http://127.0.0.1:${process.env.E2E_STAFF_PORT || "4173"}`;
const CARE = `http://127.0.0.1:${process.env.E2E_PATIENT_PORT || "4174"}`;

const androidPhones = [
  { name: "Samsung Internet", width: 360, ua: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36" },
  { name: "Huawei Browser", width: 360, ua: "Mozilla/5.0 (Linux; Android 10; HUAWEI P40 Pro) AppleWebKit/537.36 Chrome/99.0.0.0 HuaweiBrowser/15.0.0.301 Mobile Safari/537.36" },
  { name: "Chrome on Android", width: 412, ua: "Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36" },
];

for (const [name, origin, label] of [["staff", STAFF, "Username"], ["patient", CARE, "Email address"]]) {
  test(`${name} mobile sign-in fields stay readable through focus and blur and allow pinch zoom`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/login`);
    const field = page.getByLabel(label, { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    await expect(field).toBeVisible();
    const initialScale = await page.evaluate(() => window.visualViewport?.scale || 1);
    for (const [input, value] of [[field, name === "patient" ? "mobile@example.test" : "mobile.operator"], [password, "typing-test-only"]]) {
      expect(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      await input.fill(value);
      await expect(input).toHaveValue(value);
      await input.blur();
      expect(await page.evaluate(() => window.visualViewport?.scale || 1)).toBeCloseTo(initialScale, 2);
    }
    const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,\s]|$)/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const phone of androidPhones) {
  test.describe(phone.name, () => {
    test.use({ viewport: { width: phone.width, height: 800 }, userAgent: phone.ua, isMobile: true, hasTouch: true });
    for (const [name, origin, label] of [["staff", STAFF, "Username"], ["patient", CARE, "Email address"]]) {
      test(`${name} typing keeps the mobile viewport stable`, async ({ page, browserName }) => {
        test.skip(browserName !== "chromium", "Android profiles run in the Chromium engine.");
        await page.goto(`${origin}/login`);
        const input = page.getByLabel(label, { exact: true });
        const scale = await page.evaluate(() => visualViewport?.scale || 1);
        await input.fill(name === "patient" ? "android@example.test" : "android.operator");
        expect(await input.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
        await input.blur();
        expect(await page.evaluate(() => visualViewport?.scale || 1)).toBeCloseTo(scale, 2);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      });
    }
  });
}
