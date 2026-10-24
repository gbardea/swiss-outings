// "When can we go?" — connect a calendar and find free dates for an event.
//   POST /api/cal?action=when          {event_id}   → best free date(s) for everyone in the household with a calendar
//   POST /api/cal?action=link          {url}        → save a private calendar link (iCloud / Outlook / Google secret address)
//   POST /api/cal?action=google-start               → {url} to Google's consent screen (read-only free/busy)
//   GET  /api/cal?action=google-callback&code&state → stores the Google connection, back to the app
// Signed-in users only (Supabase access token in Authorization). Calendar data is never stored, only the encrypted connection.
// Env: CAL_ENC_KEY (32 random bytes, base64), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SITE_URL (optional)
const C = require("../lib/calendar");
const SB = "https://vwqtpffnsfyazyezfcdt.supabase.co";
const SB_KEY = "sb_publishable_CjjnuiiC3NX0OIlj2fyS2A_NyJ177I4";
const SITE = process.env.SITE_URL || "https://www.swissoutings.com";
const REDIRECT = SITE + "/api/cal?action=google-callback";
const SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

const bearer = req => { const h = String(req.headers.authorization || ""); return /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(h) ? h : null; };
async function sbUser(auth) { const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: auth }, signal: AbortSignal.timeout(5000) }); return r.ok ? r.json() : null; }
async function rpc(auth, fn, args) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SB_KEY, Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(args || {}), signal: AbortSignal.timeout(6000) });
  if (!r.ok) throw new Error(fn + " " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function loadEvent(id) {
  const r = await fetch(`${SB}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(5000) });
  const rows = r.ok ? await r.json() : []; return rows.length ? Object.assign({}, rows[0].data, { id }) : null;
}
async function fetchIcs(url) {
  const ok = C.icsUrlOk(url); if (!ok) throw new Error("not an allowed calendar link");
  const r = await fetch(ok, { redirect: "follow", signal: AbortSignal.timeout(9000), headers: { Accept: "text/calendar" } });
  if (!r.ok) throw new Error("calendar link answered " + r.status);
  if (r.url && !C.icsUrlOk(r.url)) throw new Error("calendar link redirected somewhere unexpected");
  const text = (await r.text()).slice(0, 6e6);
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("that link isn't a calendar feed");
  return text;
}
async function googleBusy(refreshToken, from, to) {
  const t = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }) });
  if (!t.ok) throw new Error("google token " + t.status);
  const { access_token } = await t.json();
  const out = [];
  for (let a = from; a < to; a += 85 * 864e5) { // Google limits one query to ~3 months
    const r = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", { method: "POST", signal: AbortSignal.timeout(8000), headers: { Authorization: "Bearer " + access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin: new Date(a).toISOString(), timeMax: new Date(Math.min(to, a + 85 * 864e5)).toISOString(), items: [{ id: "primary" }] }) });
    if (!r.ok) throw new Error("google freebusy " + r.status);
    const j = await r.json();
    for (const b of (j.calendars && j.calendars.primary && j.calendars.primary.busy) || []) out.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
  }
  return out;
}
function json(res, status, o) { res.setHeader("Cache-Control", "no-store"); res.status(status).json(o); }
function body(req) { let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } return b || {}; }

module.exports = async (req, res) => {
  const action = String((req.query && req.query.action) || "");
  try {
    if (action === "google-callback") {
      const q = req.query || {};
      let st; try { st = C.open(q.state); } catch (e) { st = null; }
      if (!st || st.exp < Date.now() || !q.code) { res.redirect ? res.redirect(302, SITE + "/?cal=error") : (res.setHeader("Location", SITE + "/?cal=error"), res.status(302).send("")); return; }
      const t = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(8000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: String(q.code), client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: "authorization_code" }) });
      const tok = t.ok ? await t.json() : {};
      let dest = SITE + "/?cal=error";
      if (tok.refresh_token) { await rpc(st.auth, "save_calendar_link", { p_provider: "google", p_secret: C.seal({ rt: tok.refresh_token }), p_label: "Google Calendar" }); dest = SITE + "/?cal=connected"; }
      res.setHeader("Location", dest); res.setHeader("Cache-Control", "no-store"); res.status(302).send(""); return;
    }
    if (req.method !== "POST") return json(res, 405, { error: "POST only" });
    const auth = bearer(req); const user = auth && await sbUser(auth);
    if (!user || !user.id) return json(res, 401, { error: "Please sign in again." });
    const b = body(req);

    if (action === "google-start") {
      if (!process.env.GOOGLE_CLIENT_ID) return json(res, 501, { error: "Google Calendar isn't set up yet. Use the calendar-link option instead." });
      const state = C.seal({ auth, exp: Date.now() + 20 * 60e3 });
      const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: REDIRECT, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
      return json(res, 200, { url });
    }
    if (action === "link") {
      const url = C.icsUrlOk(b.url);
      if (!url) return json(res, 400, { error: "That doesn't look like a private calendar link from iCloud, Google or Outlook. Check the steps and paste the full link." });
      try { const text = await fetchIcs(url); C.busyFromIcs(text, Date.now(), Date.now() + 864e5); }
      catch (e) { return json(res, 400, { error: "We couldn't read that calendar link (" + e.message + "). Check it's switched on and copied completely." }); }
      const host = new URL(url).hostname, labelTxt = /icloud/.test(host) ? "iPhone / iCloud calendar" : /google/.test(host) ? "Google Calendar (link)" : "Outlook calendar";
      await rpc(auth, "save_calendar_link", { p_provider: "ics", p_secret: C.seal({ url }), p_label: labelTxt });
      return json(res, 200, { ok: true, label: labelTxt });
    }
    if (action === "when") {
      const id = String(b.event_id || "");
      if (!/^[A-Za-z0-9_.~:@+-]{1,200}$/.test(id)) return json(res, 400, { error: "bad event" });
      const [e, cals] = await Promise.all([loadEvent(id), rpc(auth, "household_calendars")]);
      if (!e) return json(res, 404, { error: "That event has finished or was removed." });
      const cand = C.slots(e);
      if (!cand.length) return json(res, 200, { past: true });
      if (!cals || !cals.length) return json(res, 200, { needsConnect: true, dates: cand.length });
      const from = cand[0].start - 4 * 3600e3, to = cand[cand.length - 1].end + 4 * 3600e3;
      const members = await Promise.all(cals.map(async c => {
        const name = c.user_id === user.id ? "You" : (c.name || "Partner");
        try { const s = C.open(c.secret); const busy = c.provider === "google" ? await googleBusy(s.rt, from, to) : C.busyFromIcs(await fetchIcs(s.url), from, to); return { name, ok: true, busy, me: c.user_id === user.id }; }
        catch (err) { console.warn("cal", c.provider, err && err.message); return { name, ok: false, busy: [], me: c.user_id === user.id }; }
      }));
      const r = C.rank(e, cand, members);
      return json(res, 200, Object.assign(r, { checked: members.filter(m => m.ok).map(m => m.name), failed: members.filter(m => !m.ok).map(m => m.name), meConnected: members.some(m => m.me), single: cand.length === 1 }));
    }
    return json(res, 400, { error: "unknown action" });
  } catch (err) {
    console.warn("cal error", action, err && err.message);
    return json(res, 500, { error: "Something went wrong checking calendars. Please try again." });
  }
};
