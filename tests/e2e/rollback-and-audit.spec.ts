import { expect, test } from "@playwright/test";

const liveProduction = Boolean(process.env.PLAYWRIGHT_BASE_URL);

test("supports keyboard-only review controls without fixture candidate IDs", async ({ page }) => {
  test.slow();
  if (liveProduction) test.setTimeout(180_000);
  const candidates = page.waitForResponse((response) => response.url().includes("/api/stash/v1/candidates") && response.request().method() === "GET");
  await page.goto("/changes");
  const [{ namespaceId }] = await (await candidates).json() as Array<{ namespaceId: string }>;
  await page.getByRole("button", { name: "Propose memory" }).click();
  await expect(page.getByLabel("Namespace ID")).toHaveValue(namespaceId);
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
  await expect(page.getByRole("status")).toContainText("Evaluation Passed", { timeout: liveProduction ? 90_000 : 5_000 });
  await page.getByLabel("Review reason").fill("keyboard approval");
  const approve = page.getByRole("button", { name: "Approve" });
  await expect(approve).toBeEnabled({ timeout: liveProduction ? 15_000 : 5_000 });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Review approved");
});
