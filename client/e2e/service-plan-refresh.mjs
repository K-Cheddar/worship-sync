import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const browser = await chromium.launch({headless: true});

try {
  const page = await browser.newPage({viewport: {width: 900, height: 700}});
  await page.setContent(`
    <style>
      body { margin: 0; background: #181818; color: white; font: 14px Arial, sans-serif; }
      #window { position: fixed; left: 24px; top: 24px; display: flex; flex-direction: column; width: 520px; height: 360px; overflow: hidden; border: 1px solid #888; background: #222; }
      #title { flex: none; height: 40px; box-sizing: border-box; padding: 12px; background: #444; }
      #scrollport { min-height: 0; flex: 1; overflow-y: auto; padding: 12px; }
      section { margin-bottom: 8px; border: 1px solid #555; }
      h2 { margin: 0; padding: 8px; background: #292929; font-size: 12px; }
      ol { margin: 0; padding: 0; list-style: none; }
      li { box-sizing: border-box; min-height: 48px; padding: 14px 8px; border-top: 1px solid #444; }
    </style>
    <div id="window">
      <div id="title">Fixture Service</div>
      <div id="scrollport"><section><h2>Order of Worship</h2><ol id="items"></ol></section></div>
    </div>
  `);

  const dimensions = await page.evaluate(() => {
    const items = document.getElementById("items");
    for (let index = 1; index <= 48; index += 1) {
      const item = document.createElement("li");
      item.id = `plan-item-${index}`;
      item.textContent = `Plan item ${index}`;
      items.append(item);
    }
    const scrollport = document.getElementById("scrollport");
    return {
      clientHeight: scrollport.clientHeight,
      scrollHeight: scrollport.scrollHeight,
    };
  });
  assert(dimensions.scrollHeight > dimensions.clientHeight, "the plan content should overflow its scrollport");

  const readingItem = page.locator("#plan-item-25");
  const beforeTop = await readingItem.evaluate((element) => {
    const scrollport = document.getElementById("scrollport");
    const currentTop = element.getBoundingClientRect().top - scrollport.getBoundingClientRect().top;
    scrollport.scrollTop += currentTop - 120;
    return element.getBoundingClientRect().top;
  });
  await page.waitForTimeout(50);

  await page.evaluate(() => {
    const insertedItem = document.createElement("li");
    insertedItem.id = "plan-item-0";
    insertedItem.textContent = "Plan item 0";
    document.getElementById("items").prepend(insertedItem);
  });
  await page.locator("#plan-item-0").waitFor();
  await page.waitForTimeout(50);

  const afterTop = await readingItem.evaluate((element) => element.getBoundingClientRect().top);
  assert(
    Math.abs(afterTop - beforeTop) <= 4,
    `the reading item moved from ${beforeTop}px to ${afterTop}px after inserting content above it`,
  );

  const nextItem = page.locator("#plan-item-26");
  const beforeDeleteTop = await nextItem.evaluate((element) => element.getBoundingClientRect().top);
  await page.evaluate(() => document.getElementById("plan-item-25").remove());
  await page.waitForTimeout(50);
  const afterDeleteTop = await nextItem.evaluate((element) => element.getBoundingClientRect().top);
  const scrollTopAfterDelete = await page.locator("#scrollport").evaluate((element) => element.scrollTop);
  assert(scrollTopAfterDelete > 0, "deleting the visible item should not reset the plan to its beginning");
  assert(
    Math.abs(afterDeleteTop - beforeDeleteTop) <= 52,
    `the nearest surviving item moved from ${beforeDeleteTop}px to ${afterDeleteTop}px after deleting the reading item`,
  );
  console.log("PASS Chromium keeps the visible reading item anchored after inserting content above it");
  console.log("PASS Chromium retains a nearby reading position after deleting the visible item");
} finally {
  await browser.close();
}
