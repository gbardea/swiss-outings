// Shared test harness: serves public/ + api/ locally and fakes Supabase in the browser (used by e2e.mjs and shots.mjs).
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
globalThis.fetch = async (url, opts) => { // server-side calls from api/* to Supabase
  const u = String(url);
  if (u.startsWith(SB + "/rest/v1/events")) { const id = decodeURIComponent((u.match(/id=eq\.([^&]+)/) || [])[1] || ""); const e = EVENTS.find(x => x.id === id); return new Response(JSON.stringify(e ? [{ data: e }] : []), { status: 200, headers: { "content-type": "application/json" } }); }
  if (u.startsWith(SB + "/auth/v1/user")) return new Response("{}", { status: 200 });
  if (u.startsWith(SB + "/rest/v1/rpc/trip_public")) { const tok = JSON.parse(opts.body).p_token; const t = DB.trips.find(x => x.share_token === tok); return new Response(JSON.stringify(t ? { title: t.title, day: t.day, done: t.done, plan: Object.assign({}, t.plan, { start: undefined, who: undefined, params: undefined }) } : null), { status: 200 }); }
  throw new Error("blocked " + u);
};
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  let p = u.pathname;
  const m = p.match(/^\/e\/(.+)$/); if (m) p = "/api/share", u.searchParams.set("id", decodeURIComponent(m[1]));
  const mt = p.match(/^\/t\/(.+)$/); if (mt) p = "/api/share", u.searchParams.set("trip", decodeURIComponent(mt[1]));
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
const DB = { trips: [], settings: null };
function rest(table, method, url, body) {
  if (table === "household_settings") { if (method === "POST") { DB.settings = Object.assign({}, DB.settings, body); return null; } return DB.settings; }
  if (table === "trips") {
    if (method === "POST") { const t = Object.assign({ id: "trip-" + (DB.trips.length + 1), share_token: "a".repeat(31) + (DB.trips.length + 1), done: [] }, body); DB.trips.push(t); return t; }
    if (method === "PATCH") { const id = (url.match(/id=eq\.([^&]+)/) || [])[1]; const t = DB.trips.find(x => x.id === decodeURIComponent(id || "")); if (t) Object.assign(t, body); return null; }
    return DB.trips;
  }
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
  coverage: () => ({ events: 1706, venues: 827, towns: 270, new7: 297, free: 308, gems: 1368, kids: 845, months: 13, categories: { Music: 753, Kids: 173, Outdoors: 124 }, regions: { "Zurich City": 777, "Gold Coast": 88, "Canton Zurich": 279, "Switzerland": 562 }, tags: { village: 275, nature: 147, wildlife: 73, stargazing: 18, "guided hike": 49, "hands-on": 146, "small venue": 780 }, sources: 343, sourceGroups: { zurich: 132, nature: 101, niche: 110 }, lastRun: new Date().toISOString(), lastAdded: "19", samples: [{ id: EVENTS[1].id, title: EVENTS[1].title, city: "Zurich", start: EVENTS[1].start, category: "Music" }] }),
  my_codes: () => [{ join_code: "JOINCODE", friend_code: "FRNDCODE" }],
  friend_picks: () => [], log_activity: b => (b.p || []).length, submit_message: () => 42, i_am_admin: () => SCENARIO === "admin", i_am_admin_account: () => SCENARIO === "admin" || SCENARIO === "admin1",
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
    if (url.startsWith(SB + "/auth/v1/factors") && method === "POST" && !/challenge|verify/.test(url)) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "f1", type: "totp", friendly_name: "x", totp: { qr_code: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/x" } }) });
    const rpc = url.match(/\/rest\/v1\/rpc\/(\w+)/);
    if (rpc) { calls.push({ rpc: rpc[1], body }); const f = RPC[rpc[1]]; return route.fulfill({ status: f ? 200 : 404, contentType: "application/json", body: JSON.stringify(f ? f(body) : { message: "no such rpc" }) }); }
    const t = url.match(/\/rest\/v1\/(\w+)/);
    if (t) { calls.push({ table: t[1], method, url }); const accept = r.headers()["accept"] || ""; let data = rest(t[1], method, url, body); if (accept.includes("vnd.pgrst.object") && Array.isArray(data)) data = data[0] ?? null; return route.fulfill({ status: data === null && accept.includes("vnd.pgrst.object") ? 406 : 200, contentType: "application/json", body: JSON.stringify(data ?? []) }); }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ sub: UID, role: "authenticated", aal: SCENARIO === "admin" ? "aal2" : "aal1", amr: [{ method: "password", timestamp: 1 }], exp: Math.floor(Date.now() / 1000) + 3600 }) + ".sig";
  const session = { access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: UID, email: "g@example.com", aud: "authenticated", role: "authenticated" } };
  await page.addInitScript(([s]) => {
    if (s) localStorage.setItem("sb-vwqtpffnsfyazyezfcdt-auth-token", s);
    window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };
    window.__spoken = []; const ss = { speak(u){ window.__spoken.push(u.text); setTimeout(()=>u.onstart&&u.onstart(), 30); }, cancel(){}, getVoices(){ return []; } };
    Object.defineProperty(window, "speechSynthesis", { value: ss, configurable: true }); window.SpeechSynthesisUtterance = class { constructor(t){ this.text=t; } };
    window.WebSocket = class { constructor() { } close() { } send() { } addEventListener() { } };
  }, [SCENARIO === "guest" ? "" : JSON.stringify(session)]);
}

/* ---------- browser pages ---------- */
const browser = await chromium.launch();
const errors = [];
async function newPage(scenario, opts = {}) {
  SCENARIO = scenario;
  const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: !!opts.mobile, hasTouch: !!opts.mobile, userAgent: opts.mobile ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" : undefined });
  await ctx.route(/\/sw\.js$/, r => r.fulfill({ status: 404, body: "" }));
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(scenario + ": " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|WebSocket|net::ERR|fonts\.g|fetching the script/.test(m.text())) errors.push(scenario + " console: " + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode/, r => r.fulfill({ status: 200, body: "" }));
  await fakeSupabase(page);
  return page;
}

export { ROOT, BASE, EVENTS, calls, errors, browser, server, newPage, DB };
