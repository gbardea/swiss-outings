// "Plan our day": scheduling, travel legs (real Swiss timetables), fares and helpers. Pure where possible so it can be tested.
"use strict";
const { zurich, zparts } = require("./calendar");

const TRANSPORT = "https://transport.opendata.ch/v1";
const GEO = "https://api3.geo.admin.ch/rest/services/api/SearchServer";

/* ---------- small helpers ---------- */
const R = 6371;
function km(a, b) { // straight-line distance
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
const hm = ms => { const p = zparts(ms); return String(p.h).padStart(2, "0") + ":" + String(p.mi).padStart(2, "0"); };
function at(day, hhmm) { const [y, m, d] = day.split("-").map(Number); const [h, mi] = String(hhmm || "10:00").split(":").map(Number); return zurich(y, m, d, h || 0, mi || 0); }
const walkMin = d => Math.max(2, Math.round(d * 1.25 / 4.5 * 60));   // 4.5 km/h, paths ~25% longer than straight line
const driveMin = d => Math.round(d * 1.3 / 45 * 60) + 10;            // incl. parking
const roundUp5 = ms => Math.ceil(ms / 300e3) * 300e3;
const stripTags = s => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/* ---------- fares (approximate: there's no free SBB price API) ---------- */
// ~CHF 0.31/km 2nd class full fare (min CHF 3.20). Half-fare card halves it. Kids under 6 free; 6–15 half price, or free with a Junior card.
function trainFare(distKm, who = {}) {
  const full = Math.max(3.2, 0.31 * distKm * 1.25);
  const adults = Math.max(1, +who.adults || 2) * (who.halfFare ? full / 2 : full);
  const kids = (who.kids || []).reduce((s, age) => s + (age < 6 ? 0 : who.junior ? 0 : full / 2), 0);
  return Math.round(adults + kids);
}
const carCost = distKm => Math.round(distKm * 1.3 * 0.7);              // fuel + wear, very rough

/* ---------- geocoding (Swiss federal geo service) ---------- */
async function geocode(q, fetchImpl = fetch) {
  const u = `${GEO}?searchText=${encodeURIComponent(String(q).slice(0, 120))}&type=locations&sr=4326&limit=6`;
  const r = await fetchImpl(u, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || []).map(x => ({ label: stripTags(x.attrs && x.attrs.label), lat: +(x.attrs && x.attrs.lat), lon: +(x.attrs && x.attrs.lon), kind: x.attrs && x.attrs.origin }))
    .filter(x => isFinite(x.lat) && isFinite(x.lon) && x.lat > 45.7 && x.lat < 47.9 && x.lon > 5.9 && x.lon < 10.6);
}

/* ---------- public transport (transport.opendata.ch, official Swiss timetable) ---------- */
async function nearestStation(p, fetchImpl = fetch) {
  const r = await fetchImpl(`${TRANSPORT}/locations?x=${p.lat}&y=${p.lon}&type=station`, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const j = await r.json();
  const s = (j.stations || []).find(s => s.id && s.coordinate && s.coordinate.x);
  return s ? { id: s.id, name: s.name, lat: s.coordinate.x, lon: s.coordinate.y } : null;
}
async function connection(fromId, toId, whenMs, arriveBy, fetchImpl = fetch) {
  const p = zparts(whenMs);
  const date = `${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`, time = hm(whenMs);
  const u = `${TRANSPORT}/connections?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}&date=${date}&time=${time}&isArrivalTime=${arriveBy ? 1 : 0}&limit=4`;
  const r = await fetchImpl(u, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) return null;
  const j = await r.json();
  const list = (j.connections || []).filter(c => c.from && c.to && c.from.departure && c.to.arrival);
  if (!list.length) return null;
  const pick = arriveBy ? list.filter(c => Date.parse(c.to.arrival) <= whenMs).pop() || list[0] : list.find(c => Date.parse(c.from.departure) >= whenMs) || list[0];
  const steps = (pick.sections || []).filter(s => s.journey).map(s => ({
    line: [s.journey.category, s.journey.number].filter(Boolean).join("") || s.journey.name || "Train",
    from: s.departure && s.departure.station && s.departure.station.name, dep: hm(Date.parse(s.departure.departure)), platform: s.departure.platform || null,
    to: s.arrival && s.arrival.station && s.arrival.station.name, arr: hm(Date.parse(s.arrival.arrival))
  }));
  return { dep: Date.parse(pick.from.departure), arr: Date.parse(pick.to.arrival), platform: pick.from.platform || null, steps, changes: Math.max(0, steps.length - 1) };
}

/* ---------- one leg between two points ---------- */
// mode: "train" | "car". Returns {mode, depart, arrive (ms), minutes, text, steps, costChf, distKm}
async function leg(a, b, whenMs, arriveBy, mode, who, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const d = km(a, b);
  if (d < 1.2) { const m = walkMin(d); const dep = arriveBy ? whenMs - m * 60e3 : whenMs; return { mode: "walk", depart: dep, arrive: dep + m * 60e3, minutes: m, distKm: +d.toFixed(1), costChf: 0, text: `Walk ${m} min` }; }
  if (mode === "car") { const m = driveMin(d); const dep = arriveBy ? whenMs - m * 60e3 : whenMs; return { mode: "car", depart: dep, arrive: dep + m * 60e3, minutes: m, distKm: +d.toFixed(1), costChf: carCost(d), text: `Drive ~${m} min (${Math.round(d * 1.3)} km) incl. parking` }; }
  try {
    const [sa, sb] = await Promise.all([nearestStation(a, fetchImpl), nearestStation(b, fetchImpl)]);
    if (!sa || !sb || sa.id === sb.id) throw new Error("no stations");
    const wa = walkMin(km(a, sa)), wb = walkMin(km(sb, b));
    const target = arriveBy ? whenMs - wb * 60e3 : whenMs + wa * 60e3;
    const c = await connection(sa.id, sb.id, target, arriveBy, fetchImpl);
    if (!c) throw new Error("no connection");
    const dep = c.dep - wa * 60e3, arr = c.arr + wb * 60e3;
    const first = c.steps[0];
    return { mode: "train", depart: dep, arrive: arr, minutes: Math.round((arr - dep) / 60e3), distKm: +d.toFixed(1), costChf: trainFare(d, who),
      fromStation: sa.name, toStation: sb.name, walkTo: wa, walkFrom: wb, platform: c.platform, steps: c.steps, changes: c.changes,
      text: first ? `${first.line} ${first.dep} from ${first.from}${c.platform ? ", platform " + c.platform : ""}${c.changes ? ` · ${c.changes} change${c.changes > 1 ? "s" : ""}` : ""} → ${sb.name} ${hm(c.arr)}` : `Public transport to ${sb.name}` };
  } catch (e) { // timetable unavailable: estimate, clearly marked
    const m = Math.round(d * 1.4 / 35 * 60) + 15; const dep = arriveBy ? whenMs - m * 60e3 : whenMs;
    return { mode: "train", estimated: true, depart: dep, arrive: dep + m * 60e3, minutes: m, distKm: +d.toFixed(1), costChf: trainFare(d, who), text: `Public transport ~${m} min (check the SBB app)` };
  }
}

/* ---------- schedule: times + legs for the whole day ---------- */
// plan: {day, start:{lat,lon,label}, travel, who, stops:[{name, lat, lon, duration_min, arrive?, fixedStart?}]}
async function reflow(plan, deps = {}) {
  const stops = plan.stops.filter(s => isFinite(s.lat) && isFinite(s.lon));
  const out = { legs: [], stops: [] };
  if (!stops.length) return out;
  const home = plan.start;
  // first stop: arrive at its target time (or 10:00)
  const firstTarget = stops[0].fixedStart ? at(plan.day, stops[0].fixedStart) : at(plan.day, stops[0].arrive || "10:00");
  let l = await leg(home, stops[0], firstTarget, true, plan.travel, plan.who, deps);
  out.legs.push(l);
  let t = l.arrive;
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    if (i > 0) {
      const fixed = s.fixedStart ? at(plan.day, s.fixedStart) : null;
      l = fixed && fixed - t > 20 * 60e3 ? await leg(stops[i - 1], s, fixed, true, plan.travel, plan.who, deps) : await leg(stops[i - 1], s, t, false, plan.travel, plan.who, deps);
      out.legs.push(l); t = l.arrive;
    }
    let arrive = roundUp5(Math.max(t, s.fixedStart ? at(plan.day, s.fixedStart) : 0));
    const leave = arrive + Math.max(15, +s.duration_min || 60) * 60e3;
    out.stops.push(Object.assign({}, s, { arrive: hm(arrive), leave: hm(leave) }));
    t = leave;
  }
  out.legs.push(await leg(stops[stops.length - 1], home, t, false, plan.travel, plan.who, deps));
  out.leaveHome = hm(out.legs[0].depart); out.backHome = hm(out.legs[out.legs.length - 1].arrive);
  out.travelMin = out.legs.reduce((s, x) => s + x.minutes, 0);
  out.costChf = out.legs.reduce((s, x) => s + (x.costChf || 0), 0) + out.stops.reduce((s, x) => s + (+x.cost_chf || 0), 0);
  for (const x of out.legs) { x.depart = hm(x.depart); x.arrive = hm(x.arrive); }
  return out;
}

/* ---------- weather (Open-Meteo, MeteoSwiss model) ---------- */
const WMO = { 0: ["☀️", "Sunny"], 1: ["🌤", "Mostly sunny"], 2: ["⛅", "Partly cloudy"], 3: ["☁️", "Cloudy"], 45: ["🌫", "Fog"], 48: ["🌫", "Fog"], 51: ["🌦", "Drizzle"], 53: ["🌦", "Drizzle"], 55: ["🌧", "Drizzle"], 61: ["🌧", "Rain"], 63: ["🌧", "Rain"], 65: ["🌧", "Heavy rain"], 71: ["🌨", "Snow"], 73: ["🌨", "Snow"], 75: ["❄️", "Heavy snow"], 80: ["🌦", "Showers"], 81: ["🌧", "Showers"], 82: ["⛈", "Heavy showers"], 85: ["🌨", "Snow showers"], 95: ["⛈", "Thunderstorms"] };
async function weather(p, day, fetchImpl = fetch) {
  try {
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FZurich&start_date=${day}&end_date=${day}`;
    const r = await fetchImpl(u, { signal: AbortSignal.timeout(5000) }); if (!r.ok) return null;
    const d = (await r.json()).daily; if (!d || !d.time || !d.time.length) return null;
    const w = WMO[d.weathercode[0]] || ["🌡", "Forecast"];
    return { icon: w[0], text: w[1], max: Math.round(d.temperature_2m_max[0]), min: Math.round(d.temperature_2m_min[0]), rain: d.precipitation_probability_max ? d.precipitation_probability_max[0] : null };
  } catch (e) { return null; }
}

/* ---------- Wikipedia fun facts ---------- */
async function funFact(title, lang = "en", fetchImpl = fetch) {
  for (const L of [lang, "de"]) {
    try {
      const r = await fetchImpl(`https://${L}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(String(title).replace(/ /g, "_"))}`, { signal: AbortSignal.timeout(5000), headers: { "User-Agent": "SwissOutings/1.0 (https://www.swissoutings.com)" } });
      if (!r.ok) continue;
      const j = await r.json();
      if (j.type === "disambiguation" || !j.extract) continue;
      return { title: j.title, text: j.extract.slice(0, 700), url: j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page, lang: L };
    } catch (e) {}
  }
  return null;
}

module.exports = { km, hm, at, walkMin, trainFare, geocode, nearestStation, connection, leg, reflow, weather, funFact, stripTags };
