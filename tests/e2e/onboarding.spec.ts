import { expect, test } from "@playwright/test";

test("shows honest provider readiness and reaches the review queue", async ({ page }) => {
  await page.goto("/onboarding");
  await expect(page.getByRole("heading", { name: "Make memory deployable." })).toBeVisible();
  await expect(page.getByText("Sandbox fixture", { exact: true })).toBeVisible();
  await expect(page.getByText("Setup complete", { exact: true })).toBeVisible();
  await expect(page.getByText("authenticated cloud proof pending", { exact: false })).toBeVisible();
  await page.getByRole("link", { name: /Open review queue/ }).click();
  await expect(page).toHaveURL(/\/changes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Memory changes", exact: true })).toBeVisible();
});

test("mobile navigation exposes every primary product surface", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only navigation assertion");
  await page.goto("/overview");
  await page.getByRole("button", { name: "Open navigation" }).click();
  for (const name of [/^Overview$/, /^Changes\b/, /^Memory$/, /^Evaluations$/, /^Agents$/, /^Audit$/, /^Setup$/, /^Settings$/]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
});
