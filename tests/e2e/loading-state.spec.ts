import { expect, test } from "@playwright/test";

test("keeps the loading indicator centered on its own axis", async ({ page }) => {
  await page.route("**/api/stash/v1/overview", async () => {
    await new Promise(() => undefined);
  });

  await page.goto("/overview");

  const spinner = page.locator(".spin");
  await expect(spinner).toBeVisible();
  const metrics = await spinner.evaluate((element) => {
    const box = getComputedStyle(element);
    const iconElement = element.querySelector("svg");
    const icon = iconElement ? getComputedStyle(iconElement) : null;
    return {
      box: { width: box.width, height: box.height, transformOrigin: box.transformOrigin },
      icon: icon ? { width: icon.width, height: icon.height } : null,
    };
  });

  expect(metrics).toEqual({
    box: { width: "28px", height: "28px", transformOrigin: "14px 14px" },
    icon: { width: "18px", height: "18px" },
  });
});
