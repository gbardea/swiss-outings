// Returns one event as an .ics file so iPhone/Android open "Add to Calendar".
const URL_ = "https://vwqtpffnsfyazyezfcdt.supabase.co";
const KEY = "sb_publishable_CjjnuiiC3NX0OIlj2fyS2A_NyJ177I4";
const pad = n => String(n).padStart(2, "0");
function parse(s){ const m=String(s||"").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/); if(!m) return null; return {y:+m[1],mo:+m[2],d:+m[3],h:m[4]!=null?+m[4]:null,mi:m[5]!=null?+m[5]:0}; }
const dStr = p => `${p.y}${pad(p.mo)}${pad(p.d)}`;
const tStr = p => `${dStr(p)}T${pad(p.h)}${pad(p.mi)}00`;
function addDays(p,n){ const x=new Date(Date.UTC(p.y,p.mo-1,p.d+n)); return {y:x.getUTCFullYear(),mo:x.getUTCMonth()+1,d:x.getUTCDate(),h:p.h,mi:p.mi}; }
function addHours(p,n){ const x=new Date(Date.UTC(p.y,p.mo-1,p.d,p.h+n,p.mi)); return {y:x.getUTCFullYear(),mo:x.getUTCMonth()+1,d:x.getUTCDate(),h:x.getUTCHours(),mi:x.getUTCMinutes()}; }
const days = (a,b) => Math.round((Date.UTC(b.y,b.mo-1,b.d)-Date.UTC(a.y,a.mo-1,a.d))/864e5);
const esc = s => String(s||"").replace(/\\/g,"\\\\").replace(/;/g,"\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n");
function fold(line){ const out=[]; let cur=""; for(const ch of line){ if(Buffer.byteLength(cur+ch)>73){ out.push(cur); cur=" "+ch; } else cur+=ch; } out.push(cur); return out.join("\r\n"); }

module.exports = async (req, res) => {
  const id = String((req.query && req.query.id) || "");
  if (!/^[A-Za-z0-9_.~:@+-]{1,200}$/.test(id)) { res.status(400).send("bad id"); return; }
  const r = await fetch(`${URL_}/rest/v1/events?id=eq.${encodeURIComponent(id)}&select=data`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  const rows = r.ok ? await r.json() : [];
  if (!rows.length) { res.status(404).send("not found"); return; }
  const e = rows[0].data;
  const s = parse(e.start), en0 = parse(e.end);
  const hasTime = e.timeKnown && s.h != null;
  const span = en0 ? days(s, en0) : 0;
  let start, end;
  if (!hasTime || (span > 0 && en0 && en0.h == null)) {
    start = `DTSTART;VALUE=DATE:${dStr(s)}`;
    end = `DTEND;VALUE=DATE:${dStr(addDays(span > 14 || !en0 ? s : en0, 1))}`;
  } else {
    let en = (en0 && en0.h != null && span <= 1) ? en0 : addHours(s, span > 1 ? 3 : 2);
    start = `DTSTART;TZID=Europe/Zurich:${tStr(s)}`; end = `DTEND;TZID=Europe/Zurich:${tStr(en)}`;
  }
  const price = e.free ? "Free" : (e.priceText || "Price TBA");
  const desc = [e.summary, "", e.description, "", "Price: " + price, e.ticketUrl ? "Tickets: " + e.ticketUrl : "", e.url ? "More: " + e.url : ""].join("\n");
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const L = ["BEGIN:VCALENDAR","PRODID:-//Swiss Outings//EN","VERSION:2.0","CALSCALE:GREGORIAN","METHOD:PUBLISH",
    "BEGIN:VTIMEZONE","TZID:Europe/Zurich","BEGIN:DAYLIGHT","TZOFFSETFROM:+0100","TZOFFSETTO:+0200","TZNAME:CEST","DTSTART:19700329T020000","RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU","END:DAYLIGHT","BEGIN:STANDARD","TZOFFSETFROM:+0200","TZOFFSETTO:+0100","TZNAME:CET","DTSTART:19701025T030000","RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU","END:STANDARD","END:VTIMEZONE",
    "BEGIN:VEVENT", `UID:${id}@swiss-outings`, `DTSTAMP:${now}`, start, end,
    "SUMMARY:" + esc(e.title), "LOCATION:" + esc([e.venue, e.address || e.city].filter(Boolean).join(", ")), "DESCRIPTION:" + esc(desc),
    e.url ? "URL:" + e.url : null,
    "BEGIN:VALARM","ACTION:DISPLAY","DESCRIPTION:" + esc(e.title),"TRIGGER:-P1D","END:VALARM","END:VEVENT","END:VCALENDAR"].filter(Boolean);
  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${id}.ics"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(L.map(fold).join("\r\n") + "\r\n");
};
