/* Swiss Outings — "Plan our day": setup → AI plan with real trains → edit (✕ / ↻) → save, share, follow on the day */
(function(){
"use strict";
const A = () => window.__app;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => A().esc(s);
const icon = n => A().icon(n);
const api = p => window.SO_native.api(p);
const DOWL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"], MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const PL = { plan: null, trip: null, settings: null, params: null, saving: false };

/* ---------- helpers ---------- */
function dayLabel(iso){ const d = A().parseD(iso); if(!d) return iso; const t = A().TODAY, k = Math.round((d - t) / 864e5); return (k === 0 ? "Today, " : k === 1 ? "Tomorrow, " : "") + DOWL[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; }
function nextDow(dow){ const t = new Date(A().TODAY); const k = (dow - t.getDay() + 7) % 7; return A().ymd(A().addDays(t, k)); }
function ctaLabel(){ const d = A().TODAY.getDay(); if(d === 6) return "Plan our Saturday"; if(d === 0) return "Plan our Sunday"; if(d >= 4) return "Plan our weekend"; return "Plan a day out"; }
async function post(action, payload){
  const r = await fetch(api("/api/plan") + "?action=" + action, { method: "POST", headers: { "Content-Type": "application/json", ...(await A().authHeader()) }, body: JSON.stringify(payload) });
  let j = {}; try{ j = await r.json(); }catch(x){}
  if(!r.ok){ A().track("plan", null, { error: j.code || ("http" + r.status), action });
    throw new Error(j.error || (r.status === 504 ? "The planner took too long this time. Please try again." : "Something went wrong (" + r.status + "). Please try again.")); }
  return j;
}
// The planner opens as a centred window on computers (wide two-column view for the plan) and full-screen on phones.
function shell(title, html, wide){
  // re-rendering the same screen (a chip, an edit) keeps the scroll position and skips the opening animation, so nothing jumps
  const prev = $("#sheetHost .sheet.planflow"), same = prev && prev.dataset.title === title && !!prev.classList.contains("planview") === !!wide, top = same ? prev.scrollTop : 0;
  A().sheetShell(title, html);
  const sh = $("#sheetHost .sheet"); if(!sh) return;
  sh.dataset.title = title; if(prev) sh.classList.add("noanim"); if(same) sh.scrollTop = top;
  sh.classList.add("planflow"); if(wide) sh.classList.add("planview");
  const sc = sh.closest(".scrim"); if(sc) sc.classList.add("center");
}
let leafletP = null;
function leaflet(){
  if(window.L) return Promise.resolve(window.L);
  if(leafletP) return leafletP;
  leafletP = new Promise((ok, bad) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"; document.head.appendChild(css);
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"; s.onload = () => ok(window.L); s.onerror = bad; document.head.appendChild(s);
  });
  return leafletP;
}

/* ---------- entry points ---------- */
function ctaHTML(){ return `<button type="button" class="plancta" data-plan-open>${icon("route")}<span><b>✨ ${ctaLabel()}</b><small>A full day with trains, lunch and the best events, made for your family</small></span><span aria-hidden="true">›</span></button>`; }
async function loadSettings(){ try{ const { data } = await window.sb.from("household_settings").select("*").maybeSingle(); PL.settings = data || null; }catch(x){ PL.settings = null; } return PL.settings; }
async function saveSettings(s){ try{ await window.sb.from("household_settings").upsert(Object.assign({ household_id: A().S.household.id, updated_at: new Date().toISOString() }, s)); }catch(x){} }

/* ---------- step 1: setup ---------- */
const VIBES = [["nature","🌲 Nature & hike"],["city","🏛 City & culture"],["mix","🎡 A bit of both"],["rainy","☔ Rainy-day"]];
async function open(opts = {}){
  A().track("plan", opts.anchorEventId || null, { step: "open", from: opts.from || "" });
  const st = await loadSettings() || {};
  const anchor = opts.anchorEventId && A().S.events.find(e => e.id === opts.anchorEventId);
  const sat = nextDow(6), sun = nextDow(0), today = A().ymd(A().TODAY), tomorrow = A().ymd(A().addDays(A().TODAY, 1));
  const dayOpts = [...new Set([today, tomorrow, sat, sun])].sort();
  let day = opts.day || (anchor ? A().ymd(A().parseD(anchor.start) < A().TODAY ? A().TODAY : A().parseD(anchor.start)) : (A().TODAY.getDay() >= 1 && A().TODAY.getDay() <= 5 ? sat : today));
  const P = { day, vibe: opts.vibe || "mix", pace: "relaxed", travel: st.travel || "train", budget: "any",
    who: { adults: st.adults || 2, kids: Array.isArray(st.kids) ? st.kids.slice() : [], halfFare: !!st.half_fare, junior: !!st.junior },
    start: st.home_lat ? { lat: st.home_lat, lon: st.home_lon, label: st.home_label } : null, anchorEventId: anchor ? anchor.id : null, note: opts.note || "" };
  PL.params = P;
  const chip = (attr, val, label, on) => `<button type="button" class="chip" data-${attr}="${esc(val)}" aria-pressed="${on}">${label}</button>`;
  const render = () => {
    shell("Plan our day", `<form id="planForm" class="form plansetup" novalidate>
      ${anchor ? `<div class="anchor">${icon("star")}<span>Built around <b>${esc(anchor.title)}</b></span></div>` : ""}
      <div><label>Where do you start from?</label>
        ${P.start ? `<div class="homebox">${icon("home")}<span>${esc(P.start.label)}</span><button type="button" class="chip" id="homeChange">Change</button></div>`
          : `<p class="desc" style="margin:4px 0 8px">Your home address lets us time the day to the minute: when to leave, which train, when you're back. It stays private to your household.</p>
             <div class="geo"><input id="homeQ" class="inp" placeholder="Street and number, town (e.g. Seestrasse 10, Küsnacht)" autocomplete="street-address"><div id="homeList" class="geolist" role="listbox"></div></div>`}
      </div>
      <div><label>When?</label><div class="chips">${dayOpts.map(d => chip("pday", d, dayLabel(d).replace(/^(Today|Tomorrow), /, "$1 · "), d === P.day)).join("")}<input type="date" id="pDate" class="chip" value="${esc(P.day)}" min="${esc(today)}" aria-label="Pick a date"></div></div>
      <div><label>Who's coming?</label>
        <div class="whorow"><span>Adults</span><button type="button" class="step" data-adults="-1" aria-label="One adult fewer">−</button><b id="adultsN">${P.who.adults}</b><button type="button" class="step" data-adults="1" aria-label="One adult more">+</button></div>
        <div class="whorow"><span>Kids</span><div class="kids">${P.who.kids.map((k, i) => `<span class="kid">${k} yrs<button type="button" data-kid-del="${i}" aria-label="Remove child aged ${k}">✕</button></span>`).join("")}
          <select id="kidAdd" class="chip" aria-label="Add a child"><option value="">+ Add child</option>${Array.from({ length: 18 }, (_, a) => `<option value="${a}">${a === 0 ? "Under 1" : a + " yrs"}</option>`).join("")}</select></div></div>
      </div>
      <div><label>What kind of day?</label><div class="chips">${VIBES.map(v => chip("vibe", v[0], v[1], P.vibe === v[0])).join("")}</div></div>
      <div class="twocol"><div><label>Pace</label><div class="chips">${chip("pace","relaxed","Relaxed",P.pace==="relaxed")}${chip("pace","active","Active",P.pace==="active")}</div></div>
        <div><label>Getting around</label><div class="chips">${chip("travel","train","🚆 Train",P.travel==="train")}${chip("travel","car","🚗 Car",P.travel==="car")}</div></div></div>
      ${P.travel === "train" ? `<div class="chips small"><label class="tick"><input type="checkbox" id="halfFare" ${P.who.halfFare ? "checked" : ""}> We have half-fare cards</label>${P.who.kids.some(k => k >= 6) ? `<label class="tick"><input type="checkbox" id="junior" ${P.who.junior ? "checked" : ""}> Kids have Junior cards</label>` : ""}</div>` : ""}
      <div><label>Budget</label><div class="chips">${chip("budget","any","No limit",P.budget==="any")}${chip("budget","low","Keep it cheap",P.budget==="low")}</div></div>
      <div><label for="pNote">Anything special? (optional)</label><input id="pNote" class="inp" placeholder="e.g. a playground, a lake, no long walks" value="${esc(P.note)}"></div>
      <p class="ob-msg err" id="planErr" role="alert" hidden></p>
      <button class="btn primary ob-cta" type="submit">${icon("route")} Make our plan</button>
    </form>`);
    wire();
  };
  const wire = () => {
    const f = $("#planForm");
    f.onclick = e => {
      const t = e.target;
      const d = t.closest("[data-pday]"); if(d){ P.day = d.dataset.pday; return render(); }
      const v = t.closest("[data-vibe]"); if(v){ P.vibe = v.dataset.vibe; return render(); }
      const pc = t.closest("[data-pace]"); if(pc){ P.pace = pc.dataset.pace; return render(); }
      const tr = t.closest("[data-travel]"); if(tr){ P.travel = tr.dataset.travel; return render(); }
      const bu = t.closest("[data-budget]"); if(bu){ P.budget = bu.dataset.budget; return render(); }
      const ad = t.closest("[data-adults]"); if(ad){ P.who.adults = Math.max(1, Math.min(8, P.who.adults + +ad.dataset.adults)); return render(); }
      const kd = t.closest("[data-kid-del]"); if(kd){ P.who.kids.splice(+kd.dataset.kidDel, 1); return render(); }
      if(t.id === "homeChange"){ P.start = null; return render(); }
      const g = t.closest("[data-geo]"); if(g){ P.start = JSON.parse(g.dataset.geo); return render(); }
    };
    const da = $("#pDate"); if(da) da.onchange = () => { if(da.value) { P.day = da.value; render(); } };
    const ka = $("#kidAdd"); if(ka) ka.onchange = () => { if(ka.value !== "") { P.who.kids.push(+ka.value); P.who.kids.sort((a, b) => b - a); render(); } };
    const hf = $("#halfFare"); if(hf) hf.onchange = () => { P.who.halfFare = hf.checked; };
    const ju = $("#junior"); if(ju) ju.onchange = () => { P.who.junior = ju.checked; };
    const nt = $("#pNote"); if(nt) nt.oninput = () => { P.note = nt.value; };
    const hq = $("#homeQ");
    if(hq){ let tm; hq.oninput = () => { clearTimeout(tm); const q = hq.value.trim(); if(q.length < 4){ $("#homeList").innerHTML = ""; return; } tm = setTimeout(async () => {
        try{ const r = await fetch(api("/api/plan") + "?action=geocode&q=" + encodeURIComponent(q)); const j = await r.json();
          $("#homeList").innerHTML = (j.results || []).map(x => `<button type="button" role="option" data-geo='${esc(JSON.stringify({ lat: x.lat, lon: x.lon, label: x.label }))}'>${icon("pin")} ${esc(x.label)}</button>`).join("") || `<p class="desc">No match yet. Try street, number and town.</p>`;
        }catch(x){} }, 300); }; setTimeout(() => hq.focus(), 50); }
    f.onsubmit = async ev => {
      ev.preventDefault(); const err = $("#planErr");
      if(!P.start){ err.textContent = "Please pick your starting address from the list."; err.hidden = false; return; }
      saveSettings({ home_label: P.start.label, home_lat: P.start.lat, home_lon: P.start.lon, adults: P.who.adults, kids: P.who.kids, half_fare: P.who.halfFare, junior: P.who.junior, travel: P.travel });
      build(P);
    };
  };
  render();
}

/* ---------- step 2: building ---------- */
async function build(P, extra){
  const lines = ["Looking at events that day…", "Checking the weather…", "Finding the best spots for your family…", "Checking trains and connections…", "Picking a good lunch stop…", "Putting it all together…"];
  shell("Plan our day", `<div class="building"><div class="spinbig" aria-hidden="true"></div><p id="bLine">${lines[0]}</p><p class="desc">This takes about 15 seconds.</p></div>`);
  let i = 0; const tick = setInterval(() => { const el = $("#bLine"); if(!el) return clearInterval(tick); i = Math.min(lines.length - 1, i + 1); el.textContent = lines[i]; }, 2600);
  try{
    const { plan } = await post("build", Object.assign({ params: P }, extra || {}));
    clearInterval(tick); PL.plan = plan; PL.trip = null; PL.params = P;
    if(extra && extra.feedback) A().toast("Here's your new plan. Save it to keep it.");
    A().track("plan", P.anchorEventId, { step: "built", stops: plan.stops.length, vibe: P.vibe });
    show();
  }catch(err){ clearInterval(tick); shell("Plan our day", `<div class="building"><p>${esc(err.message)}</p><div class="btnrow">${extra && PL.plan ? `<button class="btn" type="button" data-plan-back>Back to my plan</button><button class="btn primary" type="button" data-plan-retry>Try again</button>` : `<button class="btn primary" type="button" data-plan-open>Try again</button>`}</div></div>`);
    const h = $("#sheetHost"); h.onclick = e => { if(e.target.closest("[data-plan-back]")) show(); else if(e.target.closest("[data-plan-retry]")) build(P, extra); }; }
}

/* ---------- step 3: the plan ---------- */
function legHTML(l){
  if(!l) return "";
  const ic = l.mode === "walk" ? "🚶" : l.mode === "car" ? "🚗" : "🚆";
  const dur = m => m >= 60 ? Math.floor(m / 60) + " h " + (m % 60 ? (m % 60) + " min" : "") : m + " min";
  // one calm line; the full connection (lines, platforms, walks) folds out on tap
  const head = l.mode === "walk" ? `Walk ${dur(l.minutes)}` : l.mode === "car" ? `Drive about ${dur(l.minutes)}`
    : l.estimated ? `About ${dur(l.minutes)} by public transport` : `${esc(l.depart)}–${esc(l.arrive)} · ${dur(l.minutes)}${l.changes ? ` · ${l.changes} change${l.changes > 1 ? "s" : ""}` : " · direct"}`;
  const steps = (l.steps || []).map(s => `<li><b>${esc(s.dep)}</b> ${esc(s.line)} ${esc(s.from)} → ${esc(s.to)} <b>${esc(s.arr)}</b></li>`).join("");
  const walks = l.mode === "train" && !l.estimated && (l.walkTo > 2 || l.walkFrom > 2) ? `<li class="w">Walk ${l.walkTo} min to ${esc(l.fromStation)}${l.walkFrom > 2 ? ` · ${l.walkFrom} min from ${esc(l.toStation)}` : ""}</li>` : "";
  const more = l.mode === "train" ? (steps || walks ? `<ul class="lsteps">${walks}${steps}</ul>` : `<p class="lnote">${esc(l.text)}</p>`) : "";
  const cost = l.costChf ? `<span class="cost">CHF ${esc(l.costChf)}</span>` : "";
  return more ? `<li class="pleg"><span class="lic">${ic}</span><details><summary><span>${head}</span>${cost}</summary>${more}</details></li>`
    : `<li class="pleg"><span class="lic">${ic}</span><div class="lsum"><span>${head}</span>${cost}</div></li>`;
}
function stopHTML(s, i, done){
  return `<li class="pstop ${done ? "done" : ""}" data-si="${i}">
    <div class="pnum">${PL.trip ? `<button type="button" class="tick ${done ? "on" : ""}" data-done="${i}" aria-label="${done ? "Mark as not done" : "Mark as done"}">${done ? "✓" : i + 1}</button>` : `<span>${i + 1}</span>`}</div>
    <div class="pbody">
      <div class="ptop"><span class="ptime">${esc(s.arrive)}–${esc(s.leave)}</span><span class="pcost">${s.cost_chf ? `CHF ${esc(s.cost_chf)}` : s.type !== "meal" ? "Free" : ""}</span></div>
      <h3>${s.type === "meal" ? "🍽 " : s.type === "event" ? "🎟 " : ""}${esc(s.name)}</h3>
      <p class="paddr">${esc(s.town || s.address || "")}</p>
      ${s.why ? `<p class="pwhy">${esc(s.why)}</p>` : ""}
      ${s.tip || s.kids_note || s.opening_note ? `<details class="pmore"><summary>Tips</summary>
        ${s.tip ? `<p>💡 ${esc(s.tip)}</p>` : ""}${s.kids_note ? `<p>🧒 ${esc(s.kids_note)}</p>` : ""}${s.opening_note ? `<p>🕒 ${esc(s.opening_note)}</p>` : ""}</details>` : ""}
      <div class="pfact" id="fact${i}" hidden></div>
      <div class="palts" id="alts${i}" hidden></div>
      <div class="pacts">
        ${s.wiki_title ? `<button type="button" data-fact="${i}" title="Fun facts">${icon("bulb")}<span>Facts</span></button>` : ""}
        <button type="button" data-say="${i}" title="Listen">${icon("sound")}<span>Listen</span></button>
        ${s.event_id && A().S.events.some(e => e.id === s.event_id) ? `<button type="button" data-evopen="${esc(s.event_id)}" title="Event details">${icon("ticket")}<span>Event</span></button>` : ""}
        <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener" title="Directions">${icon("pin")}<span>Map</span></a>
        <span class="sp"></span>
        <button type="button" data-swap="${i}" title="Swap for something else" aria-label="Swap ${esc(s.name)} for something else">${icon("swap")}<span>Swap</span></button>
        <button type="button" class="rm" data-rm="${i}" title="Remove" aria-label="Remove ${esc(s.name)}">${icon("x")}</button>
      </div>
    </div></li>`;
}
function nowNextHTML(p, done){
  if(!PL.trip || p.day !== A().ymd(A().TODAY)) return "";
  const now = new Date(), mins = d => { const [h, m] = String(d).split(":").map(Number); const x = new Date(); x.setHours(h, m, 0, 0); return Math.round((x - now) / 60e3); };
  const idx = p.stops.findIndex((s, i) => !done.includes(i));
  if(idx < 0) return `<div class="nownext"><b>🎉 All done!</b> Hope you had a great day.</div>`;
  const leg = p.legs[idx], s = p.stops[idx], m = leg ? mins(leg.depart) : null;
  return `<div class="nownext"><small>NEXT</small><b>${esc(s.name)}</b><span>${leg ? (m > 0 ? `Leave in <b>${m} min</b> (${esc(leg.depart)}): ` : m > -60 ? `Should have left at ${esc(leg.depart)}: ` : "") + esc(leg.text) : ""}</span>
    <div class="btnrow"><a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}">${icon("pin")} Directions</a><button class="btn" type="button" data-late>Running late? Re-plan from now</button></div></div>`;
}
function show(){
  const p = PL.plan, done = (PL.trip && PL.trip.done) || [];
  const w = p.weather;
  let tl = "";
  p.stops.forEach((s, i) => { tl += legHTML(p.legs[i]) + stopHTML(s, i, done.includes(i)); });
  tl += legHTML(p.legs[p.stops.length]).replace('<li class="pleg">', '<li class="pleg home">');
  shell(p.title, `<div class="plan2">
    <div class="phead">
      <div class="phead1">
        <p class="psum">${esc(dayLabel(p.day))}${w ? ` · ${esc(w.icon)} ${esc(w.text)} ${w.min}–${w.max}°${w.rain != null ? ` · ${w.rain}% rain` : ""}` : ""}</p>
        ${p.summary ? `<p class="lede">${esc(p.summary)}</p>` : ""}
      </div>
      <div class="pstats"><span><small>Leave</small><b>${esc(p.leaveHome)}</b></span><span><small>Back</small><b>${esc(p.backHome)}</b></span><span><small>Travel</small><b>${Math.floor(p.travelMin / 60)}h${String(p.travelMin % 60).padStart(2, "0")}</b></span><span><small>About</small><b>CHF ${esc(p.costChf)}</b></span></div>
    </div>
    ${replanHTML()}
    ${nowNextHTML(p, done)}
    <div class="pcols">
      <aside class="pside">
        <div id="planMap" class="pmap" aria-label="Map of the day"></div>
        <div class="pextra">
          ${(p.headsUp || []).length ? `<div class="pheads"><b>Good to know</b><ul>${p.headsUp.map(h => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
          ${(p.packing || []).length ? `<p class="ppack"><b>Bring:</b> ${p.packing.map(esc).join(" · ")}</p>` : ""}
          <p class="note">Times use the official Swiss timetable; check the SBB app on the day. Prices are estimates.</p>
        </div>
      </aside>
      <ol class="ptl">${tl}</ol>
    </div>
  </div>
  <div class="sbar pbar">
    <button class="bbtn" type="button" data-psave ${PL.trip ? "disabled" : ""}>${icon("check")}<span>${PL.trip ? "Saved" : "Save"}</span></button>
    <div class="calwrap" style="flex:1"><button class="bbtn" type="button" data-psend aria-expanded="false" style="width:100%">${icon("share")}<span>Send</span></button>
      <div class="calpop up" id="pSendPop" hidden><button type="button" data-psendvia="wa">${icon("wa")} WhatsApp</button><button type="button" data-psendvia="mail">${icon("mail")} Email</button><button type="button" data-psendvia="copy">${icon("link")} Copy link</button></div></div>
    <button class="bbtn main" type="button" data-pcal>${icon("cal")}<span>Calendar</span></button>
  </div>`, true);
  drawMap(p);
  wirePlan();
}
/* ---------- re-plan the whole day with feedback ---------- */
const FEEDBACK = ["Less travel", "Closer to home", "More for the kids", "More indoors", "More outdoors", "Cheaper", "Start later", "Finish earlier", "A different area", "Better food stop", "Include an event"];
function replanHTML(){
  return `<div class="replan" id="replan">
    <button type="button" class="replan-open" data-replan-open>${icon("route")}<span><b>Not quite right? Re-plan the day</b><small>Tell us what to change and we'll make a new plan</small></span><span aria-hidden="true">›</span></button>
    <div class="replan-box" id="replanBox" hidden>
      <p class="desc">What should be different?</p>
      <div class="chips" id="fbChips">${FEEDBACK.map(f => `<button type="button" class="chip" data-fb="${esc(f)}" aria-pressed="false">${esc(f)}</button>`).join("")}</div>
      <textarea id="fbText" class="inp" rows="2" maxlength="300" placeholder="Anything else? e.g. 'skip the market, add a playground', 'we have a car today'"></textarea>
      <div class="btnrow"><button type="button" class="btn" data-replan-cancel>Cancel</button><button type="button" class="btn primary" data-replan-go>Make a new plan</button></div>
    </div>
  </div>`;
}
function replan(){
  const picks = [...document.querySelectorAll("#fbChips [aria-pressed=true]")].map(b => b.dataset.fb);
  const txt = ($("#fbText") && $("#fbText").value.trim()) || "";
  if(!picks.length && !txt){ A().toast("Pick or type what to change."); return; }
  const old = PL.plan;
  const P = Object.assign({}, old.params || PL.params || {}, { day: old.day, start: old.start });
  if(/we have a car|by car|driving/i.test(txt)) P.travel = "car";
  const feedback = picks.concat(txt ? [txt] : []).join("; ");
  A().track("plan", null, { step: "replan", feedback: feedback.slice(0, 200) });
  build(P, { feedback, previous: old.stops.map(s => `${s.arrive || ""} ${s.name} (${s.town || ""})`.trim()) });
}
async function drawMap(p){
  const el = $("#planMap"); if(!el) return;
  try{
    const L = await leaflet(); if(!$("#planMap")) return;
    const m = L.map(el, { scrollWheelZoom: false, attributionControl: true, zoomControl: false });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    // swisstopo's grey national map (free, no key), softened with CSS (.pmap .leaflet-tile-pane) into a calm, light background
    L.tileLayer("https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-grau/default/current/3857/{z}/{x}/{y}.jpeg", { attribution: "© swisstopo", maxZoom: 18 }).addTo(m);
    const pts = p.stops.map(s => [s.lat, s.lon]);
    const all = p.start && p.start.lat ? [[p.start.lat, p.start.lon]].concat(pts) : pts;
    if(p.start && p.start.lat) L.marker([p.start.lat, p.start.lon], { icon: L.divIcon({ className: "", html: '<div class="pm home">⌂</div>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(m);
    p.stops.forEach((s, i) => L.marker([s.lat, s.lon], { title: s.name, icon: L.divIcon({ className: "", html: `<div class="pm">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(m).bindPopup(esc(s.name)));
    L.polyline(all.concat(all.length > 1 ? [all[0]] : []), { color: "#D52B1E", weight: 2, opacity: .55, dashArray: "2 6", lineCap: "round" }).addTo(m);
    m.fitBounds(all, { padding: [28, 28] });
  }catch(x){ el.innerHTML = `<p class="desc" style="padding:12px">Map unavailable right now.</p>`; }
}
async function applyEdit(newStops, what){
  const host = $("#sheetHost .plan2"); if(host) host.classList.add("busy");
  try{
    const { plan } = await post("reflow", { plan: Object.assign({}, PL.plan, { stops: newStops }) });
    PL.plan = plan; A().track("plan_edit", null, { what });
    if(PL.trip){ await window.sb.from("trips").update({ plan, title: plan.title, updated_at: new Date().toISOString() }).eq("id", PL.trip.id); }
    const sc = $("#sheetHost .sheet").scrollTop; show(); $("#sheetHost .sheet").scrollTop = sc;
  }catch(err){ A().toast(err.message); if(host) host.classList.remove("busy"); }
}
async function save(){
  if(PL.trip || PL.saving) return PL.trip; PL.saving = true;
  const p = PL.plan;
  const { data, error } = await window.sb.from("trips").insert({ household_id: A().S.household.id, created_by: A().S.uid, title: p.title, day: p.day, plan: p }).select("id,share_token,done,day").single();
  PL.saving = false;
  if(error){ A().toast("Couldn't save: " + error.message); return null; }
  PL.trip = data; A().track("plan_save", null, { day: p.day }); loadTrips().then(() => A().render());
  return data;
}
function tripLink(t){ return window.SO_native.origin + "/t/" + t.share_token; }
function icsFor(p){
  const pad = n => String(n).padStart(2, "0"), d = p.day.replace(/-/g, "");
  const t = s => d + "T" + s.replace(":", "") + "00";
  const esc2 = s => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const ev = (uid, a, b, sum, loc, desc) => ["BEGIN:VEVENT", `UID:${uid}@swissoutings`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`, `DTSTART;TZID=Europe/Zurich:${t(a)}`, `DTEND;TZID=Europe/Zurich:${t(b)}`, "SUMMARY:" + esc2(sum), "LOCATION:" + esc2(loc), "DESCRIPTION:" + esc2(desc), "END:VEVENT"];
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Swiss Outings//Day plan//EN"];
  if(p.legs[0]) L.push(...ev("leave-" + d, p.legs[0].depart, p.legs[0].arrive, "Leave: " + p.legs[0].text, "", p.title));
  p.stops.forEach((s, i) => L.push(...ev(`s${i}-${d}`, s.arrive, s.leave, s.name, s.address || s.town || "", [s.why, s.tip, s.opening_note].filter(Boolean).join("\n"))));
  L.push("END:VCALENDAR"); return L.join("\r\n");
}
function wirePlan(){
  const host = $("#sheetHost");
  host.onclick = async e => {
    const t = e.target;
    if(t.closest("[data-replan-open]")){ const b = $("#replanBox"); b.hidden = !b.hidden; if(!b.hidden) b.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
    if(t.closest("[data-replan-cancel]")){ $("#replanBox").hidden = true; return; }
    const fb = t.closest("[data-fb]"); if(fb){ fb.setAttribute("aria-pressed", fb.getAttribute("aria-pressed") !== "true"); return; }
    if(t.closest("[data-replan-go]")){ replan(); return; }
    const rm = t.closest("[data-rm]"); if(rm){ const i = +rm.dataset.rm; if(PL.plan.stops.length <= 1) return A().toast("A plan needs at least one stop."); const ns = PL.plan.stops.slice(); ns.splice(i, 1); return applyEdit(ns, "remove"); }
    const sw = t.closest("[data-swap]"); if(sw){ const i = +sw.dataset.swap, box = $("#alts" + i); if(!box.hidden){ box.hidden = true; return; }
      box.hidden = false; box.innerHTML = `<span class="spin"></span> Finding alternatives…`;
      try{ const { options } = await post("alternatives", { plan: PL.plan, index: i }); PL.alts = PL.alts || {}; PL.alts[i] = options;
        box.innerHTML = options.length ? `<p class="desc">Instead of ${esc(PL.plan.stops[i].name)}:</p>` + options.map((o, k) => `<button type="button" class="alt" data-usealt="${i}:${k}"><b>${esc(o.name)}</b><small>${esc(o.town || o.address || "")}${o.cost_chf ? " · ~CHF " + esc(o.cost_chf) : ""}</small><span>${esc(o.why)}</span></button>`).join("") : `<p class="desc">No good alternatives nearby. Try removing it instead.</p>`;
      }catch(err){ box.innerHTML = `<p class="desc">${esc(err.message)}</p>`; } return; }
    const ua = t.closest("[data-usealt]"); if(ua){ const [i, k] = ua.dataset.usealt.split(":").map(Number); const o = PL.alts[i][k]; const ns = PL.plan.stops.slice(); ns[i] = Object.assign({}, o, { arrive: PL.plan.stops[i].arrive }); return applyEdit(ns, "swap"); }
    const fa = t.closest("[data-fact]"); if(fa){ const i = +fa.dataset.fact, box = $("#fact" + i); if(!box.hidden){ box.hidden = true; return; } box.hidden = false; box.innerHTML = `<span class="spin"></span>`;
      try{ const r = await fetch(api("/api/plan") + "?action=fact&title=" + encodeURIComponent(PL.plan.stops[i].wiki_title)); const j = r.ok ? await r.json() : null;
        box.innerHTML = j ? `<p>${esc(j.text)}</p><a href="${esc(j.url)}" target="_blank" rel="noopener">More on Wikipedia ›</a>` : `<p class="desc">No facts found for this place.</p>`; }catch(x){ box.innerHTML = `<p class="desc">Couldn't load facts.</p>`; } return; }
    const sy = t.closest("[data-say]"); if(sy){ const s = PL.plan.stops[+sy.dataset.say]; const fact = $("#fact" + sy.dataset.say); speak([`${s.name}, from ${s.arrive} to ${s.leave}.`, s.why, s.tip, fact && !fact.hidden ? fact.textContent : ""].filter(Boolean).join(" ")); return; }
    const eo = t.closest("[data-evopen]"); if(eo){ A().openSheet(eo.dataset.evopen); return; }
    const dn = t.closest("[data-done]"); if(dn && PL.trip){ const i = +dn.dataset.done; const d = new Set(PL.trip.done || []); d.has(i) ? d.delete(i) : d.add(i); PL.trip.done = [...d]; await window.sb.from("trips").update({ done: PL.trip.done }).eq("id", PL.trip.id); const sc = $("#sheetHost .sheet").scrollTop; show(); $("#sheetHost .sheet").scrollTop = sc; return; }
    if(t.closest("[data-late]")){ // re-plan the rest of the day from now
      const done = PL.trip.done || []; const rest = PL.plan.stops.filter((_, i) => !done.includes(i)); const soon = new Date(Date.now() + 40 * 60e3);
      const hhmm = String(soon.getHours()).padStart(2, "0") + ":" + String(soon.getMinutes()).padStart(2, "0");
      if(rest[0]) rest[0] = Object.assign({}, rest[0], { arrive: hhmm, fixedStart: null });
      PL.trip.done = []; await window.sb.from("trips").update({ done: [] }).eq("id", PL.trip.id); return applyEdit(rest, "late"); }
    if(t.closest("[data-psave]")){ const tr = await save(); if(tr){ A().toast("Saved to Plans"); show(); } return; }
    if(t.closest("[data-psend]")){ const pop = $("#pSendPop"); pop.hidden = !pop.hidden; return; }
    const sv = t.closest("[data-psendvia]"); if(sv){ const tr = await save(); if(!tr) return; const link = tripLink(tr), p = PL.plan;
      const txt = `${p.title} · ${dayLabel(p.day)}\n${p.stops.map((s, i) => `${i + 1}. ${s.arrive} ${s.name}`).join("\n")}\nLeave ${p.leaveHome}, back ${p.backHome}.\n\nFull plan with map and trains: ${link}`;
      A().track("plan_share", null, { via: sv.dataset.psendvia });
      if(sv.dataset.psendvia === "wa"){ if(window.SO_native.isNative && await window.SO_native.share({ title: p.title, text: txt })) return; window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank", "noopener"); }
      else if(sv.dataset.psendvia === "mail") location.href = "mailto:?subject=" + encodeURIComponent(p.title + " · " + dayLabel(p.day)) + "&body=" + encodeURIComponent(txt);
      else A().copyPlain(link, "Link copied"); $("#pSendPop").hidden = true; return; }
    if(t.closest("[data-pcal]")){ const blob = new Blob([icsFor(PL.plan)], { type: "text/calendar" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "day-plan-" + PL.plan.day + ".ics"; document.body.appendChild(a); a.click(); a.remove(); A().track("calendar", null, { plan: true }); return; }
  };
}
function speak(text){ if(!window.speechSynthesis) return A().toast("Your browser can't read this out loud."); speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = "en-GB"; speechSynthesis.speak(u); }

/* ---------- saved trips ("Plans" tab) ---------- */
async function loadTrips(){
  try{ const { data } = await window.sb.from("trips").select("id,title,day,plan,done,share_token").gte("day", A().ymd(A().addDays(A().TODAY, -1))).order("day"); A().S.trips = data || []; }catch(x){ A().S.trips = []; }
  return A().S.trips;
}
function tripsSection(){
  const trips = A().S.trips || [];
  return `<div class="sec-h"><h2>Day plans</h2><span class="count">${trips.length} planned</span><span class="line"></span></div>
    <div class="trips">${trips.map(t => `<button type="button" class="tripcard" data-trip="${esc(t.id)}"><span class="tday"><b>${esc(String(A().parseD(t.day).getDate()))}</b>${esc(MON[A().parseD(t.day).getMonth()])}</span><span class="tbody"><b>${esc(t.title)}</b><small>${esc(dayLabel(t.day))} · ${(t.plan.stops || []).length} stops · leave ${esc(t.plan.leaveHome || "")}</small></span><span aria-hidden="true">›</span></button>`).join("")}
    <button type="button" class="tripcard new" data-plan-open>${icon("route")}<span class="tbody"><b>+ New day plan</b><small>Trains, lunch and the best events, made for your family</small></span></button></div>`;
}
function openTrip(id){ const t = (A().S.trips || []).find(x => x.id === id); if(!t) return; PL.trip = t; PL.plan = t.plan; show(); }
function todayBanner(){
  const t = (A().S.trips || []).find(x => x.day === A().ymd(A().TODAY)); if(!t) return "";
  return `<button type="button" class="todaytrip" data-trip="${esc(t.id)}">${icon("route")}<span><small>TODAY'S PLAN</small><b>${esc(t.title)}</b></span><span aria-hidden="true">Open ›</span></button>`;
}

document.addEventListener("click", e => {
  const o = e.target.closest("[data-plan-open]"); if(o){ e.preventDefault(); open({ from: o.dataset.from || "" }); return; }
  const a = e.target.closest("[data-act='planaround']"); if(a){ e.stopPropagation(); open({ anchorEventId: a.dataset.id, from: "event" }); return; }
  const tr = e.target.closest("[data-trip]"); if(tr){ openTrip(tr.dataset.trip); return; }
}, true);

window.SO_planner = { open, ctaHTML, tripsSection, todayBanner, loadTrips, openTrip };
})();
