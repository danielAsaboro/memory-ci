import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const path of ["/onboarding", "/overview", "/changes", "/memory", "/evaluations", "/agents", "/audit", "/settings"]) {
  test(`${path} has no automatically detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map((violation) => ({
      id: violation.id,
      targets: violation.nodes.flatMap((node) => node.target),
    }))).toEqual([]);
  });
}
