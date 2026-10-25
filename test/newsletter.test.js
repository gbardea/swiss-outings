// Sunday email: picks per household, safe HTML, unsubscribe, and who may trigger a send.
const test = require("node:test");
const assert = require("node:assert");
const sent = [];
const today = new Date().toISOString().slice(0, 10);
const add = n => { const d = new Date(today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ev = (id, s, extra = {}) => Object.assign({ id, title: "Event " + id, start: s + "T19:00", timeKnown: true, city: "Zürich", venue: "V" + id, region: "Zurich City", audience: ["Parents"], category: "Music", summary: "Nice <b>night</b>", priceText: "CHF 20" }, extra);
const EVENTS = [ev("k1", add(1), { audience: ["Kids"], category: "Kids" }), ev("p1", add(2)), ev("p2", add(3)), ev("h1", add(2)), ev("far", add(40), { scale: "big" }), ev("<x>", add(4), { title: "<script>alert(1)</script>" })];
global.fetch = async (url, opts = {}) => {
  url = String(url); sent.push({ url, opts });
  const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (url.includes("/rpc/newsletter_batch")) { const b = JSON.parse(opts.body); if (b.p_secret !== "cron-secret") return J({ message: "not allowed" }, 400); return J([{ user_id: "u1", email: "a@example.com", name: "Anna", token: "t".repeat(64), kids: 2, planned: ["p2"], hidden: ["h1"] }]); }
  if (url.includes("/rpc/newsletter_mark_sent")) return J(1);
  if (url.includes("/rpc/newsletter_unsubscribe")) return J(JSON.parse(opts.body).p_token === "t".repeat(64));
  if (url.includes("/rpc/newsletter_test_target")) return J(opts.headers.Authorization === "Bearer a.b.c" ? "u1" : null);
  if (url.includes("/rest/v1/events")) return J(EVENTS.map(e => ({ id: e.id, data: e, first_seen: today, start_date: e.start.slice(0, 10), end_date: e.start.slice(0, 10) })));
  if (url === "https://api.resend.com/emails/batch") return J([{ id: "m1" }]);
  throw new Error("unexpected " + url);
};
process.env.CRON_SECRET = "cron-secret"; process.env.RESEND_API_KEY = "re_test"; delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY;
const NL = require("../api/newsletter");
function call(fn, { method = "GET", query = {}, headers = {} } = {}) {
  return new Promise(resolve => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, body: b }); }, json(o) { this.send(JSON.stringify(o)); } }; fn({ method, query, headers }, res); });
}
test("send refuses without the cron secret", async () => {
  const r = await call(NL, { query: { action: "send" } }); assert.strictEqual(r.status, 401);
  const r2 = await call(NL, { query: { action: "send" }, headers: { authorization: "Bearer guess" } }); assert.strictEqual(r2.status, 401);
});
test("weekly send: picks for the household, hides 'Not for us', escapes text, one-click unsubscribe", async () => {
  sent.length = 0;
  const r = await call(NL, { query: { action: "send" }, headers: { authorization: "Bearer cron-secret" } });
  assert.strictEqual(r.status, 200, r.body); assert.strictEqual(JSON.parse(r.body).sent, 1);
  const mail = JSON.parse(sent.find(x => x.url.includes("resend")).opts.body)[0];
  assert.deepStrictEqual(mail.to, ["a@example.com"]);
  assert.ok(!/Event h1/.test(mail.html), "hidden event left out");
  assert.ok(/On your list/.test(mail.html) && /Event p2/.test(mail.html), "planned event shown in its own section");
  assert.ok(!/<script>alert/.test(mail.html) && /&lt;script&gt;/.test(mail.html), "titles escaped");
  assert.ok(mail.html.includes("/api/newsletter?unsub=" + "t".repeat(64)));
  assert.match(mail.headers["List-Unsubscribe"], /unsub=t{64}/);
  assert.ok(sent.some(x => x.url.includes("newsletter_mark_sent")), "marked as sent");
});
test("unsubscribe link shows a friendly page", async () => {
  const ok = await call(NL, { query: { unsub: "t".repeat(64) } }); assert.match(ok.body, /unsubscribed/);
  const bad = await call(NL, { query: { unsub: "nope" } }); assert.match(bad.body, /didn't work/);
});
test("test send only for a 2-step admin, only to themselves", async () => {
  const no = await call(NL, { method: "POST", query: { action: "test" }, headers: { authorization: "Bearer x.y.z" } }); assert.strictEqual(no.status, 403);
  sent.length = 0;
  const yes = await call(NL, { method: "POST", query: { action: "test" }, headers: { authorization: "Bearer a.b.c" } }); assert.strictEqual(yes.status, 200, yes.body);
  assert.strictEqual(JSON.parse(sent.find(x => x.url.includes("newsletter_batch")).opts.body).p_only, "u1");
  assert.ok(!sent.some(x => x.url.includes("newsletter_mark_sent")), "a test doesn't count as this week's send");
});
