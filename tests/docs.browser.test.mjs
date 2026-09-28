import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import release from "../release.json" with { type: "json" };

const origin = process.env.STRIFE_WEB_URL || "http://127.0.0.1:4317";
test(
  "wiki and script downloads: routes, links, mobile layout, accessibility, clipboard, no-JS",
  { timeout: 120000 },
  async () => {
    const browser = await chromium.launch({
      channel: process.env.STRIFE_TEST_BROWSER || "chrome",
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      for (const route of ["/wiki/", "/scripts/"]) {
        for (const width of [390, 768, 1440]) {
          await page.setViewportSize({ width, height: 900 });
          const response = await page.goto(origin + route);
          assert.equal(response.status(), 200);
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.locator("h1").count(), 1);
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            `${route} overflow at ${width}`,
          );
          const audit = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze();
          assert.deepEqual(
            audit.violations.map((v) => ({
              id: v.id,
              nodes: v.nodes.map((n) => n.target),
            })),
            [],
          );
        }
        const brokenAnchors = await page.evaluate(() =>
          [...document.querySelectorAll('a[href^="#"]')]
            .map((a) => a.getAttribute("href").slice(1))
            .filter((id) => !document.getElementById(id)),
        );
        assert.deepEqual(brokenAnchors, []);
        await context.grantPermissions(["clipboard-read", "clipboard-write"]);
        await page
          .getByRole("button", { name: "Copy command block 1", exact: true })
          .click();
        assert.equal(
          (await page.evaluate(() => navigator.clipboard.readText())).replace(
            /\r\n/g,
            "\n",
          ),
          (await page.locator("pre[data-copy]").first().textContent()).trim() +
            "\n",
        );
      }
      assert.equal(
        await page
          .getByText(
            "Be stupid and lazy, let the AI slop scramble your server's brain like an octopus.",
            { exact: true },
          )
          .count(),
        1,
      );
      // Every same-origin link resolves (including fragment targets on other pages).
      const localLinks = new Set();
      for (const route of ["/wiki/", "/scripts/"]) {
        await page.goto(origin + route);
        for (const href of await page
          .locator('a[href^="/"]')
          .evaluateAll((links) => links.map((a) => a.getAttribute("href"))))
          localLinks.add(href);
      }
      for (const href of localLinks) {
        const response = await context.request.get(origin + href);
        assert.equal(response.status(), 200, href);
        const fragment = new URL(origin + href).hash.slice(1);
        if (fragment)
          assert.ok((await response.text()).includes(`id="${fragment}"`), href);
      }
      const sums = await context.request.get(origin + "/scripts/SHA256SUMS");
      assert.equal(sums.status(), 200);
      for (const line of (await sums.text()).trim().split("\n")) {
        const [hash, name] = line.split(/\s+/);
        const response = await context.request.get(origin + "/scripts/" + name);
        assert.equal(response.status(), 200);
        assert.match(response.headers()["content-type"], /^text\/plain/);
        const bytes = await response.body();
        assert.ok(bytes.toString().startsWith("#!/usr/bin/env bash\n"));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), hash);
        assert.deepEqual(
          bytes,
          await readFile(new URL("../public/scripts/" + name, import.meta.url)),
        );
        const head = await context.request.head(origin + "/scripts/" + name);
        assert.equal(head.status(), 200);
        assert.equal((await head.body()).length, 0);
        await page.goto(origin + "/scripts/");
        const pending = page.waitForEvent("download");
        await page.locator(`a[download][href="/scripts/${name}"]`).click();
        assert.equal((await pending).suggestedFilename(), name);
      }
      assert.equal(
        (await context.request.get(origin + "/scripts/missing.sh")).status(),
        404,
      );
      // Release markers must not insert whitespace into runnable filenames.
      await page.goto(origin + "/wiki/");
      const filename = (id) =>
        release.downloads.find((item) => item.id === id).filename;
      for (const command of [
        `Get-FileHash .\\${filename("windows-x64")} -Algorithm SHA256`,
        `sha256sum -c ${filename("linux-x64")}.sha256`,
        `tar -xzf ${filename("linux-x64")}`,
      ]) {
        const block = page
          .locator("pre[data-copy]")
          .filter({ hasText: command });
        assert.equal(await block.count(), 1, command);
        assert.ok((await block.textContent()).includes(command));
        await block
          .locator("xpath=following-sibling::*[1]")
          .getByRole("button")
          .click();
        assert.ok(
          (await page.evaluate(() => navigator.clipboard.readText())).includes(
            command,
          ),
        );
      }
      const plain = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 390, height: 844 },
      });
      const noJs = await plain.newPage();
      for (const route of ["/wiki/", "/scripts/"]) {
        await noJs.goto(origin + route);
        assert.ok(await noJs.locator("h1").isVisible());
        assert.ok(await noJs.locator("pre").first().isVisible());
        if (route === "/wiki/") {
          assert.ok(
            (await noJs.locator(".docs-hero").textContent())
              .replace(/\s+/g, " ")
              .includes(`Client baseline: Strife ${release.version}`),
          );
          const client = await noJs.locator("#client").textContent();
          for (const id of ["windows-x64", "linux-x64", "macos-arm64"])
            assert.ok(client.includes(filename(id)), id);
          for (const link of await noJs.locator("a[data-release-doc]").all()) {
            const doc = await link.getAttribute("data-release-doc");
            assert.equal(
              await link.getAttribute("href"),
              `https://github.com/M-ax/strife/blob/${release.sourceRef}/${doc}`,
            );
          }
        }
      }
      assert.deepEqual(errors, []);
      await plain.close();
    } finally {
      await browser.close();
    }
  },
);
