// API functions with OpenAI / Supabase / Resend mocked.
const test = require("node:test");
const assert = require("node:assert");
const EVENT = { id: "lunik-20261114", title: "Lunik", venue: "Kammgarn", city: "Schaffhausen", start: "2026-11-14T20:00", timeKnown: true, summary: "Indie-pop.", priceFromCHF: 38 };
const sent = [];
global.fetch = async (url, opts = {}) => {
  url = String(url); sent.push({ url, opts });
  if (url.includes("/rest/v1/events")) return new Response(JSON.stringify(url.includes("lunik") ? [{ data: EVENT }] : []), { status: 200 });
  if (url.includes("/auth/v1/user")) return new Response("{}", { status: opts.headers && /good/.test(opts.headers.Authorization) ? 200 : 401 });
  if (url.endsWith("/chat/completions")) {
    const b = JSON.parse(opts.body);
    if (b.response_format) return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ audience: "Kids", categories: ["Kids", "Bogus"], from: "2026-10-30", to: "2026-11-01", region: "near", summary: "Kids this weekend near Zurich" }) } }] }), { status: 200 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Lunik at Kammgarn in Schaffhausen on Saturday the fourteenth of November at eight. Dreamy Swiss indie-pop in an intimate hall, tickets from thirty-eight francs." } }] }), { status: 200 });
  }
  if (url.endsWith("/audio/speech")) return new Response(new Uint8Array([0xff, 0xfb, 1, 2, 3]), { status: 200 });
  if (url.includes("api.resend.com")) return new Response("{}", { status: 200 });
  throw new Error("unexpected " + url);
};
function call(fn, { method = "GET", query = {}, body, headers = {} } = {}) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
      send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); }, json(o) { this.setHeader("content-type", "application/json"); this.send(JSON.stringify(o)); } };
    fn({ method, query, body, headers }, res);
  });
}

test("voice: no key → JSON fallback script", async () => {
  delete process.env.OPENAI_API_KEY;
  const r = await call(require("../api/voice"), { query: { id: "lunik-20261114", v: "x" } });
  assert.strictEqual(r.status, 200); const j = JSON.parse(r.body); assert.ok(j.fallback && /Lunik/.test(j.script));
});
test("voice: with key → mp3, cached for a year", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const r = await call(require("../api/voice"), { query: { id: "lunik-20261114", v: "x" } });
  assert.strictEqual(r.headers["content-type"], "audio/mpeg"); assert.match(r.headers["cache-control"], /s-maxage=31536000/);
  const tts = sent.filter(s => s.url.endsWith("/audio/speech")).pop(); const b = JSON.parse(tts.opts.body);
  assert.ok(b.voice && b.instructions && /Lunik/.test(b.input));
});
test("voice: unknown event → 404, bad id → 400", async () => {
  assert.strictEqual((await call(require("../api/voice"), { query: { id: "nope" } })).status, 404);
  assert.strictEqual((await call(require("../api/voice"), { query: { id: "../../etc" } })).status, 400);
});
test("ask: requires sign-in, then returns cleaned filters", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const ask = require("../api/ask");
  assert.strictEqual((await call(ask, { method: "POST", body: { text: "kids this weekend" }, headers: { authorization: "Bearer bad.bad.bad" } })).status, 401);
  const r = await call(ask, { method: "POST", body: { text: "kids this weekend near zurich" }, headers: { authorization: "Bearer good.good.good" } });
  const j = JSON.parse(r.body); assert.strictEqual(r.status, 200); assert.deepStrictEqual(j.filters.categories, ["Kids"]); assert.strictEqual(j.filters.region, "near");
});
test("contact: emails the owner with reply-to, never exposes the address", async () => {
  process.env.RESEND_API_KEY = "re_test"; process.env.CONTACT_TO = "owner@example.com";
  const r = await call(require("../api/contact"), { method: "POST", body: { kind: "venue", name: "Ann", email: "ann@example.com", body: "Please cover Moods" }, headers: { "x-forwarded-for": "1.2.3.4" } });
  assert.strictEqual(r.status, 200); assert.ok(!r.body.includes("owner@example.com"));
  const m = JSON.parse(sent.filter(s => s.url.includes("resend")).pop().opts.body);
  assert.deepStrictEqual(m.to, ["owner@example.com"]); assert.strictEqual(m.reply_to, "ann@example.com"); assert.match(m.subject, /Venue suggestion from Ann/);
});
test("share page: OG preview + escaped content", async () => {
  EVENT.title = 'Lunik <script>alert(1)</script>';
  const r = await call(require("../api/share"), { query: { id: "lunik-20261114" } });
  assert.strictEqual(r.status, 200); assert.ok(r.body.includes('property="og:title"')); assert.ok(!r.body.includes("<script>alert(1)"));
});
