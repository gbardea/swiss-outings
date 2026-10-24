// End-to-end UI test: serves public/ + api/ locally, fakes Supabase in the browser, and clicks through the app.
// Run: node test/e2e.mjs   (needs Playwright + Chromium; no network needed)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SB = "https://vwqtpffnsfyazyezfcdt.supabase.co";

/* ---------- test data ---------- */
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "public/seed.json"), "utf8")).events.slice(0, 40);
const iso = d => d.toISOString().slice(0, 10);
const today = new Date();
const EVENTS = seed.map((e, i) => { const d = new Date(today); d.setDate(d.getDate() + 1 + (i % 30)); const t = (e.start || "").slice(10); return { ...e, start: iso(d) + t, end: null, ticketUrl: i === 0 ? "javascript:alert(1)" : e.ticketUrl }; });
const UID = "11111111-1111-1111-1111-111111111111", HH = "22222222-2222-2222-2222-222222222222";
let SCENARIO = "member"; // "member" | "newuser" | "admin"
const calls = [];

/* ---------- local server: static files + api functions (Vercel-like) ---------- */
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => { // server-side calls from api/* to Supabase
  const u = String(url);
  if (u.startsWith(SB + "/rest/v1/events")) { const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || ""); const e = EVENTS.find(x => x.id === id); return new Response(JSON.stringify(e ? [{ data: e }] : []), { status: 200, headers: { "content-type": "application/json" } }); }
  if (u.startsWith(SB + "/auth/v1/user")) return new Response("{}", { status: 200 });
  throw new Error("blocked " + u);
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  let p = u.pathname;
  const m = p.match(/^\/e\/(.+)$/); if (m) p = "/api/share", u.searchParams.set("id", decodeURIComponent(m[1]));
  if (p.startsWith("/api/")) {
    const fn = require(path.join(ROOT, p + ".js"));
    let body = ""; for await (const c of req) body += c;
    req.query = Object.fromEntries(u.searchParams); req.body = body ? JSON.parse(body) : undefined;
    calls.push({ api: p, query: req.query, body: req.body });
    res.status = c => (res.statusCode = c, res); res.json = o => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(o)); };
    res.send = b => res.end(b);
    return fn(req, res);
  }
  if (p === "/") p = "/index.html";
  const f = path.join(ROOT, "public", p);
  if (!f.startsWith(path.join(ROOT, "public")) || !fs.existsSync(f)) { res.statusCode = 404; return res.end("nf"); }
  res.setHeader("content-type", TYPES[path.extname(f)] || "application/octet-stream"); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, r));
const BASE = "http://localhost:" + server.address().port;

/* ---------- fake Supabase in the browser ---------- */
function rest(table, method, url) {
  const memberRow = { user_id: UID, household_id: HH, display_name: "Gal", is_admin: SCENARIO === "admin" };
  if (table === "events") return EVENTS.map(e => ({ id: e.id, data: e, first_seen: iso(today) }));
  if (table === "members") { if (SCENARIO === "newuser") return url.includes("user_id=eq") && /maybeSingle|limit/.test(url) ? null : []; return url.includes("user_id=eq.") && !url.includes("household_id") ? memberRow : [memberRow]; }
  if (table === "households") return url.includes("id=in.") ? [{ id: "f1", name: "The Friends" }] : { id: HH, name: "Bar-Dea", prefs: {}, created_at: "2026-09-29" };
  if (table === "picks" || table === "hidden") return method === "GET" ? [] : null;
  if (table === "app_config") return [{ key: "scan", value: { lastRun: new Date().toISOString(), lastAdded: 5, lastNote: "ok" } }];
  if (table === "friendships") return [{ household_id: HH, friend_household_id: "f1", share_plans: false }];
  return [];
}
const RPC = {
  my_codes: () => [{ join_code: "JOINCODE", friend_code: "FRNDCODE" }],
  friend_picks: () => [], log_activity: b => (b.p || []).length, submit_message: () => 42, i_am_admin: () => SCENARIO === "admin",
  create_household: () => HH, join_household: () => null, delete_my_account: () => null,
  admin_overview: () => ({ users: 2, confirmed: 2, households: 2, active7: 2, active1: 1, signups7: 0, events_upcoming: 1700, events_added7: 120, picks: 9, hidden: 1, messages_open: 1, scan: { lastRun: new Date().toISOString(), lastAdded: 19, lastNote: "19 finds" }, daily: [{ day: iso(today), active: 2, signups: 0, actions: 30 }], added_daily: [{ day: iso(today), n: 19 }] }),
  admin_recent_activity: () => [{ at: new Date().toISOString(), user_id: UID, who: "Gal", kind: "keen", event_id: EVENTS[1].id, event_title: EVENTS[1].title, meta: {} }, { at: new Date().toISOString(), user_id: UID, who: "Gal", kind: "search", event_id: null, event_title: null, meta: { q: "kids this weekend", voice: true, results: 12 } }],
  admin_users: () => [{ user_id: UID, email: "g@example.com", display_name: "Gal", household_id: HH, household_name: "Bar-Dea", is_admin: true, created_at: "2026-09-29T09:00:00Z", confirmed: true, last_sign_in_at: null, last_active: new Date().toISOString(), views: 10, listens: 2, keen: 5, going: 2, hidden: 1, clicks: 3, shares: 1 }],
  admin_user_detail: () => ({ activity: RPC.admin_recent_activity(), picks: [{ event_id: EVENTS[1].id, state: "interested", title: EVENTS[1].title, start: iso(today) }], hidden: [], friends: [], household_members: [{ user_id: UID, name: "Gal" }] }),
  admin_event_stats: () => [{ event_id: EVENTS[1].id, title: EVENTS[1].title, start_date: iso(today), category: "Music", views: 5, listens: 1, keen: 2, going: 1, hidden: 0, clicks: 2, shares: 1 }],
  admin_messages: () => [{ id: 1, at: new Date().toISOString(), user_id: UID, name: "Gal", email: "g@example.com", kind: "venue", body: "Please cover Moods", handled: false }],
  admin_households: () => [{ id: HH, name: "Bar-Dea", created_at: "2026-09-29", members: [{ user_id: UID, name: "Gal" }], friends: 1 }]
};
async function fakeSupabase(page) {
  await page.route(SB + "/**", async route => {
    const r = route.request(), url = r.url(), method = r.method();
    const body = r.postData() ? JSON.parse(r.postData()) : {};
    const rpc = url.match(/\/rest\/v1\/rpc\/(\w+)/);
    if (rpc) { calls.push({ rpc: rpc[1], body }); const f = RPC[rpc[1]]; return route.fulfill({ status: f ? 200 : 404, contentType: "application/json", body: JSON.stringify(f ? f(body) : { message: "no such rpc" }) }); }
    const t = url.match(/\/rest\/v1\/(\w+)/);
    if (t) { calls.push({ table: t[1], method, url }); const accept = r.headers()["accept"] || ""; let data = rest(t[1], method, url); if (accept.includes("vnd.pgrst.object") && Array.isArray(data)) data = data[0] ?? null; return route.fulfill({ status: data === null && accept.includes("vnd.pgrst.object") ? 406 : 200, contentType: "application/json", body: JSON.stringify(data ?? []) }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const session = { access_token: "aaa.bbb.ccc", refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID, email: "g@example.com", aud: "authenticated", role: "authenticated" } };
  await page.addInitScript(([s]) => {
    localStorage.setItem("sb-vwqtpffnsfyazyezfcdt-auth-token", s);
    window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };
    window.__spoken = []; const ss = { speak(u){ window.__spoken.push(u.text); setTimeout(()=>u.onstart&&u.onstart(), 30); }, cancel(){}, getVoices(){ return []; } };
    Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true }); window.SpeechSynthesisUtterance = class { constructor(t){ this.text=t; } };
    window.WebSocket = class { constructor() { } close() { } send() { } addEventListener() { } };
  }, [JSON.stringify(session)]);
}

/* ---------- tests ---------- */
const results = [];
async function check(name, fn) { try { await fn(); results.push(["PASS", name]); } catch (e) { results.push(["FAIL", name, String(e.message || e).split("\n")[0]]); } }
const assert = (c, m) => { if (!c) throw new Error(m || "assertion failed"); };
const browser = await chromium.launch();
const errors = [];
async function newPage(scenario, opts = {}) {
  SCENARIO = scenario;
  const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: !!opts.mobile, hasTouch: !!opts.mobile, userAgent: opts.mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined });
  await ctx.route(/\/sw\.js$/, r => r.fulfill({ status: 404, body: "" }));
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(scenario + ": " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket|net::ERR|fonts\.g|fetching the script/.test(m.text())) errors.push(scenario + " console: " + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com/, r => r.fulfill({ status: 200, body: "" }));
  await fakeSupabase(page);
  return page;
}

// 1. Member on a phone
let page = await newPage("member", { mobile: true });
await page.goto(BASE + "/");
await check("app loads and shows event cards", async () => { await page.waitForSelector(".card", { timeout: 8000 }); assert((await page.$$(".card")).length > 5); });
await check("first visit shows 'app coming soon' + home-screen tips", async () => { await page.waitForSelector('[aria-label="Welcome to Swiss Outings"]', { timeout: 4000 }); const t = await page.textContent("#sheetHost"); assert(/App Store/.test(t) && /home screen/i.test(t) && /Suggest a place/.test(t)); });
await check("tips 'Suggest a place' opens the contact form", async () => { await page.click('#sheetHost [data-contact="venue"]'); await page.waitForSelector("#contactForm"); assert(await page.$eval("#cKind", s => s.value) === "venue"); });
await check("contact form saves the message and emails it", async () => { await page.fill("#cBody", "Please add Moods and Bogen F"); await page.click('#contactForm button[type=submit]'); await page.waitForTimeout(1500); if(process.env.DEBUG) console.log("DEBUG", await page.textContent("#sheetHost"), JSON.stringify(calls.filter(c=>c.rpc).slice(-3))); await page.waitForSelector(".thanks"); await page.waitForTimeout(300); assert(calls.some(c => c.rpc === "submit_message" && c.body.p_body.includes("Moods") && c.body.p_kind === "venue"), "rpc"); assert(calls.some(c => c.api === "/api/contact"), "api"); });
await page.click('.thanks [data-close]', {timeout:3000}).catch(()=>{});
await check("every card has a Listen button", async () => { const cards = await page.$$eval(".card", cs => cs.map(c => !!c.querySelector('[data-act="listen"]'))); assert(cards.length && cards.every(Boolean)); });
await page.evaluate(()=>window.scrollTo(0,520)); await page.screenshot({ path: path.join(ROOT, "test/screens/phone-cards.png") }).catch(()=>{}); await page.evaluate(()=>window.scrollTo(0,0));
await check("Listen fetches the voice clip and changes state", async () => { const b = await page.$('.card [data-act="listen"]'); const id = await b.getAttribute("data-id"); await b.click(); await page.waitForTimeout(800); assert(calls.some(c => c.api === "/api/voice" && c.query.id === id && c.query.v), "voice request"); const cls = await page.$eval(`.card [data-act="listen"][data-id="${id}"]`, x => x.className + "|" + x.textContent); assert(/playing/.test(cls) && /\d:\d\d|Playing/.test(cls), cls); const spoken = await page.evaluate(() => window.__spoken.filter(t => t.trim()).pop() || ""); assert(spoken.length > 40, "fallback script spoken: " + spoken); });
await check("tapping Listen again stops it", async () => { const b = await page.$('.card [data-act="listen"].playing'); if (b) { await b.click(); await page.waitForTimeout(200); } assert(!(await page.$('.card [data-act="listen"].playing'))); });
await check("Invite button is visible in the header on a phone", async () => { const v = await page.isVisible("header .invbtn"); assert(v); });
await check("Invite → WhatsApp sends a friend link with your code", async () => { await page.click("header .invbtn"); await page.waitForSelector(".invcard"); await page.click('.invcard [data-send="wa"][data-who="friend"]'); const o = await page.evaluate(() => window.__opened.slice(-1)[0] || ""); assert(o.startsWith("https://wa.me/?text=") && decodeURIComponent(o).includes("/?invite=FRNDCODE"), o); });
await check("Invite partner link uses the household code", async () => { await page.click('.invcard [data-send="wa"][data-who="partner"]'); const o = await page.evaluate(() => window.__opened.slice(-1)[0] || ""); assert(decodeURIComponent(o).includes("/?join=JOINCODE"), o); });
await page.click('#sheetHost .iconbtn[data-close]', {timeout:3000}).catch(()=>{});
await check("event sheet: Share on WhatsApp sends a /e/ link", async () => { await page.click(".card .title"); await page.waitForSelector(".sheet .sharebox"); await page.click('.sharebox [data-sendev="wa"]'); const o = await page.evaluate(() => window.__opened.slice(-1)[0] || ""); assert(/wa\.me/.test(o) && decodeURIComponent(o).includes("/e/"), o); });
await check("event sheet has the big Listen button", async () => { assert(await page.isVisible(".sheet .listen-big")); await page.screenshot({ path: path.join(ROOT, "test/screens/phone-sheet.png") }).catch(()=>{}); });
await check("unsafe ticket links are not rendered", async () => { await page.click('.sheet .close'); await page.evaluate(id => window.__app.openSheet(id), EVENTS[0].id); const hrefs = await page.$$eval("#sheetHost a[href]", as => as.map(a => a.getAttribute("href"))); assert(!hrefs.some(h => /^javascript:/i.test(h)), hrefs.join(",")); });
await page.click('.sheet .close', {timeout:3000}).catch(()=>{});
await check("Keen is saved and logged", async () => { await page.click('.card [data-act="int"]'); await page.waitForTimeout(3000); assert(calls.some(c => c.table === "picks" && c.method === "POST"), "pick saved"); assert(calls.some(c => c.rpc === "log_activity" && c.body.p.some(x => x.kind === "keen")), "keen logged"); assert(calls.some(c => c.rpc === "log_activity" && c.body.p.some(x => x.kind === "view")), "view logged"); });
await check("Ask (typed, no AI key) sets filters with the built-in parser", async () => { await page.click("[data-ask-open]"); await page.waitForSelector("#askText"); await page.fill("#askText", "something for the kids this weekend near Zurich"); await page.click('#askForm button[type=submit]'); await page.waitForSelector(".askbar.on", { timeout: 5000 }); const s = await page.textContent(".askbar.on"); assert(/kids/i.test(s), s); assert(calls.some(c => c.api === "/api/ask"), "api called first"); });
await check("Ask bar clear resets filters", async () => { await page.click("[data-ask-clear]"); await page.waitForSelector(".askbar:not(.on)"); });
await check("Ask sheet offers a microphone button", async () => { await page.click("[data-ask-open]"); assert(await page.isVisible("#micBtn")); await page.click('#sheetHost .iconbtn[data-close]'); });
await check("Settings shows invite, contact and no family names", async () => { await page.click("#openSettings"); await page.waitForSelector('.sheet[aria-label="Settings"]'); const t = await page.textContent("#sheetHost"); assert(/Invite people/.test(t) && /Contact us/.test(t) && /Suggest a venue/.test(t) && !/Admin dashboard/.test(t), t.slice(0,300)); await page.click('#sheetHost .iconbtn[data-close]'); });
await check("'Who's it for' uses generic labels", async () => { await page.click('.seg [data-view="who"]'); const t = await page.textContent("#main"); assert(!/Liam|Ellie|four of us/.test(t)); });
await page.screenshot({ path: path.join(ROOT, "test/screens/phone-home.png") }).catch(() => {});
await page.context().close();

// 1b. "When can we go?"
page = await newPage("member", { mobile: true });
let calMode = "connect"; const icsHits = [];
await page.route("**/api/cal?action=when", r => r.fulfill({ contentType: "application/json", body: JSON.stringify(calMode === "connect" ? { needsConnect: true, dates: 5 }
  : { best: { when: "Sat 14 Nov", local: "2026-11-14", pref: 2 }, more: [{ when: "Sun 15 Nov", local: "2026-11-15" }], clashes: [{ when: "Fri 13 Nov", busy: ["Corie"] }], checked: ["You", "Corie"], failed: [], meConnected: true, single: false }) }));
await page.route("**/api/ics?**", r => { icsHits.push(r.request().url()); r.fulfill({ status: 204, body: "" }); });
await page.goto(BASE + "/"); await page.waitForSelector(".card"); await page.evaluate(() => localStorage.setItem("so.tipsSeen", "1"));
await page.click('#sheetHost [data-close]', { timeout: 3000 }).catch(() => {});
await check("event page has a 'When can we go?' button", async () => { await page.evaluate(id => window.__app.openSheet(id), EVENTS[3].id); assert(await page.isVisible('.sheet [data-act="when"]')); });
await check("no calendar yet → offers to connect, with iPhone steps", async () => { await page.click('.sheet [data-act="when"]'); await page.waitForSelector('#whenPanel [data-act="calconnect"]'); await page.click('#whenPanel [data-act="calconnect"]'); await page.waitForSelector("#icsForm"); const t = await page.textContent("#sheetHost"); assert(/Public Calendar/.test(t) && /Google Calendar/.test(t) && /never stores/.test(t)); await page.click('#sheetHost .iconbtn[data-close]'); });
await check("with calendars → best date, alternatives and clashes; Book it adds that date", async () => { calMode = "ok"; await page.evaluate(id => window.__app.openSheet(id), EVENTS[3].id); await page.click('.sheet [data-act="when"]'); await page.waitForSelector(".whenbest"); const t = await page.textContent("#whenPanel"); assert(/Sat 14 Nov/.test(t) && /both free/.test(t) && /Sun 15 Nov/.test(t) && /Corie busy/.test(t), t); await page.click('.whenbest [data-act="bookon"]'); await page.waitForTimeout(600); assert(icsHits.some(u => u.includes("on=2026-11-14")), icsHits.join(",")); });
await page.context().close();

// 2. Brand-new user arriving from a friend's invite link
page = await newPage("newuser", { mobile: true });
await page.goto(BASE + "/?invite=FRNDCODE");
await check("new user sees open sign-up (no invite-only wall)", async () => { await page.waitForSelector("#nm", { timeout: 8000 }); const t = await page.textContent("#gate"); assert(!/invite-only/i.test(t)); assert(/invited by a friend/i.test(t), t.slice(0, 200)); });
await check("sign-up creates a household connected to the inviter", async () => { await page.fill("#nm", "Corie"); await page.click('#f button[type=submit]'); await page.waitForTimeout(800); const c = calls.filter(c => c.rpc === "create_household").pop(); assert(c && c.body.p_invite === "FRNDCODE" && c.body.p_name === "Corie", JSON.stringify(c)); });
await page.context().close();
page = await newPage("newuser", { mobile: true });
await page.goto(BASE + "/");
await check("wrong partner code shows a clear message", async () => { await page.waitForSelector("#obJoin"); await page.click("#obJoin"); await page.fill("#nm", "Corie"); await page.fill("#jc", "WRONG123"); await page.click('#f button[type=submit]'); await page.waitForSelector(".ob-msg"); assert(/couldn't find that household code/i.test(await page.textContent(".ob-msg"))); });
await page.context().close();

// 3. Admin dashboard (desktop)
page = await newPage("admin");
await page.goto(BASE + "/admin.html");
await check("admin overview loads with KPIs", async () => { await page.waitForSelector(".kpi", { timeout: 8000 }); const t = await page.textContent("#main"); assert(/accounts/.test(t) && /Last morning scan/.test(t)); });
await check("admin users table + person drawer with history", async () => { await page.click('[data-tab="users"]'); await page.waitForSelector("tr.click"); await page.click("tr.click"); await page.waitForSelector(".drawer"); const t = await page.textContent(".drawer"); assert(/Everything they did/.test(t) && /keen/.test(t) && /Move to household/.test(t)); await page.click('.drawer .btn[data-close]'); });
await check("admin events + messages tabs", async () => { await page.click('[data-tab="events"]'); await page.waitForSelector("#days"); await page.click('[data-tab="messages"]'); await page.waitForSelector(".msg"); assert(/Moods/.test(await page.textContent("#main"))); });
await page.screenshot({ path: path.join(ROOT, "test/screens/admin.png"), fullPage: false }).catch(() => {});
await page.context().close();
page = await newPage("member");
await page.goto(BASE + "/admin.html");
await check("non-admins are turned away from the admin page", async () => { await page.waitForSelector(".center"); assert(/Admins only/.test(await page.textContent(".center"))); });
await page.context().close();

// 4. Public share page
page = await newPage("member");
const r = await page.goto(BASE + "/e/" + encodeURIComponent(EVENTS[2].id));
await check("shared link page renders with a preview card (OG tags)", async () => { assert(r.status() === 200); const og = await page.getAttribute('meta[property="og:title"]', "content"); assert(og === EVENTS[2].title, og); assert(await page.isVisible("#listen")); });
const r2 = await page.goto(BASE + "/e/does-not-exist");
await check("shared link to a finished event says so", async () => { assert(r2.status() === 404 && /finished/.test(await page.textContent("h1"))); });
await page.context().close();

await check("no JavaScript errors", async () => { assert(!errors.length, errors.slice(0, 5).join(" | ")); });
await browser.close(); server.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter(r => r[0] === "FAIL").length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
