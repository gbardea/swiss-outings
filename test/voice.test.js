const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { templateScript, spokenWhen, voiceVersion } = require("../lib/voice");
const e = { id: "lunik-20261114", title: "Lunik", venue: "Kammgarn", city: "Schaffhausen", start: "2026-11-14T20:00", timeKnown: true,
  summary: "Swiss indie-pop with dreamy vocals.", priceFromCHF: 38, priceToCHF: 45, ticketStatus: "selling fast", audience: ["Parents"], tags: ["date night"], updatedAt: "2026-10-24" };

test("spoken date reads naturally", () => {
  assert.strictEqual(spokenWhen(e), "Saturday the 14th of November at 8 p.m.");
  assert.strictEqual(spokenWhen({ start: "2026-12-01", end: "2026-12-24" }), "from Tuesday the 1st of December to Thursday the 24th of December");
});
test("template script has the key facts and no CHF symbols", () => {
  const s = templateScript(e);
  for (const bit of ["Lunik", "Kammgarn", "Schaffhausen", "38 francs to 45 francs", "selling fast", "date night"]) assert.ok(s.includes(bit), bit + " in: " + s);
  assert.ok(!/CHF/.test(s));
});
test("voice version matches the app's copy in public/core.js", () => {
  // core.js uses hash() (FNV-1a) on the same fields; re-implement from its source to make sure they stay in sync
  const src = fs.readFileSync(__dirname + "/../public/core.js", "utf8");
  const hashSrc = src.match(/function hash\(s\)\{[^\n]+\}/)[0];
  const verSrc = src.match(/function voiceVersion\(e\)\{[^\n]+\}/)[0];
  const appVersion = new Function(hashSrc + "\n" + verSrc + "\nreturn voiceVersion;")();
  assert.strictEqual(appVersion(e), voiceVersion(e));
  assert.notStrictEqual(voiceVersion(e), voiceVersion({ ...e, ticketStatus: "sold out" }));
});
