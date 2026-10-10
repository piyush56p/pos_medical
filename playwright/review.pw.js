const { test, expect } = require("@playwright/test");

const baseURL = process.env.PHARMA_BASE_URL || "http://localhost:3210";
const generatedProducts = [];
const generatedLocations = [];

async function signIn(page) {
  await page.goto(baseURL, { waitUntil: "domcontentloaded" });
  if (await page.locator("#login").isVisible()) {
    const username = process.env.PHARMA_E2E_USER;
    const password = process.env.PHARMA_E2E_PASS;
    if (!username || !password) throw new Error("Set PHARMA_E2E_USER and PHARMA_E2E_PASS to run local browser journeys.");
    await page.locator("#account [name=username]").fill(username);
    await page.locator("#account [name=password]").fill(password);
    await page.locator("#account button[type=submit]").click();
    await page.waitForTimeout(500);
  }
  await expect(page.locator("#main_app")).toBeVisible();
}

async function createLocation(request, name, type, parentId = null) {
  const response = await request.post(`${baseURL}/api/locations`, { data: { name, type, parentId } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const location = await response.json();
  generatedLocations.push(location.id);
  return location;
}

test.describe.serial("PharmaSpot local workflows", () => {
  test.afterAll(async ({ request }) => {
    const username = process.env.PHARMA_E2E_USER;
    const password = process.env.PHARMA_E2E_PASS;
    if (username && password) await request.post(`${baseURL}/api/users/login`, { data: { username, password } }).catch(() => {});
    for (const id of [...generatedLocations].reverse()) {
      await request.put(`${baseURL}/api/locations/${id}`, { data: { active: false } }).catch(() => {});
    }
    for (const barcode of generatedProducts) {
      const products = await request.get(`${baseURL}/api/inventory/products`).catch(() => null);
      if (!products || !products.ok()) continue;
      const record = (await products.json()).find((product) => String(product.barcodeValue) === barcode);
      if (record) await request.delete(`${baseURL}/api/inventory/product/${record._id}`).catch(() => {});
    }
  });

  test("opens inventory and dashboard; records screenshots at desktop, tablet, and mobile widths", async ({ page }) => {
    const runtimeErrors = [];
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("401")) runtimeErrors.push(message.text());
    });
    await signIn(page);

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator("#productModal").evaluate((button) => button.click());
    await expect(page.locator("#inventory_view")).toBeVisible();
    await page.screenshot({ path: "screenshots/review-v3/inventory-desktop.png", fullPage: true });
    await page.locator("#overview").evaluate((button) => button.click());
    await expect(page.locator("#dashboard_view .dashboard-sidebar")).toBeVisible();
    await page.screenshot({ path: "screenshots/review-v3/dashboard-desktop.png", fullPage: true });

    for (const [width, height, filename] of [
      [1024, 900, "dashboard-tablet"],
      [390, 844, "dashboard-mobile"],
      [390, 844, "inventory-mobile"],
    ]) {
      await page.setViewportSize({ width, height });
      if (filename === "inventory-mobile") await page.locator("#productModal").evaluate((button) => button.click());
      else await page.locator("#overview").evaluate((button) => button.click());
      await page.screenshot({ path: `screenshots/review-v3/${filename}.png`, fullPage: true });
      const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
      expect(widths.document).toBeLessThanOrEqual(width);
    }
    expect(runtimeErrors).toEqual([]);
  });

  test("creates a local medicine and assigns exact stock to a physical rack", async ({ page, request }) => {
    await signIn(page);
    const suffix = `${Date.now()}`;
    const barcode = `98${suffix.slice(-10)}`;
    const productName = `E2E Medicine ${suffix}`;
    generatedProducts.push(barcode);
    const api = page.context().request;
    const section = await createLocation(api, `E2E Section ${suffix}`, "section");
    const rack = await createLocation(api, `E2E Rack ${suffix}`, "rack", section.id);

    await page.locator("#inventoryPageAdd").click();
    await expect(page.locator("#newProduct")).toBeVisible();
    await page.locator("#productName").fill(productName);
    await page.locator("#barcode").fill(barcode);
    await page.locator("#product_price").fill("24.50");
    await page.locator("#quantity").fill("10");
    await page.locator("#submitProduct").click();
    await expect(page.locator("#newProduct")).toBeHidden({ timeout: 15000 });
    await page.locator("#inventorySearch").fill(productName);
    const row = page.locator("#inventoryPageRows tr").filter({ hasText: productName });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Location not assigned");
    await row.locator(".inventory-locate-product").click();
    await expect(page.locator("#productLocationsModal")).toBeVisible();
    await page.locator("#locationAssignmentRows .location-assignment-select").selectOption(rack.id);
    await page.locator("#locationAssignmentRows .location-assignment-quantity").fill("6");
    await page.locator("#productLocationsForm [type=submit]").click();
    await expect(page.locator("#productLocationsMessage")).toContainText("1 location(s) saved");
    const productResponse = await api.get(`${baseURL}/api/inventory/products`);
    const product = (await productResponse.json()).find((entry) => String(entry.barcodeValue) === barcode);
    expect(product.locations).toHaveLength(1);
    expect(product.locations[0].quantity).toBe(6);
    expect(product.locations[0].locationLabel).toContain(`E2E Section ${suffix}`);
    expect(product.locations[0].locationLabel).toContain(`E2E Rack ${suffix}`);
    await api.put(`${baseURL}/api/locations/product/${product._id}/stock`, { data: { batchId: null, assignments: [] } });
  });

  test("rejects an unpaid finalized sale without a customer name", async ({ page, request }) => {
    await signIn(page);
    const response = await page.context().request.post(`${baseURL}/api/new`, {
      data: {
        _id: `e2e-credit-${Date.now()}`,
        status: 1,
        total: 10,
        paid: 0,
        change: 0,
        customer: 0,
        items: [],
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain("customer name is required");
  });
});
