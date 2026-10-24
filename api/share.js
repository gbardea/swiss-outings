// Public page for a shared event link (/e/<id>): readable by anyone, with a WhatsApp/iMessage preview card.
const { voiceVersion } = require("../lib/voice");
const URL_ = "https://vwqtpffnsfyazyezfcdt.supabase.co";
const KEY = "sb_publishable_CjjnuiiC3NX0OIlj2fyS2A_NyJ177I4";
const SITE = "https://www.swissoutings.com";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safe = u => /^https?:\/\//i.test(String(u || "")) ? String(u) : "";
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function parse(s){ const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/); return m?{y:+m[1],mo:+m[2],d:+m[3],h:m[4],mi:m[5]}:null; }
function day(p){ const w=new Date(Date.UTC(p.y,p.mo-1,p.d)).getUTCDay(); return `${DOW[w]} ${p.d} ${MON[p.mo-1]} ${p.y}`; }
function when(e){ const s=parse(e.start), en=parse(e.end); if(!s) return ""; if(en && (en.y!==s.y||en.mo!==s.mo||en.d!==s.d)) return `${day(s)} – ${day(en)}`; return day(s)+(e.timeKnown&&s.h?` · ${s.h}:${s.mi}`:""); }
function price(e){ if(e.free) return "Free"; const a=e.priceFromCHF,b=e.priceToCHF; if(a!=null&&a!==""&&+a>0) return (b!=null&&b!==""&&+b>+a)?`CHF ${a}–${b}`:`From CHF ${a}`; return e.priceText||""; }
function page(title, desc, url, body){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Swiss Outings</title><meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Swiss Outings"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(url)}"><meta property="og:image" content="${SITE}/icons/icon-512.png">
<meta name="twitter:card" content="summary"><link rel="icon" href="/icons/icon-192.png"><meta name="theme-color" content="#D52B1E">
<style>:root{--bg:#EEF1EE;--s:#fff;--ink:#14181D;--mu:#5A646D;--line:#D6DCD7;--acc:#1D4ED8}@media (prefers-color-scheme:dark){:root{--bg:#0F1215;--s:#171B20;--ink:#EDF0ED;--mu:#98A2AB;--line:#2A3138;--acc:#86A4FF}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:620px;margin:0 auto;padding:20px 16px 40px}
.brand{display:flex;align-items:center;gap:10px;font-weight:900;font-size:20px;text-decoration:none;color:inherit}.x{width:28px;height:28px;border-radius:7px;background:#D52B1E;display:grid;place-items:center}
.card{background:var(--s);border:1px solid var(--line);border-radius:16px;padding:20px;margin-top:18px}h1{font-size:28px;line-height:1.15;margin:0 0 6px}.meta{color:var(--mu);margin:2px 0}.price{display:inline-block;background:#FFE14D;color:#14181D;font-weight:800;border-radius:7px;padding:4px 9px;margin:10px 0}
.lede{font-size:18px}.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.btn{flex:1 1 auto;text-align:center;padding:12px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-weight:700;text-decoration:none;cursor:pointer;font-size:15px}.btn.p{background:var(--acc);color:#fff;border-color:var(--acc)}
.join{margin-top:18px;background:var(--s);border:1px solid var(--line);border-radius:16px;padding:18px}.join p{margin:4px 0 12px;color:var(--mu)}</style></head>
<body><main><a class="brand" href="/"><span class="x"><svg width="14" height="14" viewBox="0 0 12 12"><path d="M4.5 1h3v3.5H11v3H7.5V11h-3V7.5H1v-3h3.5z" fill="#fff"/></svg></span>Swiss Outings</a>${body}</main></body></html>`;
}

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!/^[A-Za-z0-9_.~:@+-]{1,200}$/.test(id)) { res.status(404).send(page("Event not found", "", SITE, `<div class="card"><h1>Event not found</h1><p><a href="/">See what's on</a></p></div>`)); return; }
  let e = null;
  try { const r = await fetch(`${URL_}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(5000) }); const rows = r.ok ? await r.json() : []; if (rows.length) e = Object.assign({}, rows[0].data, { id }); } catch (x) {}
  if (!e) { res.setHeader("Cache-Control", "public, s-maxage=300"); res.status(404).send(page("This event has finished", "Find what's on next across Switzerland.", SITE, `<div class="card"><h1>This event has finished</h1><p class="meta">Or it was removed by the organiser.</p><div class="btns"><a class="btn p" href="/">See what's on now</a></div></div>`)); return; }
  const url = `${SITE}/e/${encodeURIComponent(id)}`, w = when(e), where = [e.venue, e.city && !(e.venue || "").includes(e.city) ? e.city : ""].filter(Boolean).join(", ");
  const desc = [w, where, price(e), e.summary].filter(Boolean).join(" · ").slice(0, 300);
  const tix = safe(e.ticketUrl), off = safe(e.url);
  const body = `<article class="card"><h1>${esc(e.title)}</h1><p class="meta">${esc(w)}</p><p class="meta">${esc(where)}${e.address ? " · " + esc(e.address) : ""}</p>
    ${price(e) ? `<span class="price">${esc(price(e))}</span>` : ""}<p class="lede">${esc(e.summary)}</p><p>${esc(e.description)}</p>
    <div class="btns"><button class="btn" id="listen" type="button">🔊 Listen (20 sec)</button><a class="btn" href="/api/ics?id=${encodeURIComponent(id)}">📅 Add to calendar</a>
    ${tix && e.ticketStatus !== "free entry" ? `<a class="btn" href="${esc(tix)}" rel="noopener" target="_blank">🎟 Tickets</a>` : off ? `<a class="btn" href="${esc(off)}" rel="noopener" target="_blank">Official page</a>` : ""}</div></article>
    <section class="join"><b>Plan it together on Swiss Outings</b><p>Concerts, carnivals, cow parades and family days out across Switzerland, found every morning. Free.</p><a class="btn p" style="display:block" href="/?e=${encodeURIComponent(id)}">Open in Swiss Outings</a></section>
    <script>(function(){var a=null,b=document.getElementById("listen");b.onclick=function(){if(a&&!a.paused){a.pause();b.textContent="🔊 Listen (20 sec)";return;}a=a||new Audio("/api/voice?id=${encodeURIComponent(id)}&v=${voiceVersion(e)}");b.textContent="⏸ Playing… tap to stop";a.onended=function(){b.textContent="🔊 Listen (20 sec)"};a.onerror=function(){fetch(a.src).then(function(r){return r.json()}).then(function(j){if(!window.speechSynthesis)return;var u=new SpeechSynthesisUtterance(j.script);u.lang="en-GB";u.onend=a.onended;speechSynthesis.speak(u)}).catch(a.onended)};a.play().catch(function(){});}})();</script>`;
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=600");
  res.status(200).send(page(e.title, desc, url, body));
};
