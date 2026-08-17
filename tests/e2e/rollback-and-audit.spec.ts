import { expect, test } from "@playwright/test";

test("supports keyboard-only review controls without fixture candidate IDs", async ({ page }) => {
  test.slow();
  const candidates = page.waitForResponse((response) => response.url().includes("/api/stash/v1/candidates") && response.request().method() === "GET");
  await page.goto("/changes");
  const [{ namespaceId }] = await (await candidates).json() as Array<{ namespaceId: string }>;
  await page.getByRole("button", { name: "Propose memory" }).click();
  await page.getByLabel("Namespace ID").fill(namespaceId);
  await page.getByLabel("Memory class").selectOption("fact");
  await page.getByLabel("Trust class").selectOption("observed");
  await page.getByLabel("Canonical text").fill(`Keyboard review ${Date.now()}`);
  await page.getByLabel("Source URI").fill("https://e2e.stash.test/keyboard");
  await page.getByLabel("Source content").fill(`keyboard evidence ${Date.now()}`);
  await page.getByRole("button", { name: "Submit proposal" }).click();
  const candidate = await page.getByText(/Candidate [0-9a-f-]{36} submitted\./).textContent();
  const id = candidate!.match(/[0-9a-f-]{36}/)![0]!;
  await page.goto(`/changes/${id}`);
  await page.getByRole("button", { name: "Screen candidate" }).press("Enter");
  await page.getByRole("button", { name: "Run evaluation" }).press("Enter");
  await expect(page.getByRole("status")).toContainText("Evaluation Passed");
  await page.getByLabel("Review reason").fill("keyboard approval");
  await page.getByRole("button", { name: "Approve" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Review approved");
});
