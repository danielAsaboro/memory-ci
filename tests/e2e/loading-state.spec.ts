import { expect, test } from "@playwright/test";

test("keeps the loading indicator centered on its own axis", async ({ page }) => {
  await page.route("**/api/stash/v1/overview", async () => {
    await new Promise(() => undefined);
  });

  await page.goto("/overview");

  const spinner = page.locator(".spin");
  await expect(spinner).toBeVisible();
  await expect(spinner).toHaveCSS("width", "28px");
  await expect(spinner).toHaveCSS("height", "28px");
  await expect(spinner).toHaveCSS("transform-origin", "14px 14px");
  await expect(spinner.locator("svg")).toHaveCSS("width", "18px");
  await expect(spinner.locator("svg")).toHaveCSS("height", "18px");
});
