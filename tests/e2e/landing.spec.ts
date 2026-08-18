import { expect, test } from "@playwright/test";

test("presents Stash as a public release-control entry point", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: /All your agent memory in one place/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open the control plane/i })).toHaveAttribute("href", "/overview");
  await expect(page.getByRole("heading", { name: /How Stash works/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause release activity" })).toBeVisible();
  await expect(page.getByText("Runtime status", { exact: true })).toBeVisible();
  await expect(page.getByText("Northstar Support")).not.toBeVisible();
});
