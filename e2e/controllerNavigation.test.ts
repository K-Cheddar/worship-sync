import assert from "node:assert/strict";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { presentationControllerHomeLink } from "./controllerTestData";

test("finds the Presentation Controller Home link by route with default and custom names", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const label of ["Presentation", "Text Master"]) {
      await page.setContent(
        `<main><a href="#/controller">${label}</a><a href="#/controller/songs">Songs</a></main>`,
      );
      const controllerLink = presentationControllerHomeLink(page);
      await expect(controllerLink).toHaveCount(1);
      await expect(controllerLink).toHaveText(label);
      assert.equal(await controllerLink.getAttribute("href"), "#/controller");
    }
  } finally {
    await browser.close();
  }
});
