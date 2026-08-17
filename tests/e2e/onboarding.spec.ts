import { expect, test } from "@playwright/test";

test("creates an isolated persisted workspace and preserves its server identity after reload", async ({ page }) => {
  const session = page.waitForResponse((response) => response.url().endsWith("/api/session") && response.request().method() === "POST");
  await page.goto("/overview");
  expect((await session).status()).toBe(201);

  const workspaceId = await page.getByTestId("workspace-id").textContent();
  expect(workspaceId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  await expect(page.getByRole("heading", { name: "Stash workspace", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("workspace-id")).toHaveText(workspaceId!);
});

test("mobile navigation exposes every primary product surface", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only navigation assertion");
  await page.goto("/overview");
  await page.getByRole("button", { name: "Open navigation" }).click();
  for (const name of [/^Overview$/, /^Changes\b/, /^Memory$/, /^Evaluations$/, /^Agents$/, /^Audit$/, /^Setup$/, /^Settings$/]) {
    await expect(page.getByRole("link", { name })).toBeVisible();
  }
});
