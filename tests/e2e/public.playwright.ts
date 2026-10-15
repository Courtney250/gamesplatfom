import { expect, test } from "@playwright/test";

const publicRoutes = [
  "/", "/games", "/games/chess", "/games/checkers", "/how-it-works", "/faq", "/support",
  "/terms", "/privacy", "/wallet-policy", "/fair-play", "/responsible-play", "/login",
  "/register", "/reset-password", "/verify-email",
];

function routeIsDeclared(pathname: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(`^${pattern.replace(/:[^/]+/g, "[^/]+")}$`).test(pathname));
}

test("the route manifest is valid JSON and declares the live page routes", async ({ request }) => {
  const response = await request.get("/manus-routes.json");
  expect(response.status()).toBe(200);
  const manifest: { routes: { path: string; title?: string }[] } = await response.json();
  const paths = manifest.routes.map((route) => route.path);
  expect(new Set(paths).size).toBe(paths.length);
  for (const path of ["/", "/games/:slug", "/fair-play", "/responsible-play", "/dashboard", "/matches/:matchId", "/admin/finance"]) {
    expect(paths).toContain(path);
  }
  for (const path of publicRoutes) expect(routeIsDeclared(path, paths)).toBe(true);
});

test("every public page renders on a 375px viewport without horizontal overflow", async ({ page }) => {
  for (const route of publicRoutes) {
    const response = await page.goto(route);
    expect(response?.status(), `${route} should return a page`).toBe(200);
    await expect(page.locator("#root")).not.toBeEmpty();
    await expect(page.locator("h1").first()).toBeVisible();
    const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(width.document, `${route} overflows the ${width.viewport}px viewport`).toBeLessThanOrEqual(width.viewport);
  }
});

test("unknown routes return HTTP 404 while protecting the admin tree", async ({ page }) => {
  const publicResponse = await page.goto("/not-a-real-page");
  expect(publicResponse?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page isn’t on the board." })).toBeVisible();

  const adminResponse = await page.goto("/admin/not-a-real-page");
  expect(adminResponse?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Welcome back." })).toBeVisible();
});

test("cinematic home hero, playable game previews, and mobile menu work", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.locator("#arena-hero-title")).toContainText("YOUR VICTORY.");
  await expect(page.getByRole("link", { name: "PLAY NOW" })).toHaveAttribute("href", "/register");
  await expect(page.getByRole("link", { name: "EXPLORE GAMES" })).toHaveAttribute("href", "/games");
  const desktopNav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(desktopNav.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  await expect(desktopNav.getByRole("link", { name: "Games" })).toHaveAttribute("href", "/games");
  await expect(desktopNav.getByRole("link", { name: "How it works" })).toHaveAttribute("href", "/how-it-works");
  await expect(desktopNav.getByRole("link", { name: "Fair play" })).toHaveAttribute("href", "/fair-play");
  await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
  await expect(page.getByRole("link", { name: /Create account/ }).first()).toHaveAttribute("href", "/register");
  await expect(page.locator(".story-more")).toHaveAttribute("href", "/how-it-works");
  await expect(page.locator(".closing-cta a")).toHaveAttribute("href", "/register");
  await expect(page.getByText(/subject to availability, player eligibility, and applicable approvals/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: /CHOOSE YOUR BATTLE\./i })).toBeVisible();
  await expect(page.locator(".battle-card")).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Explore Chess rules and details" })).toHaveAttribute("href", "/games/chess");
  await expect(page.getByRole("link", { name: "Explore Checkers rules and details" })).toHaveAttribute("href", "/games/checkers");

  for (const image of await page.locator(".battle-image").all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  for (const viewportWidth of [320, 360, 375, 414, 768, 1024, 1440]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
    expect(dimensions.document, `landing page overflows ${dimensions.viewport}px`).toBeLessThanOrEqual(dimensions.viewport);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  const width = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  expect(width.document, `landing page overflows ${width.viewport}px`).toBeLessThanOrEqual(width.viewport);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Tab");
  await expect(page.getByRole("banner").getByRole("link", { name: "DuelKe home" })).toBeFocused();
  await page.keyboard.press("Tab");
  const menuButton = page.getByRole("button", { name: "Open menu" });
  await expect(menuButton).toBeFocused();
  await page.keyboard.press("Enter");
  const focusOutline = await page.getByRole("button", { name: "Close menu" }).evaluate((element) => getComputedStyle(element).outlineWidth);
  expect(Number.parseFloat(focusOutline)).toBeGreaterThan(0);
  const menu = page.getByRole("navigation", { name: "Main navigation" });
  await expect(menu.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
  await expect(menu.getByRole("link", { name: "Games" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "Log in" })).toBeVisible();
  await menu.getByRole("link", { name: "Games" }).click();
  await expect(page).toHaveURL(/\/games$/);
});

test("home page discloses the virtual fee example and disabled cash flows", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/KSh 200/).first()).toBeVisible();
  await expect(page.getByText(/KSh 20/).first()).toBeVisible();
  await expect(page.getByText(/KSh 180 virtual credits/i).first()).toBeVisible();
  await expect(page.getByText(/Real-money payments and withdrawals are disabled/i)).toBeVisible();
});

test("reduced-motion preference disables hero animation and smooth scrolling", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const animation = await page.locator(".arena-hero-art").evaluate((element) => getComputedStyle(element).animationName);
  const scrollBehavior = await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior);
  const hiddenReveal = await page.locator("#choose-battle").evaluate((element) => getComputedStyle(element).opacity);
  expect(animation).toBe("none");
  expect(scrollBehavior).toBe("auto");
  expect(hiddenReveal).toBe("1");
});

test("registration requires separate Terms and Privacy consent and validates inputs", async ({ page }) => {
  await page.goto("/register");
  const form = page.locator("form");
  const email = page.getByLabel("Email address");
  const username = page.getByLabel(/Username/);
  const password = page.getByLabel("Password");
  const consents = page.getByRole("checkbox");
  await expect(email).toHaveAttribute("type", "email");
  await expect(password).toHaveAttribute("type", "password");
  await expect(password).toHaveAttribute("minlength", "12");
  await expect(consents).toHaveCount(2);
  await expect(form.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  await expect(form.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/privacy");
  expect(await form.evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(false);

  await email.fill("browser-test@example.invalid");
  await username.fill("browser_test");
  await password.fill("Browser-Only-Test-Password-12!");
  await consents.nth(0).check();
  await consents.nth(1).check();
  expect(await form.evaluate((element) => (element as HTMLFormElement).checkValidity())).toBe(true);
  // Do not submit: SMTP is intentionally unconfigured in this environment, and the test must not create an account.
});
