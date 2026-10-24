// Day planner: timetable parsing, scheduling and the build API, with all outside services mocked.
const test = require("node:test");
const assert = require("node:assert");
const P = require("../lib/planner");
const DAY = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const z = (hhmm) => new Date(P.at(DAY, hhmm)).toISOString();   // Zurich time → ISO
const STATIONS = { kus: { id: "8503104", name: "Küsnacht ZH", coordinate: { x: 47.318, y: 8.582 } }, rap: { id: "8503110", name: "Rapperswil", coordinate: { x: 47.225, y: 8.817 } } };
const calls = [];
function mockFetch(url, opts = {}) {
  url = String(url); calls.push(url);
  const J = o => Promise.resolve(new Response(JSON.stringify(o), { status: 200 }));
  if (url.includes("/locations?")) { const x = +new URL(url).searchParams.get("x"); return J({ stations: [x > 47.27 ? STATIONS.kus : STATIONS.rap] }); }
  if (url.includes("/connections?")) {
    const q = new URL(url).searchParams, fromK = q.get("from") === "8503104", t = q.get("time"), arrBy = q.get("isArrivalTime") === "1";
    const [h, m] = t.split(":").map(Number), base = P.at(DAY, t);
    const dep = arrBy ? base - 40 * 60e3 : base + 4 * 60e3, arr = dep + 29 * 60e3;
    const sec = { journey: { category: "S", number: "7" }, departure: { station: { name: fromK ? "Küsnacht ZH" : "Rapperswil" }, departure: new Date(dep).toISOString(), platform: "2" }, arrival: { station: { name: fromK ? "Rapperswil" : "Küsnacht ZH" }, arrival: new Date(arr).toISOString() } };
    return J({ connections: [{ from: { departure: new Date(dep).toISOString(), platform: "2" }, to: { arrival: new Date(arr).toISOString() }, sections: [sec] }] });
  }
  if (url.includes("geo.admin.ch")) { const q = decodeURIComponent(new URL(url).searchParams.get("searchText")); if (/nowhere/i.test(q)) return J({ results: [] }); const rap = /rapperswil|zoo|caf|castle|schloss/i.test(q);
    return J({ results: [{ attrs: { label: `<b>${q}</b> ${rap ? "8640 Rapperswil" : "8700 Küsnacht"}`, lat: rap ? 47.2265 : 47.3185, lon: rap ? 8.8185 : 8.5838 } }] }); }
  if (url.includes("open-meteo")) return J({ daily: { time: [DAY], weathercode: [1], temperature_2m_max: [14.2], temperature_2m_min: [5.8], precipitation_probability_max: [10] } });
  if (url.includes("wikipedia.org")) return J({ title: "Rapperswil", extract: "Rapperswil is known as the town of roses.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Rapperswil" } } });
  if (url.includes("/auth/v1/user")) return Promise.resolve(new Response("{}", { status: /good/.test(opts.headers && opts.headers.Authorization) ? 200 : 401 }));
  if (url.includes("/rest/v1/events")) return J([{ id: "knie-zoo-day", data: { title: "Zoo family day", start: DAY, audience: ["Family"], category: "Kids", venue: "Knie's Kinderzoo", city: "Rapperswil" } }]);
  if (url.endsWith("/chat/completions")) {
    const b = JSON.parse(opts.body), alt = /Replace this stop/.test(b.messages[1].content);
    const s = (name, type, arrive, extra = {}) => Object.assign({ type, name, place_query: name + " Rapperswil", town: "Rapperswil", arrive, duration_min: 90, cost_chf: 30, why: "Fun", tip: "Early", wiki_title: "Rapperswil" }, extra);
    const out = alt ? { options: [s("Lake boat", "activity", "13:30"), s("Chocolate shop", "activity", "13:30")] }
      : { title: "Roses & zoo", summary: "A lovely day.", stops: [s("Knie's Kinderzoo", "event", "09:30", { event_id: "knie-zoo-day" }), s("Café Rosenstadt", "meal", "12:15", { duration_min: 60 }), s("Rapperswil Castle", "activity", "13:30"), { name: "Nowhere", place_query: "", town: "" }], heads_up: ["Zoo closes 17:00"], packing: ["Snacks"] };
    return J({ choices: [{ message: { content: JSON.stringify(out) } }] });
  }
  return Promise.reject(new Error("unexpected " + url));
}
global.fetch = mockFetch;

test("fares: kids under 6 free, half-fare halves, Junior card makes kids free", () => {
  const base = P.trainFare(20, { adults: 2, kids: [] });
  assert.ok(base > 10 && base < 25, String(base));
  assert.strictEqual(P.trainFare(20, { adults: 2, kids: [4] }), base);
  assert.ok(P.trainFare(20, { adults: 2, kids: [8] }) > base);
  assert.strictEqual(P.trainFare(20, { adults: 2, kids: [8], junior: true }), base);
  assert.ok(Math.abs(P.trainFare(20, { adults: 2, halfFare: true }) - base / 2) <= 1);
});
test("geocode strips HTML and keeps only Swiss coordinates", async () => {
  const r = await P.geocode("Seestrasse 10 Küsnacht", mockFetch);
  assert.strictEqual(r[0].label, "Seestrasse 10 Küsnacht 8700 Küsnacht"); assert.ok(r[0].lat > 47);
});
test("a train leg uses the real connection and walking time to the station", async () => {
  const home = { lat: 47.3185, lon: 8.5838 }, zoo = { lat: 47.2265, lon: 8.8185 };
  const l = await P.leg(home, zoo, P.at(DAY, "09:30"), true, "train", { adults: 2, kids: [9] }, { fetch: mockFetch });
  assert.strictEqual(l.mode, "train"); assert.ok(!l.estimated); assert.match(l.text, /^S7 \d\d:\d\d from Küsnacht ZH, platform 2 → Rapperswil/);
  assert.ok(l.arrive <= P.at(DAY, "09:30")); assert.ok(l.costChf > 0);
});
test("short hops are walks, car trips are estimated", async () => {
  const a = { lat: 47.2265, lon: 8.8185 }, b = { lat: 47.2275, lon: 8.8195 };
  assert.strictEqual((await P.leg(a, b, P.at(DAY, "12:00"), false, "train", {}, { fetch: mockFetch })).mode, "walk");
  assert.strictEqual((await P.leg({ lat: 47.31, lon: 8.58 }, a, P.at(DAY, "12:00"), false, "car", {}, { fetch: mockFetch })).mode, "car");
});
test("timetable down → clearly marked estimate instead of failing", async () => {
  const l = await P.leg({ lat: 47.3185, lon: 8.5838 }, { lat: 47.2265, lon: 8.8185 }, P.at(DAY, "09:00"), false, "train", {}, { fetch: () => Promise.reject(new Error("down")) });
  assert.ok(l.estimated); assert.match(l.text, /check the SBB app/);
});
test("reflow keeps stops in order with no overlaps, and a leg home", async () => {
  const plan = { day: DAY, travel: "train", who: { adults: 2, kids: [] }, start: { lat: 47.3185, lon: 8.5838 },
    stops: [{ name: "Zoo", lat: 47.2265, lon: 8.8185, duration_min: 120, arrive: "09:30" }, { name: "Lunch", lat: 47.227, lon: 8.819, duration_min: 60 }, { name: "Castle", lat: 47.228, lon: 8.8165, duration_min: 60 }] };
  const r = await P.reflow(plan, { fetch: mockFetch });
  assert.strictEqual(r.legs.length, 4); assert.strictEqual(r.stops.length, 3);
  for (let i = 1; i < r.stops.length; i++) assert.ok(r.stops[i].arrive >= r.stops[i - 1].leave, `${r.stops[i - 1].leave} → ${r.stops[i].arrive}`);
  assert.ok(r.leaveHome < r.stops[0].arrive && r.backHome > r.stops[2].leave);
});

const plan = require("../api/plan");
function call(action, { method = "POST", body, auth = "Bearer good.good.good", query = {} } = {}) {
  return new Promise(resolve => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { resolve({ status: this.statusCode, body: o }); } };
    plan({ method, query: Object.assign({ action }, query), body, headers: { authorization: auth } }, res); });
}
test("build needs sign-in and the AI key", async () => {
  delete process.env.OPENAI_API_KEY;
  assert.strictEqual((await call("build", { auth: "" })).status, 401);
  assert.strictEqual((await call("build", { body: {} })).status, 501);
});
test("build: real trains, weather, event anchor; unknown places dropped", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const r = await call("build", { body: { params: { day: DAY, vibe: "mix", who: { adults: 2, kids: [9, 6] }, start: { lat: 47.3185, lon: 8.5838, label: "Seestrasse 10, Küsnacht" }, anchorEventId: "knie-zoo-day" } } });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  const p = r.body.plan;
  assert.strictEqual(p.stops.length, 3, "the place that couldn't be found is dropped");
  assert.strictEqual(p.stops[0].event_id, "knie-zoo-day"); assert.strictEqual(p.weather.text, "Mostly sunny");
  assert.strictEqual(p.legs.length, 4); assert.ok(p.legs.some(l => /^S7/.test(l.text)));
  assert.ok(p.headsUp.some(h => /Train home leaves/.test(h)) && p.headsUp.includes("Zoo closes 17:00"));
  assert.ok(p.costChf > 0 && p.leaveHome && p.backHome);
});
test("alternatives return geocoded options; reflow works without AI", async () => {
  const b = (await call("build", { body: { params: { day: DAY, start: { lat: 47.3185, lon: 8.5838, label: "Home" } } } })).body.plan;
  const alt = await call("alternatives", { body: { plan: b, index: 1 } });
  assert.strictEqual(alt.body.options.length, 2); assert.ok(alt.body.options[0].lat);
  delete process.env.OPENAI_API_KEY;
  const stops = b.stops.slice(); stops.splice(1, 1);
  const rf = await call("reflow", { body: { plan: Object.assign({}, b, { stops }) } });
  assert.strictEqual(rf.status, 200); assert.strictEqual(rf.body.plan.stops.length, 2); assert.strictEqual(rf.body.plan.legs.length, 3);
});
test("geocode and fun facts are public and cached", async () => {
  const g = await call("geocode", { method: "GET", query: { q: "Seestrasse 10 Küsnacht" }, auth: "" });
  assert.strictEqual(g.status, 200); assert.ok(g.body.results.length);
  const f = await call("fact", { method: "GET", query: { title: "Rapperswil" }, auth: "" });
  assert.match(f.body.text, /town of roses/);
});
