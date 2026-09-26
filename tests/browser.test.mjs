import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import release from "../release.json" with { type: "json" };

const origin = process.env.STRIFE_WEB_URL || "http://127.0.0.1:4317";

test(
  "responsive page, keyboard controls, accessibility, and a verified Windows download",
  { timeout: 120000 },
  async () => {
    await mkdir("artifacts", { recursive: true });
    const browser = await chromium.launch({
      channel: process.env.STRIFE_TEST_BROWSER || "chrome",
      headless: true,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      const response = await page.goto(origin);
      assert.equal(response.status(), 200);
      assert.match(
        response.headers()["content-security-policy"],
        /script-src 'self'/,
      );
      await page.evaluate(() => document.fonts.ready);
      await page
        .locator("#release-info")
        .filter({ hasText: release.version })
        .waitFor();
      assert.equal(
        (await page.locator("h1").innerText()).replace(/\s+/g, " ").trim(),
        "Another Discord alternative has hit the towers",
      );
      assert.equal(
        await page.locator("a[data-download]").first().getAttribute("href"),
        "/download/windows-x64",
      );
      await page.getByRole("button", { name: "02 Chat" }).click();
      assert.equal(
        await page
          .getByRole("button", { name: "02 Chat" })
          .getAttribute("aria-pressed"),
        "true",
      );
      assert.match(
        await page.locator("#preview-caption").innerText(),
        /Collapse at will/,
      );
      await page.getByRole("button", { name: "03 Watch" }).focus();
      await page.keyboard.press("Enter");
      assert.match(
        await page.locator("#preview-caption").innerText(),
        /big screen/,
      );
      await page.getByRole("button", { name: "01 Voice" }).click();
      await page.screenshot({ path: "artifacts/desktop.png", fullPage: true });
      await page.screenshot({ path: "artifacts/hero.png" });

      const desktopAudit = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        desktopAudit.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        [],
      );
      const faq = page.locator(".faq-list details").first();
      await faq.locator("summary").focus();
      await page.keyboard.press("Enter");
      assert.equal(await faq.getAttribute("open"), "");
      await page.locator("#checksum-details summary").click();
      assert.equal(await page.locator("#checksum").innerText(), release.sha256);
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("button", { name: "Copy checksum" }).click();
      assert.equal(
        await page.evaluate(() => navigator.clipboard.readText()),
        release.sha256,
      );
      const downloadPromise = page.waitForEvent("download");
      await page.locator(".download-main").click();
      const download = await downloadPromise;
      assert.equal(download.suggestedFilename(), release.filename);
      const file = "artifacts/" + release.filename;
      await download.saveAs(file);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      assert.equal(
        hash.digest("hex"),
        release.sha256,
        "actual downloaded ZIP matches the published checksum",
      );

      for (const width of [390, 768, 1024]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(origin);
        await page.evaluate(() => document.fonts.ready);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          "no horizontal overflow at " + width,
        );
        await page.getByRole("button", { name: "02 Chat" }).click();
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          "chat preview fits at " + width,
        );
        await page.getByRole("button", { name: "01 Voice" }).click();
        if (width === 390) {
          await page.evaluate(() =>
            window.scrollTo({ top: 0, behavior: "instant" }),
          );
          await page.screenshot({
            path: "artifacts/mobile.png",
            fullPage: true,
          });
          const mobileAudit = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          assert.deepEqual(
            mobileAudit.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
            [],
          );
        }
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(
        await context.cookies(),
        [],
        "the landing page creates no cookies",
      );
      const missing = await page.goto(origin + "/definitely-not-a-channel");
      assert.equal(missing.status(), 404);
      assert.match(await page.locator("h1").innerText(), /Wrong channel/);
      await page.route("**/api/release", (route) =>
        route.fulfill({ json: { available: false } }),
      );
      await page.goto(origin);
      await page
        .locator(".download-main")
        .filter({ hasText: "Get the source" })
        .waitFor();
      assert.equal(
        await page.locator(".download-main").getAttribute("href"),
        "https://github.com/M-ax/strife",
      );
      console.log(
        "Verified: desktop/mobile layout, WCAG audit, preview and FAQ controls, clipboard, full ZIP integrity, missing-release fallback.",
      );
    } finally {
      await browser.close();
    }
  },
);

test("real Worker supports resumed downloads and headers", async () => {
  const response = await fetch(origin + "/download/windows-x64", {
    headers: { Range: "bytes=0-3" },
  });
  assert.equal(response.status, 206);
  assert.equal(
    response.headers.get("Content-Range"),
    "bytes 0-3/" + release.bytes,
  );
  assert.deepEqual(
    [...new Uint8Array(await response.arrayBuffer())],
    [80, 75, 3, 4],
  );
  const checksum = await fetch(origin + "/download/windows-x64.sha256");
  assert.equal(
    await checksum.text(),
    release.sha256 + "  " + release.filename + "\n",
  );
  const head = await fetch(origin + "/download/windows-x64", {
    method: "HEAD",
  });
  assert.equal(head.headers.get("Content-Length"), String(release.bytes));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});
