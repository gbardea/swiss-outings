// "When can we go?" API with Supabase, iCloud and Google mocked.
const test = require("node:test");
const assert = require("node:assert");
process.env.CAL_ENC_KEY = require("crypto").randomBytes(32).toString("base64");
const C = require("../lib/calendar");
const ME = "11111111-1111-1111-1111-111111111111", PARTNER = "22222222-2222-2222-2222-222222222222";
const future = new Date(Date.now() + 20 * 864e5); const Y = future.getUTCFullYear(), M = String(future.getUTCMonth() + 1).padStart(2, "0"), D = String(future.getUTCDate()).padStart(2, "0");
const day = n => { const x = new Date(Date.UTC(Y, +M - 1, +D + n)); return x.toISOString().slice(0, 10); };
const EVENT = { id: "xmas-market", title: "Christmas market", start: day(0), end: day(6), audience: ["Family"], region: "Zurich City" };
const ICS = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:${day(0).replace(/-/g, "")}\r\nDTEND;VALUE=DATE:${day(3).replace(/-/g, "")}\r\nSUMMARY:Away\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
let household = [], saved = [];
global.fetch = async (url, opts = {}) => {
  url = String(url);
  if (url.includes("/auth/v1/user")) return new Response(JSON.stringify(/good/.test(opts.headers.Authorization) ? { id: ME } : {}), { status: /good/.test(opts.headers.Authorization) ? 200 : 401 });
  if (url.includes("/rest/v1/events")) return new Response(JSON.stringify([{ data: EVENT }]), { status: 200 });
  if (url.endsWith("/rpc/household_calendars")) return new Response(JSON.stringify(household), { status: 200 });
  if (url.endsWith("/rpc/save_calendar_link")) { saved.push(JSON.parse(opts.body)); return new Response(null, { status: 204 }); }
  if (url.startsWith("https://p01-caldav.icloud.com/")) return new Response(ICS, { status: 200 });
  if (url.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "at", refresh_token: "rt" }), { status: 200 });
  if (url.includes("calendar/v3/freeBusy")) return new Response(JSON.stringify({ calendars: { primary: { busy: [{ start: day(4) + "T08:00:00Z", end: day(4) + "T18:00:00Z" }] } } }), { status: 200 });
  throw new Error("unexpected " + url);
};
const api = require("../api/cal");
function call({ method = "POST", query = {}, body, headers = { authorization: "Bearer good.good.good" } } = {}) {
  return new Promise(resolve => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, headers: this.headers, body: b }); }, json(o) { this.send(JSON.stringify(o)); } }; api({ method, query, body, headers }, res); });
}

test("not signed in → 401", async () => { assert.strictEqual((await call({ query: { action: "when" }, body: { event_id: "xmas-market" }, headers: {} })).status, 401); });
test("no calendar connected → asks to connect", async () => {
  household = []; const r = JSON.parse((await call({ query: { action: "when" }, body: { event_id: "xmas-market" } })).body);
  assert.ok(r.needsConnect); assert.strictEqual(r.dates, 7);
});
test("rejects calendar links that aren't from known calendar services (no SSRF)", async () => {
  for (const url of ["http://169.254.169.254/latest", "https://localhost/x.ics", "https://evil.example/icloud.com.ics", "file:///etc/passwd"]) {
    const r = await call({ query: { action: "link" }, body: { url } }); assert.strictEqual(r.status, 400, url);
  }
});
test("saves an iCloud link encrypted (never in plain text)", async () => {
  saved = []; const r = await call({ query: { action: "link" }, body: { url: "webcal://p01-caldav.icloud.com/published/2/secret" } });
  assert.strictEqual(r.status, 200, r.body); assert.strictEqual(saved[0].p_provider, "ics"); assert.ok(!saved[0].p_secret.includes("secret"));
  assert.strictEqual(C.open(saved[0].p_secret).url, "https://p01-caldav.icloud.com/published/2/secret");
});
test("you + partner: suggests the first day both are free", async () => {
  household = [{ user_id: ME, name: "Gal", provider: "ics", secret: C.seal({ url: "https://p01-caldav.icloud.com/published/2/secret" }) },
               { user_id: PARTNER, name: "Corie", provider: "google", secret: C.seal({ rt: "refresh" }) }];
  process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "cs";
  const r = JSON.parse((await call({ query: { action: "when" }, body: { event_id: "xmas-market" } })).body);
  assert.deepStrictEqual(r.checked.sort(), ["Corie", "You"]);
  // days 0-2 you're away, day 4 Corie busy → first free is day 3 or a weekend after it
  assert.ok(r.best, JSON.stringify(r)); assert.ok(r.best.local >= day(3) && !r.best.local.startsWith(day(4)), r.best.local);
  assert.ok(r.clashes.some(c => c.busy.includes("You")));
});
test("google connect: start gives a consent URL, callback stores the refresh token", async () => {
  const s = JSON.parse((await call({ query: { action: "google-start" } })).body);
  const u = new URL(s.url); assert.strictEqual(u.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.freebusy");
  saved = []; const cb = await call({ method: "GET", query: { action: "google-callback", code: "abc", state: u.searchParams.get("state") }, headers: {} });
  assert.strictEqual(cb.status, 302); assert.match(cb.headers.location, /cal=connected/); assert.strictEqual(C.open(saved[0].p_secret).rt, "rt");
  const bad = await call({ method: "GET", query: { action: "google-callback", code: "abc", state: "forged" }, headers: {} });
  assert.match(bad.headers.location, /cal=error/);
});
