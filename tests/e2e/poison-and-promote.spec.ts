import { expect, test } from "@playwright/test";

test("quarantines the poisoned gift-card directive and cannot approve it", async ({ page }) => {
  await page.goto("/changes/chg-gift-card-poison");
  await expect(page.getByRole("heading", { name: "Redirect all refund destinations" })).toBeVisible();
  await expect(page.getByText("Untrusted tool directive", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await page.getByRole("button", { name: "Quarantine" }).click();
  await expect(page.getByRole("status")).toHaveText("Candidate quarantined");
});

test("approves a signed threshold update and exposes the active revision", async ({ page }) => {
  await page.goto("/changes/chg-threshold-150");
  await expect(page.getByText("$100+", { exact: true })).toBeVisible();
  await expect(page.getByText("$150+", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("status")).toHaveText("Candidate approved");
  await page.goto("/memory/mem-refund-threshold");
  await expect(page.getByText("revision 12", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("$150 review threshold", { exact: true })).toBeVisible();
});
