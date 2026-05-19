import { test, expect, devices } from "@playwright/test";

// Override defaultBrowserType so this device emulation runs on chromium
// (only installed browser). The iPhone 13 preset defaults to webkit.
const { defaultBrowserType: _ignored, ...iphone13 } = devices["iPhone 13"];
const MOBILE = iphone13;
const SCREENSHOT_DIR = "screenshots/mobile-redesign";

test.use(MOBILE);

test.describe("Mobile feed — golden path", () => {
  test("homepage loads and feed renders product cards", async ({ page }) => {
    await page.goto("/");
    // App title is "Create Next App" (metadata not yet updated in layout.js)
    await expect(page).toHaveTitle(/create next app/i);
    await page.goto("/feed");
    await expect(page.locator("article, a[href^='/product']").first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-default.png`, fullPage: false });
  });

  test("floating action bar is visible while scrolling", async ({ page }) => {
    await page.goto("/feed");
    const bar = page.getByRole("button", { name: /^filters$/i });
    await expect(bar).toBeVisible();
    await page.mouse.wheel(0, 2000);
    await expect(bar).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-scrolled-bar.png` });
  });

  test("filter panel opens with drill-down navigation", async ({ page }) => {
    await page.goto("/feed");
    await page.getByRole("button", { name: /^filters$/i }).click();
    await expect(page.getByText("CATEGORY", { exact: true })).toBeVisible();
    await expect(page.getByText("STORE", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-root.png` });

    await page.getByText("CATEGORY", { exact: true }).click();
    // Use exact match to avoid strict mode violation with "Tops" and "TOPS"
    await expect(page.getByText("TOPS", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /back/i })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-category.png` });

    await page.getByText("TOPS", { exact: true }).click();
    await expect(page.getByText(/view all tops/i)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-tops-expanded.png` });

    await page.getByText("Tees").click();
    await page.getByRole("button", { name: /^apply/i }).click();
    await expect(page).toHaveURL(/category=tops_tees/);
  });

  test("sort panel opens full-screen and updates URL", async ({ page }) => {
    await page.goto("/feed");
    await page.getByRole("button", { name: /^sort$/i }).click();
    await expect(page.getByText("SORT BY")).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/sort-panel.png` });
    // SORT_OPTIONS: { value: "latest", label: "Newest" } → URL uses sort=latest (not sort=newest)
    await page.getByText("Newest").click();
    await expect(page).toHaveURL(/sort=latest/);
  });

  test("mobile nav drills into SHOP and back", async ({ page }) => {
    await page.goto("/feed");
    await page.getByRole("button", { name: /open menu/i }).click();
    await expect(page.getByText("SHOP", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/nav-root.png` });

    await page.getByText("SHOP", { exact: true }).click();
    // Use exact match to avoid strict mode violation with "Tops" vs "TOPS"
    await expect(page.getByText("TOPS", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/nav-shop.png` });

    await page.getByRole("button", { name: /back/i }).click();
    await expect(page.getByText("SHOP", { exact: true })).toBeVisible();
    await expect(page.getByText("STORES", { exact: true })).toBeVisible();
  });

  test("product card opens product page", async ({ page }) => {
    await page.goto("/feed");
    const firstCard = page.locator("a[href^='/product']").first();
    await firstCard.waitFor();
    const href = await firstCard.getAttribute("href");
    await firstCard.click();
    await expect(page).toHaveURL(new RegExp(href.replace(/[/?]/g, ".")));
    await page.screenshot({ path: `${SCREENSHOT_DIR}/product-page.png` });
  });

  test("back navigation restores scroll position", async ({ page }) => {
    await page.goto("/feed");
    // Wait for product cards to load
    await page.waitForSelector("a[href^='/product']");

    // Click a product card further down (nth 5); Playwright auto-scrolls to it,
    // which sets window.scrollY to the card's position. The feed's onClick handler
    // saves that scrollY to sessionStorage before navigating.
    const card = page.locator("a[href^='/product']").nth(5);
    await card.scrollIntoViewIfNeeded();
    const savedScrollY = await page.evaluate(() => window.scrollY);

    await card.click();
    await page.waitForURL(/\/product\//);
    await page.waitForLoadState("domcontentloaded");

    await page.goBack();
    await page.waitForLoadState("load");

    // Wait for scroll restore — FeedClient useLayoutEffect fires after products load
    // and reads sessionStorage to restore the position.
    await page.waitForFunction(
      (expected) => window.scrollY >= expected - 50,
      savedScrollY,
      { timeout: 8000 }
    );

    const afterY = await page.evaluate(() => window.scrollY);
    expect(Math.abs(afterY - savedScrollY)).toBeLessThan(150);
  });

  test("search handles multi-word queries and shows the sticky strip", async ({ page }) => {
    await page.goto("/feed?search=margiela%20tabi");
    await expect(page.getByText(/searching:/i)).toBeVisible();
    // Use .first() to avoid strict-mode violation when the query text appears in multiple elements
    await expect(page.getByText(/margiela tabi/i).first()).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-search-multiword.png` });

    // Clear search button has aria-label "Clear search {query}"
    await page.getByRole("button", { name: /clear search/i }).click();
    await expect(page).not.toHaveURL(/search=/);
  });

  test("brand filter shows only as dot badge and surfaces in Active row", async ({ page }) => {
    await page.goto("/feed?brand=Margiela");
    // The Brand chip is rendered inside a "hidden md:flex" div — invisible on mobile viewport.
    // Confirm the brand chip is not visible on mobile.
    await expect(page.locator("main > div.hidden").getByText(/brand:/i)).not.toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/feed-brand-active.png` });

    await page.getByRole("button", { name: /^filters$/i }).click();
    await expect(page.getByText("Active")).toBeVisible();
    // The filter panel shows a "Clear brand" button when a brand is active
    await expect(page.getByRole("button", { name: "Clear brand" })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/filter-root-brand-active.png` });
  });

  test("RESET inside filter panel clears category drafts", async ({ page }) => {
    await page.goto("/feed?category=tops_tees");
    await page.getByRole("button", { name: /^filters$/i }).click();
    // The CATEGORY button shows "· 1" count when a category filter is active
    // Use role-based selector to target the button containing "CATEGORY"
    await expect(page.getByRole("button", { name: /category/i }).filter({ hasText: "· 1" })).toBeVisible();
    await page.getByRole("button", { name: /reset/i }).click();
    // After reset, the count should be gone
    await expect(page.getByRole("button", { name: /category/i }).filter({ hasText: "· 1" })).toHaveCount(0);
  });

  test("RESET also clears the active brand row", async ({ page }) => {
    await page.goto("/feed?brand=Margiela&category=tops_tees");
    await page.getByRole("button", { name: /^filters$/i }).click();
    await expect(page.getByText("Active")).toBeVisible();
    // Filter panel shows a "Clear brand" button while brand is active in draft
    await expect(page.getByRole("button", { name: "Clear brand" })).toBeVisible();
    await page.getByRole("button", { name: /reset/i }).click();
    await expect(page.getByText("Active")).toHaveCount(0);
    // After reset, the Clear brand button disappears and category count resets
    await expect(page.getByRole("button", { name: "Clear brand" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /category/i }).filter({ hasText: "· 1" })).toHaveCount(0);
    // Before applying, URL should still have brand (draft resets, not yet committed to URL)
    await expect(page).toHaveURL(/brand=Margiela/);
    await page.getByRole("button", { name: /^apply/i }).click();
    await expect(page).not.toHaveURL(/brand=/);
    await expect(page).not.toHaveURL(/category=/);
  });

  test("body scroll locks while a panel is open", async ({ page }) => {
    await page.goto("/feed");
    const before = await page.evaluate(() => document.body.style.overflow);
    expect(before).not.toBe("hidden");
    await page.getByRole("button", { name: /^filters$/i }).click();
    const during = await page.evaluate(() => document.body.style.overflow);
    expect(during).toBe("hidden");
    await page.getByRole("button", { name: /close/i }).first().click();
  });
});

test.describe("Desktop is untouched", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop shows DesktopNav and the existing filter button", async ({ page }) => {
    await page.goto("/feed");
    // The desktop nav uses class "hidden md:flex" — target it specifically
    await expect(page.locator("nav.hidden.md\\:flex, nav:not(.md\\:hidden)").first()).toBeVisible();
    // Desktop DesktopFeedBar renders "Filters" (title case)
    await expect(page.getByRole("button", { name: /^filters/i })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/desktop-feed.png` });
  });
});
