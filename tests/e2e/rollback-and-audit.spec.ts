import { expect, test } from "@playwright/test";

test("requires confirmation for rollback and keeps an attributable audit view", async ({ page }) => {
  await page.goto("/memory/mem-refund-threshold");
  await page.getByRole("button", { name: "Roll back to version 2" }).click();
  await expect(page.getByRole("dialog")).toContainText("Create revision 13 from version 2?");
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await expect(page.getByRole("status")).toHaveText("Rollback requested for version 2");

  await page.goto("/audit");
  await expect(page.getByText("memory.promoted", { exact: true })).toBeVisible();
  await expect(page.getByText("candidate.quarantined", { exact: true })).toBeVisible();
  await expect(page.getByText("aws-eval-471", { exact: true })).toBeVisible();
});

test("supports keyboard-only change review", async ({ page }) => {
  await page.goto("/changes/chg-threshold-150");
  await page.getByRole("button", { name: "Approve" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toHaveText("Candidate approved");
});
