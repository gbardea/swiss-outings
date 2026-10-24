// Screenshots of the main screens for design review: node test/shots.mjs <outDir> [prefix]
import path from "node:path";
import fs from "node:fs";
import { BASE, EVENTS, browser, server, newPage } from "./harness.mjs";
const out = process.argv[2] || "test/screens", pre = process.argv[3] || "";
fs.mkdirSync(out, { recursive: true });
const shot = (p, n, o = {}) => p.screenshot({ path: path.join(out, pre + n + ".png"), ...o });
const ev = EVENTS.find(e => e.ticketUrl && /^https/.test(e.ticketUrl) && e.priceFromCHF) || EVENTS[1];
for (const mobile of [true, false]) {
  const page = await newPage("member", { mobile });
  await page.addInitScript(() => { localStorage.setItem("so.tipsSeen", "1"); });
  await page.goto(BASE + "/"); await page.waitForSelector(".card"); await page.waitForTimeout(400);
  const k = mobile ? "phone-" : "desktop-";
  await shot(page, k + "home");
  if (mobile) { await page.evaluate(() => { const g = document.querySelector(".grid .card"); g && g.scrollIntoView(); window.scrollBy(0, -70); }); await page.waitForTimeout(200); await shot(page, k + "feed"); }
  await page.evaluate(id => window.__app.openSheet(id), ev.id); await page.waitForTimeout(400);
  await shot(page, k + "event-top");
  if (mobile) {
    for (const [i, n] of [[1, "event-middle"], [2, "event-bottom"]]) { await page.evaluate(i => { const s = document.querySelector("#sheetHost .sheet"); s.scrollTop = s.clientHeight * 0.85 * i; }, i); await page.waitForTimeout(150); await shot(page, k + n); }
  }
  await page.context().close();
}
await browser.close(); server.close();
console.log("saved to", out);
