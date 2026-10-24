// "When can we go?": candidate dates for an event, busy times from calendars, and the ranking.
"use strict";
const crypto = require("crypto");
const ICAL = require("ical.js");

/* ---------- encryption for stored calendar secrets (AES-256-GCM, key only on the server) ---------- */
function key() {
  const k = Buffer.from(process.env.CAL_ENC_KEY || "", "base64");
  if (k.length !== 32) throw new Error("CAL_ENC_KEY missing or not 32 bytes (base64)");
  return k;
}
function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function open(s) {
  const b = Buffer.from(String(s || ""), "base64url");
  const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
}

/* ---------- Zurich local time <-> UTC ---------- */
const ZFMT = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
function zparts(ms) { const p = Object.fromEntries(ZFMT.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: p.weekday }; }
function zurich(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess;
  for (let i = 0; i < 2; i++) { const p = zparts(t); const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi); t = t - (asUtc - guess); }
  return t;
}
function parseLocal(s) { const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/); return m ? { y: +m[1], mo: +m[2], d: +m[3], h: m[4] != null ? +m[4] : null, mi: m[5] != null ? +m[5] : 0 } : null; }
const DOW = { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" };
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function label(ms, allDay) { const p = zparts(ms); return `${DOW[p.wd]} ${p.d} ${MON[p.mo - 1]}` + (allDay ? "" : `, ${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`); }
function localIso(ms, allDay) { const p = zparts(ms); const d = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; return allDay ? d : `${d}T${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`; }

/* ---------- candidate dates for an event ---------- */
const BUFFER_MIN = { "Zurich City": 40, "Gold Coast": 30, "Canton Zurich": 60, "Switzerland": 120 };
function durationMin(e) {
  const s = parseLocal(e.start), en = parseLocal(e.end);
  if (s && en && s.h != null && en.h != null && s.y === en.y && s.mo === en.mo && s.d === en.d) { const m = (en.h * 60 + en.mi) - (s.h * 60 + s.mi); if (m > 0) return m; }
  return 150;
}
function dayWindow(e) { // when to go on a day of a multi-day event without a fixed time
  const a = e.audience || [];
  if (a.length && a.every(x => x === "Parents")) return [18, 30, 22, 0];
  return [10, 0, 17, 0];
}
function slots(e, now = Date.now(), maxDays = 90) {
  const out = [], dur = durationMin(e) * 60e3;
  const perfs = (e.ticketInfo && Array.isArray(e.ticketInfo.performances) ? e.ticketInfo.performances : []).map(p => parseLocal(p && p.start)).filter(Boolean);
  if (perfs.length > 1) {
    for (const p of perfs) { if (p.h == null) { const s = zurich(p.y, p.mo, p.d, 10), en = zurich(p.y, p.mo, p.d, 18); out.push({ start: s, end: en, allDay: true }); } else { const s = zurich(p.y, p.mo, p.d, p.h, p.mi); out.push({ start: s, end: s + dur, allDay: false }); } }
  } else {
    const s = parseLocal(e.start); if (!s) return [];
    const en = parseLocal(e.end) || s;
    const multi = Date.UTC(en.y, en.mo - 1, en.d) > Date.UTC(s.y, s.mo - 1, s.d);
    if (!multi) {
      if (s.h != null && e.timeKnown !== false) { const st = zurich(s.y, s.mo, s.d, s.h, s.mi); out.push({ start: st, end: st + dur, allDay: false }); }
      else out.push({ start: zurich(s.y, s.mo, s.d, 10), end: zurich(s.y, s.mo, s.d, 18), allDay: true });
    } else {
      const [h1, m1, h2, m2] = s.h != null && e.timeKnown ? [s.h, s.mi, Math.min(23, s.h + Math.ceil(dur / 3600e3)), s.mi] : dayWindow(e);
      const today = zparts(now);
      let day = Date.UTC(s.y, s.mo - 1, s.d);
      const startFrom = Math.max(day, Date.UTC(today.y, today.mo - 1, today.d)), last = Math.min(Date.UTC(en.y, en.mo - 1, en.d), startFrom + maxDays * 864e5);
      for (day = startFrom; day <= last; day += 864e5) { const x = new Date(day); out.push({ start: zurich(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), h1, m1), end: zurich(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate(), h2, m2), allDay: !(s.h != null && e.timeKnown) }); }
    }
  }
  return out.filter(x => x.end > now).sort((a, b) => a.start - b.start).slice(0, 120);
}

/* ---------- busy times from an .ics feed (iCloud / Outlook / Google secret link) ---------- */
const ICS_HOSTS = /(^|\.)(icloud\.com|calendar\.google\.com|outlook\.office365\.com|outlook\.live\.com|outlook\.office\.com|calendar\.yahoo\.com|fastmail\.com|proton\.me)$/i;
function icsUrlOk(u) {
  try {
    const x = new URL(String(u).trim().replace(/^webcals?:\/\//i, "https://"));
    if (x.protocol !== "https:" || x.username || x.password || (x.port && x.port !== "443")) return null;
    return ICS_HOSTS.test(x.hostname) ? x.href : null;
  } catch (e) { return null; }
}
function timeToMs(t) {
  if (t.isDate) return zurich(t.year, t.month, t.day, 0, 0);
  const z = t.zone && t.zone.tzid;
  if (z === "UTC" || z === "Z") return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (z && z !== "floating" && ICAL.TimezoneService.has(z)) return t.toUnixTime() * 1000;
  return zurich(t.year, t.month, t.day, t.hour, t.minute); // floating or unknown zone: treat as Zurich time
}
function busyFromIcs(text, from, to) {
  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents("vtimezone")) { try { const z = new ICAL.Timezone(tz); if (!ICAL.TimezoneService.has(z.tzid)) ICAL.TimezoneService.register(z.tzid, z); } catch (e) {} }
  const all = comp.getAllSubcomponents("vevent"), byUid = {}, busy = [];
  for (const v of all) if (v.hasProperty("recurrence-id")) (byUid[v.getFirstPropertyValue("uid")] = byUid[v.getFirstPropertyValue("uid")] || []).push(v);
  const skip = v => String(v.getFirstPropertyValue("transp") || "").toUpperCase() === "TRANSPARENT" || String(v.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED";
  const add = (s, e) => { if (e > from && s < to) busy.push({ start: s, end: Math.max(e, s + 60e3) }); };
  for (const v of all) {
    if (v.hasProperty("recurrence-id")) continue;
    let ev; try { ev = new ICAL.Event(v, { strictExceptions: false }); } catch (e) { continue; }
    for (const x of byUid[ev.uid] || []) { try { ev.relateException(x); } catch (e) {} }
    if (!ev.startDate) continue;
    if (ev.isRecurring()) {
      const it = ev.iterator(); let n = 0, t;
      while ((t = it.next()) && n++ < 3000) {
        const s0 = timeToMs(t); if (s0 > to) break;
        const o = ev.getOccurrenceDetails(t); if (skip(o.item.component)) continue;
        add(timeToMs(o.startDate), timeToMs(o.endDate));
      }
    } else if (!skip(v)) {
      const s = timeToMs(ev.startDate); const e = ev.endDate ? timeToMs(ev.endDate) : (ev.startDate.isDate ? s + 864e5 : s + 3600e3);
      add(s, e);
    }
  }
  return busy;
}

/* ---------- ranking ---------- */
function preferred(e, s) {
  const p = zparts(s.start), a = e.audience || [], weekend = p.wd === "Sat" || p.wd === "Sun";
  if (a.includes("Kids") || a.includes("Family")) return weekend ? 2 : 0;
  if (a.every(x => x === "Parents")) return (p.wd === "Fri" || p.wd === "Sat") ? 1 : 0;
  return weekend ? 1 : 0;
}
// members: [{name, busy:[{start,end}], ok:true}] ; returns ranked free + clashing options
function rank(e, cand, members) {
  const buf = (BUFFER_MIN[e.region] || 60) * 60e3;
  const scored = cand.map(s => {
    const busyNames = members.filter(m => m.ok && m.busy.some(b => b.start < s.end + buf && b.end > s.start - buf)).map(m => m.name);
    return { start: s.start, allDay: s.allDay, when: label(s.start, s.allDay), local: localIso(s.start, s.allDay), free: busyNames.length === 0, busy: busyNames, pref: preferred(e, s) };
  });
  const free = scored.filter(x => x.free);
  const soon = free.filter(x => x.start < Date.now() + 45 * 864e5);
  const best = (soon.length ? soon : free).slice().sort((a, b) => b.pref - a.pref || a.start - b.start)[0] || null;
  const more = free.filter(x => x !== best).slice(0, 3);
  const clashes = scored.filter(x => !x.free).slice(0, best ? 2 : 4);
  return { best, more, clashes, total: scored.length, freeCount: free.length };
}

module.exports = { seal, open, zurich, zparts, slots, busyFromIcs, icsUrlOk, rank, label };
