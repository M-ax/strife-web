import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";

const browser = await chromium.launch({
  channel: process.env.STRIFE_TEST_BROWSER || "chrome",
  headless: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.goto(
    pathToFileURL(path.resolve("public/assets/social-card.svg")).href,
  );
  await page.screenshot({ path: "public/assets/social-card.png" });
} finally {
  await browser.close();
}
