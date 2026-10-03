// Live ticket check for one event: reads the seller's page and returns dates, prices and availability.
// Results are cached at the edge for 30 minutes so sellers' sites are not hit on every tap.
const { extract, liveAllowed, hostOf, robotsAllows } = require("../lib/tickets");

const URL_ = "https://vwqtpffnsfyazyezfcdt.supabase.co";
const KEY = "sb_publishable_CjjnuiiC3NX0OIlj2fyS2A_NyJ177I4";
const AGENT = "SwissOutingsBot/1.0 (+https://swiss-outings.vercel.app; family events app, one request per ticket check)";

function safeUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol !== "https:" || x.username || x.password || (x.port && x.port !== "443")) return null;
    const h = x.hostname.toLowerCase();
    if (!h.includes(".") || /^[\d.]+$/.test(h) || h.includes(":") || /(^|\.)(localhost|local|internal|lan)$/.test(h)) return null;
    return x;
  } catch (e) { return null; }
}
async function get(u, ms, maxBytes) {
  // Follow redirects by hand so every hop is validated.
  let url = safeUrl(u);
  for (let hop = 0; url && hop < 4; hop++) {
    const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(ms), headers: { "User-Agent": AGENT, "Accept": "text/html,text/plain;q=0.9", "Accept-Language": "de-CH,de;q=0.9,en;q=0.8" } });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = safeUrl(new URL(r.headers.get("location"), url).href); continue; }
    const text = r.ok ? (await r.text()).slice(0, maxBytes) : "";
    return { status: r.status, text, url: url.href };
  }
  return { status: 0, text: "", url: "" };
}
async function allowedByRobots(u) {
  const x = safeUrl(u); if (!x) return false;
  try {
    const r = await get(x.origin + "/robots.txt", 3000, 200000);
    if (r.status === 401 || r.status === 403) return false;
    if (r.status !== 200) return true;
    return robotsAllows(r.text, x.pathname + x.search, "swissoutingsbot");
  } catch (e) { return true; }
}

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || "");
  if (!/^[A-Za-z0-9_.~:@+-]{1,200}$/.test(id)) { res.status(400).json({ error: "bad id" }); return; }
  let e;
  try {
    const r = await fetch(`${URL_}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
    const rows = r.ok ? await r.json() : [];
    if (!rows.length) { res.status(404).json({ error: "not found" }); return; }
    e = rows[0].data;
  } catch (err) { res.status(502).json({ error: "database unavailable" }); return; }

  const out = { id, checkedAt: new Date().toISOString(), live: null, reason: null, checkoutUrl: e.ticketUrl || e.url || null, seller: hostOf(e.ticketUrl || e.url || "") };
  const candidates = [...new Set([e.ticketUrl, e.url].filter(Boolean))];
  let blocked = 0, tried = 0;
  for (const u of candidates) {
    if (!safeUrl(u)) continue;
    if (!liveAllowed(u)) { blocked++; continue; }
    try {
      if (!(await allowedByRobots(u))) { blocked++; continue; }
      tried++;
      const page = await get(u, 7000, 1500000);
      if (page.status !== 200 || !page.text) continue;
      const info = extract(page.text, e, page.url || u);
      if (info) { out.live = info; break; }
    } catch (err) { /* timeout or network error: try the next page */ }
  }
  if (!out.live) out.reason = blocked && !tried ? "blocked" : tried ? "unreadable" : "no-link";

  res.setHeader("Cache-Control", out.live ? "public, s-maxage=1800, stale-while-revalidate=3600" : "public, s-maxage=600, stale-while-revalidate=1800");
  res.status(200).json(out);
};
