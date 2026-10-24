/* "How Swiss Outings works": what we cover, how often, and where it comes from.
   Live numbers from the public coverage() function (aggregates only); falls back to counting the loaded events. */
(function(){
const A = () => window.__app;
const EMO = {Music:"🎸",Seasonal:"🎄",Culture:"🎭",Kids:"🧸",Outdoors:"🌲",Sport:"⚽",Festival:"🎪",Food:"🧀",Film:"🎬",Community:"🤝"};
const BLURB = {Music:"Big halls and tiny clubs",Seasonal:"Markets, lanterns, Samichlaus",Culture:"Museums, theatre, readings",Kids:"Puppets, circus, workshops",
  Outdoors:"Hikes, wildlife, stargazing",Sport:"FCZ, ZSC Lions, races",Festival:"Open-airs and street fests",Food:"Tastings, markets, supper clubs",Film:"Festivals and specials",Community:"Chilbi, expat and community days"};
const REG = [["Zurich City","Zurich city"],["Gold Coast","Gold Coast (Küsnacht to Meilen)"],["Canton Zurich","Rest of the canton"],["Switzerland","Elsewhere in Switzerland"]];
let COV = null, loading = null;

function fromEvents(){ // fallback: count what the app has loaded
  const a = A(); const up = ((a && a.S.events) || []).filter(e => !a.isPast(e));
  const cnt = f => up.filter(f).length, by = k => up.reduce((m,e)=>{ const v=e[k]; if(v) m[v]=(m[v]||0)+1; return m; }, {});
  const tags = {}; up.forEach(e => (e.tags||[]).forEach(t => { t=String(t).toLowerCase(); tags[t]=(tags[t]||0)+1; }));
  return { events: up.length, venues: new Set(up.map(e=>(e.venue||"").toLowerCase())).size, towns: new Set(up.map(e=>(e.city||"").toLowerCase())).size,
    new7: cnt(e => a.isNew && a.isNew(e)), free: cnt(e => e.free), gems: cnt(e => e.scale==="gem"),
    kids: cnt(e => (e.audience||[]).some(x => x==="Kids"||x==="Family")), months: 12,
    categories: by("category"), regions: by("region"), tags, sources: 300, sourceGroups: null, samples: [], lastRun: a && a.S.meta && a.S.meta.lastRun };
}
function load(){
  if(COV) return Promise.resolve(COV);
  if(!loading) loading = (async () => {
    try{ const { data, error } = await window.sb.rpc("coverage"); if(!error && data && data.events) COV = data; }catch(x){}
    return COV;
  })();
  return loading;
}
function get(){ return COV || fromEvents(); }
const n = x => (+x || 0).toLocaleString("en-US").replace(/,/g, "’");
function ago(s){ if(!s) return ""; const h = (Date.now() - new Date(s)) / 36e5; if(isNaN(h)) return ""; return h < 1 ? "less than an hour ago" : h < 24 ? Math.round(h) + " hours ago" : Math.round(h/24) + " days ago"; }
function when(s){ const d = new Date(String(s||"").slice(0,10)+"T12:00"); return isNaN(d) ? "" : d.toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"}); }

function html(opts){
  opts = opts || {}; const c = get(), esc = A().esc, t = c.tags || {}, g = c.sourceGroups || {};
  const cats = Object.entries(c.categories || {}).sort((a,b) => b[1]-a[1]);
  const regTotal = Object.values(c.regions || {}).reduce((s,v)=>s+v, 0) || 1;
  const gemPct = c.events ? Math.round(100 * c.gems / c.events) : 0;
  const tick = (num, label) => `<div class="st-num"><b>${n(num)}</b><span>${label}</span></div>`;
  const samples = (c.samples || []).map(s => `<${opts.gate?"div":"button type=\"button\""} class="st-sample" ${opts.gate?"":`data-story-open="${esc(s.id)}"`}><span class="st-se">${EMO[s.category]||"✨"}</span><span><b>${esc(s.title)}</b><small>${esc(s.city||"")} · ${esc(when(s.start))}</small></span></${opts.gate?"div":"button"}>`).join("");
  return `<div class="story">
  <section class="st-hero">
    <p class="st-kicker">How Swiss Outings works</p>
    <h3>While you sleep, we go looking.</h3>
    <p>Every night, before Zurich wakes up, Swiss Outings reads <b>${n(c.sources)} event pages</b> across Switzerland: concert halls and village councils, nature parks and puppet theatres. By breakfast, the good stuff is in your feed.</p>
  </section>

  <ol class="st-night">
    <li><span class="st-time">3:20</span><div><b>🌙 The quiet corners</b><p>The first round visits ${g.nature?`${n(g.nature)} nature and outdoor sources and ${n(g.niche||0)} niche ones`:"nature parks and niche sources"}: observatories, castles, farms, small museums, village websites. About 70 a night, so each gets a fresh look every few days.</p></div></li>
    <li><span class="st-time">4:45</span><div><b>🎸 The stages</b><p>Then the rounds of ${g.zurich?n(g.zurich)+" ":""}Zurich-area venues: the small clubs where the good gigs hide, plus the big halls the moment a headliner is announced. Prices and ticket status are re-checked, and anything selling fast gets flagged.</p></div></li>
    <li><span class="st-time">7:00</span><div><b>☀️ Your feed</b><p>Only events we found on a real, official page make it in, each with a link to it. ${c.lastAdded?`Last night brought <b>${n(c.lastAdded)} new</b>${c.lastRun?` (updated ${esc(ago(c.lastRun))})`:""}. `:""}This week so far: <b>${n(c.new7)} new</b>.</p></div></li>
  </ol>

  <section><h4>Right now in the app</h4>
    <div class="st-nums">${tick(c.events,"upcoming events")}${tick(c.venues,"venues")}${tick(c.towns,"towns and villages")}${tick(c.months,"months ahead")}${tick(c.kids,"for kids and families")}${tick(c.free,"completely free")}</div>
  </section>

  <section><h4>What's in it</h4>
    <div class="st-cats">${cats.map(([k,v]) => `<${opts.gate?"div":"button type=\"button\""} class="st-cat" ${opts.gate?"":`data-story-cat="${esc(k)}"`}><span class="st-ce">${EMO[k]||"•"}</span><span><b>${esc(k)} <em>${n(v)}</em></b><small>${esc(BLURB[k]||"")}</small></span></${opts.gate?"div":"button"}>`).join("")}</div>
  </section>

  <section class="st-gems"><h4>Off the beaten track</h4>
    <p><b>${gemPct}%</b> of what we list are small finds you won't see on a billboard: ${n(t["village"]||0)} village and tradition days, ${n(t["nature"]||0)} nature outings${t["wildlife"]?` (${n(t["wildlife"])} wildlife, ${n(t["stargazing"]||0)} stargazing nights, ${n(t["guided hike"]||0)} guided hikes)`:""}, ${n(t["hands-on"]||0)} hands-on workshops and ${n(t["small venue"]||0)} small-venue gigs. The big names are here too, but the little ones are why we built it.</p>
    ${samples?`<p class="st-sub">Coming up, for example:</p><div class="st-samples">${samples}</div>`:""}
  </section>

  <section><h4>Where</h4>
    <div class="st-regs">${REG.map(([k,l]) => { const v=(c.regions||{})[k]||0; return `<div class="st-reg"><span>${l}</span><i style="--w:${Math.max(3, Math.round(100*v/regTotal))}%"></i><b>${n(v)}</b></div>`; }).join("")}</div>
    <p class="st-sub">Zurich-focused, with day trips worth the train ride from all over Switzerland.</p>
  </section>

  <section class="st-small"><h4>Good to know</h4>
    <ul>
      <li>Every event links to its official page. Times and prices can change, so check there before you travel or buy.</li>
      <li>Tap <b>Not for us</b> on anything you don't like and the nightly search learns your taste.</li>
      <li>Missing a place you love? Tell us and it joins the nightly round.</li>
    </ul>
    ${opts.gate?"":`<div class="btnrow"><button class="btn" type="button" data-contact="venue">Suggest a place</button><button class="btn primary" type="button" data-close="1">Show me events</button></div>`}
  </section>
</div>`;
}
function open(from){
  const a = A(); a.sheetShell("How it works", html());
  a.track("story", null, { from: from || "menu" });
  if(!COV) load().then(c => { if(c && document.querySelector("#sheetHost .story")) { const sh = document.querySelector("#sheetHost .sheet"), top = sh && sh.scrollTop; a.sheetShell("How it works", html()); const s2 = document.querySelector("#sheetHost .sheet"); if(s2) s2.scrollTop = top; } });
}
// one-line summary for the welcome screen / tips
function teaser(){ const c = get(); return { events: c.events, venues: c.venues, sources: c.sources, towns: c.towns, gems: c.gems }; }

document.addEventListener("click", ev => {
  const t = ev.target;
  if(t.closest("[data-story]")){ ev.preventDefault(); open(t.closest("[data-story]").dataset.story); return; }
  const o = t.closest("[data-story-open]"); if(o){ const a = A(); a.closeSheet(); a.openSheet(o.dataset.storyOpen); return; }
  const k = t.closest("[data-story-cat]"); if(k){ const a = A(); a.S.cats = new Set([k.dataset.storyCat]); a.S.view = "discover"; a.closeSheet(); a.buildFilters(); a.render(); a.track("filter", null, { from: "story", cat: k.dataset.storyCat }); window.scrollTo(0, 0); }
});
window.SO_story = { load, get, html, open, teaser };
})();
