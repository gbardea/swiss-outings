
(function(){
"use strict";
/* ---------- constants ---------- */
const TODAY = new Date(); TODAY.setHours(0,0,0,0);
const CATS = {
  Music:{c:"#6D28D9",c2:"#F472B6",c3:"#1E1B4B"},
  Festival:{c:"#F59E0B",c2:"#E11D48",c3:"#FFF7E0"},
  Kids:{c:"#0EA5E9",c2:"#FACC15",c3:"#E0F2FE"},
  Culture:{c:"#1E3A8A",c2:"#F97316",c3:"#DBEAFE"},
  Film:{c:"#18181B",c2:"#EF4444",c3:"#FDE68A"},
  Outdoors:{c:"#166534",c2:"#A3E635",c3:"#DCFCE7"},
  Sport:{c:"#15803D",c2:"#FFFFFF",c3:"#052E16"},
  Food:{c:"#EA580C",c2:"#FDE047",c3:"#FFEDD5"},
  Seasonal:{c:"#0B3D5C",c2:"#FBBF24",c3:"#E0F2FE"},
  Community:{c:"#0F766E",c2:"#FB7185",c3:"#CCFBF1"}
};
const AUD = [{k:"all",l:"Everyone"},{k:"Parents",l:"Parents",sw:"#7C3AED"},{k:"Kids",l:"Kids",sw:"#E8590C"},{k:"Family",l:"Family",sw:"#0CA678"}];
const TOGGLES = [
  {k:"free",l:"Free"},{k:"gem",l:"Hidden gems"},{k:"big",l:"Big names"},
  {k:"english",l:"English-friendly"},{k:"outdoor",l:"Outdoor"},{k:"newonly",l:"New this week"},{k:"hot",l:"Book soon"},{k:"small",l:"Small venues"},{k:"cheap",l:"Under CHF 50"}
];
const DEFAULT_BRIEF = `Family: two parents (GBD & Corie) and kids Liam and Ellie, living in Küsnacht on Lake Zurich.
Kids love: carnivals, kids festivals, hands-on activities.
Parents love: concerts (folk, 80s, 90s, indie, famous bands), film festivals, cultural events (e.g. autumn cow parades), hikes, bike rides, local soccer, food, date nights.
Scope: all of Switzerland, Zurich-focused. Prioritise English or no-language-needed events.
Any day, any time. No budget cap.
Mix big headline events with off-the-beaten-track ones: local culture, unique traditions, small music venues, village events.
Also include Israeli / Jewish and English-speaking expat community events.`;

/* ---------- state ---------- */
const S = {
  events: [], hidden: {}, marks: {}, members: {}, friendPicks: {}, config: {}, household: null, isAdmin: false, invites: {}, settings: {emails: []}, meta: null,
  view: "discover", aud: "all", cats: new Set(), toggles: new Set(), when: "all", region: "all", q: "",
  whoTab: "Parents", calMonth: new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), calSel: null,
  db: null, user: null, mcp: null, uid: null, me: null, loaded: false, dbFailed: false, canWrite: true
};
try{ const v = localStorage.getItem("so.view"); if(v) S.view = v; }catch(e){}

/* ---------- helpers ---------- */
const $ = (s, r=document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function hash(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
function rng(seed){ let a=seed||1; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function parseD(s){ if(!s) return null; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/); if(!m) return null; return new Date(+m[1], +m[2]-1, +m[3], m[4]?+m[4]:0, m[5]?+m[5]:0); }
function dayOnly(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
const DOW=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], MONL=["January","February","March","April","May","June","July","August","September","October","November","December"];
function hhmm(d){ return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
function ymd(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function evStart(e){ return parseD(e.start); }
function evEnd(e){ const s=evStart(e); const en=parseD(e.end); return en && en>=s ? en : s; }
function spanDays(e){ return Math.round((dayOnly(evEnd(e))-dayOnly(evStart(e)))/864e5); }
function isPast(e){ return dayOnly(evEnd(e)) < TODAY; }
function isOngoing(e){ return dayOnly(evStart(e)) < TODAY && !isPast(e); }
function whenText(e){
  const s=evStart(e), en=evEnd(e), sd=spanDays(e);
  const base = DOW[s.getDay()]+" "+s.getDate()+" "+MON[s.getMonth()]+(s.getFullYear()!==TODAY.getFullYear()?" "+s.getFullYear():"");
  if(sd>0){ return base+" – "+DOW[en.getDay()]+" "+en.getDate()+" "+MON[en.getMonth()]+(en.getFullYear()!==s.getFullYear()?" "+en.getFullYear():""); }
  return base + (e.timeKnown && /T/.test(e.start) ? " · "+hhmm(s)+(e.end && /T/.test(e.end)?"–"+hhmm(en):"") : "");
}
function isNew(e){
  const f=parseD(e.firstSeen); const seed = parseD((S.meta&&S.meta.seedDate)||"2026-09-26");
  return f && f>seed && (TODAY-f)/864e5 <= 7;
}
function isHot(e){ return e.ticketStatus==="selling fast" || (e.ticketStatus==="not yet on sale") ; }
/* only ever put http(s) links into href attributes (event data comes from the web) */
function safeHref(u){ u=String(u||"").trim(); return /^https?:\/\//i.test(u) ? u : ""; }

/* ---------- activity log (admin page) ---------- */
const LOGQ=[]; let logT=null;
function track(kind, eventId, meta){
  LOGQ.push({kind, event_id:eventId||null, meta:meta||{}});
  clearTimeout(logT); logT=setTimeout(flushLog, 2500);
}
function flushLog(){ if(!LOGQ.length || !window.sb || !S.uid) return; const p=LOGQ.splice(0,50); window.sb.rpc("log_activity",{p}).then(()=>{},()=>{}); if(LOGQ.length) logT=setTimeout(flushLog,1000); }
document.addEventListener("visibilitychange", ()=>{ if(document.hidden) flushLog(); });
window.addEventListener("pagehide", flushLog);

/* ---------- voice summaries ("Listen") ---------- */
// Must match voiceVersion() in lib/voice.js so the edge cache is shared.
function voiceVersion(e){ const s=[e.updatedAt||"", e.start||"", e.title||"", e.ticketStatus||"", e.priceFromCHF==null?"":e.priceFromCHF].join("|"); return hash(s).toString(36); }
const VO={id:null, audio:null, state:null, left:null, utter:null};
function voiceUrl(e){ return window.SO_native.api("/api/voice")+"?id="+encodeURIComponent(e.id)+"&v="+voiceVersion(e); }
function stopVoice(){
  if(VO.audio){ try{ VO.audio.pause(); VO.audio.removeAttribute("src"); VO.audio.load(); }catch(x){} }
  if(VO.utter && window.speechSynthesis){ try{ speechSynthesis.cancel(); }catch(x){} }
  const id=VO.id; VO.id=null; VO.audio=null; VO.utter=null; VO.state=null; VO.left=null; if(id) paintListen(id);
}
function fmtLeft(s){ s=Math.max(0,Math.ceil(s||0)); return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
function listenInner(id, big){
  const on=VO.id===id;
  if(on && VO.state==="loading") return `<span class="spin" aria-hidden="true"></span><span>${big?"Getting it ready…":"Loading"}</span>`;
  if(on) return `<span class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span>${VO.left!=null?fmtLeft(VO.left):"Playing"}</span>${big?"<span class=\"lsub\">tap to stop</span>":""}`;
  return `${icon("sound")}<span>${big?"Listen · 20-second summary":"Listen"}</span>`;
}
function listenBtn(e, big){ return `<button type="button" class="${big?"btn listen-big":"listen"} ${VO.id===e.id?"playing":""}" data-act="listen" data-id="${esc(e.id)}" aria-label="${VO.id===e.id?"Stop the spoken summary":"Listen to a short spoken summary of "+esc(e.title)}">${listenInner(e.id,big)}</button>`; }
function paintListen(id){
  document.querySelectorAll(`[data-act="listen"][data-id="${CSS.escape(id)}"]`).forEach(b=>{
    const big=b.classList.contains("listen-big"); b.classList.toggle("playing", VO.id===id); b.innerHTML=listenInner(id,big);
    b.setAttribute("aria-label", VO.id===id ? "Stop the spoken summary" : "Listen to a short spoken summary");
  });
}
function speakFallback(id, script){
  if(VO.id!==id) return;
  if(!window.speechSynthesis || !script){ stopVoice(); toast("Sorry, the spoken summary isn't available right now."); return; }
  const u=new SpeechSynthesisUtterance(script); u.lang="en-GB"; u.rate=1.02;
  const v=speechSynthesis.getVoices().find(x=>/en[-_](GB|US|AU|IE)/i.test(x.lang) && /natural|enhanced|premium|siri|google/i.test(x.name)) || speechSynthesis.getVoices().find(x=>/^en/i.test(x.lang));
  if(v) u.voice=v;
  const total=Math.max(8, script.split(/\s+/).length/2.6); const t0=Date.now();
  u.onstart=()=>{ if(VO.id!==id) return; VO.state="playing"; const tick=()=>{ if(VO.id!==id||VO.utter!==u) return; VO.left=total-(Date.now()-t0)/1000; paintListen(id); setTimeout(tick,500); }; tick(); };
  u.onend=u.onerror=()=>{ if(VO.utter===u) stopVoice(); };
  VO.utter=u; speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function listen(id){
  if(VO.id===id){ stopVoice(); return; }
  stopVoice();
  const e=S.events.find(x=>x.id===id); if(!e) return;
  VO.id=id; VO.state="loading"; paintListen(id); track("listen", id);
  // iOS needs audio and speech to start inside the tap, so start both "unlocks" right here.
  if(window.speechSynthesis){ try{ const w=new SpeechSynthesisUtterance(" "); w.volume=0; speechSynthesis.speak(w); }catch(x){} }
  const a=new Audio(); VO.audio=a; a.preload="auto"; a.src=voiceUrl(e);
  a.onplaying=()=>{ if(VO.audio!==a) return; VO.state="playing"; paintListen(id); };
  a.ontimeupdate=()=>{ if(VO.audio!==a||!isFinite(a.duration)) return; const l=Math.ceil(a.duration-a.currentTime); if(l!==VO.left){ VO.left=l; paintListen(id); } };
  a.onended=()=>{ if(VO.audio===a) stopVoice(); };
  a.onerror=async()=>{ if(VO.audio!==a) return; VO.audio=null;
    // The server answers with JSON when no AI voice is set up (or it failed): read that script with the phone's voice.
    try{ const r=await fetch(voiceUrl(e)); const j=await r.json(); speakFallback(id, j.script); }catch(x){ speakFallback(id, null); } };
  const p=a.play(); if(p&&p.catch) p.catch(err=>{ if(err&&err.name==="NotAllowedError"&&VO.audio===a){ stopVoice(); toast("Tap Listen again to play."); } });
}
function audClass(a){ return a==="Parents"?"P":a==="Kids"?"K":"F"; }

/* ---------- poster art (generative, per category) ---------- */
function poster(e, opts={}){
  const cat = CATS[e.category] || CATS.Culture; const R = rng(hash(e.id||e.title)); const W=400,H=300;
  const t=(e.title+" "+(e.tags||[]).join(" ")).toLowerCase();
  let g="";
  const bg = cat.c;
  const r = (a,b)=> a + R()*(b-a);
  if(e.category==="Music"){
    const cx=r(220,330), cy=r(120,190);
    for(let i=9;i>0;i--){ g+=`<circle cx="${cx}" cy="${cy}" r="${i*22}" fill="none" stroke="${i%2?cat.c2:"#fff"}" stroke-opacity="${i%2?.55:.12}" stroke-width="${i%3?2:6}"/>`; }
    g+=`<circle cx="${cx}" cy="${cy}" r="30" fill="${cat.c2}"/><circle cx="${cx}" cy="${cy}" r="5" fill="${bg}"/>`;
    for(let i=0;i<14;i++){ const h=r(20,120); g+=`<rect x="${20+i*12}" y="${H-h-30}" width="7" height="${h}" rx="3" fill="#fff" fill-opacity="${.25+R()*.5}"/>`; }
  } else if(e.category==="Festival" || /carnival|chilbi|fair|fasnacht|messe/.test(t)){
    for(let row=0;row<3;row++){ const y0=r(30,90)+row*50; const sag=r(20,40); const n=9;
      let d=`M0 ${y0} Q ${W/2} ${y0+sag*2} ${W} ${y0}`; g+=`<path d="${d}" stroke="#fff" stroke-opacity=".5" fill="none"/>`;
      for(let i=0;i<n;i++){ const x=(i+.5)*W/n; const tt=(i+.5)/n; const y=y0+ (1-(2*tt-1)**2)*sag; const col=[cat.c2,"#fff","#22C55E","#3B82F6","#FDE047"][Math.floor(R()*5)];
        g+=`<path d="M${x-15} ${y} L${x+15} ${y} L${x} ${y+30} Z" fill="${col}" fill-opacity=".92"/>`; } }
    for(let i=0;i<40;i++){ g+=`<rect x="${r(0,W)}" y="${r(150,H)}" width="${r(4,10)}" height="${r(4,10)}" transform="rotate(${r(0,90)} ${r(0,W)} ${r(150,H)})" fill="${["#fff",cat.c2,"#FDE047","#22D3EE"][i%4]}" fill-opacity=".85"/>`; }
  } else if(e.category==="Kids"){
    for(let i=0;i<7;i++){ const x=r(30,W-30), y=r(40,200), rr=r(22,40); const col=["#F43F5E","#FACC15","#22C55E","#A855F7","#FB923C","#fff"][i%6];
      g+=`<path d="M${x} ${y+rr} q ${r(-20,20)} 40 ${r(-10,10)} ${r(60,120)}" stroke="#fff" stroke-opacity=".6" fill="none"/>`;
      g+=`<ellipse cx="${x}" cy="${y}" rx="${rr*.85}" ry="${rr}" fill="${col}"/><ellipse cx="${x-rr*.3}" cy="${y-rr*.35}" rx="${rr*.18}" ry="${rr*.28}" fill="#fff" fill-opacity=".45"/>`; }
  } else if(e.category==="Film"){
    g+=`<circle cx="${r(230,310)}" cy="${r(110,170)}" r="${r(80,110)}" fill="${cat.c2}"/>`;
    for(let s=0;s<2;s++){ const y=s?H-46:18; g+=`<rect x="0" y="${y}" width="${W}" height="28" fill="#000" fill-opacity=".6"/>`; for(let i=0;i<20;i++) g+=`<rect x="${6+i*20}" y="${y+8}" width="10" height="12" rx="2" fill="${cat.c3}" fill-opacity=".8"/>`; }
    g+=`<path d="M0 ${H} L ${r(120,200)} ${r(60,120)} L ${r(220,300)} ${H} Z" fill="#fff" fill-opacity=".08"/>`;
  } else if(e.category==="Outdoors" || /hike|walk|bike|slowup/.test(t)){
    g+=`<circle cx="${r(80,320)}" cy="${r(50,90)}" r="${r(26,40)}" fill="${cat.c2}"/>`;
    const layers=4; for(let l=0;l<layers;l++){ let d=`M0 ${H}`; let x=0; const base=120+l*40; d+=` L0 ${base+r(-10,20)}`; while(x<W){ x+=r(40,90); d+=` L${Math.min(x,W)} ${base+r(-60,30)}`; } d+=` L${W} ${H} Z`;
      const op=[.35,.55,.75,1][l]; g+=`<path d="${d}" fill="${l===3?"#052E16":"#fff"}" fill-opacity="${l===3?.55:op*.4}"/>`; }
    if(/cow|alp|désalpe|alpabzug|alpabfahrt|chästeilet/.test(t)){ for(let i=0;i<5;i++){ const x=40+i*70+r(-10,10); g+=`<circle cx="${x}" cy="${H-40}" r="11" fill="#fff"/><path d="M${x-6} ${H-51} l-7 -8 M${x+6} ${H-51} l7 -8" stroke="#fff" stroke-width="3"/>`; } }
  } else if(e.category==="Sport"){
    g+=`<rect x="20" y="20" width="${W-40}" height="${H-40}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3"/><line x1="${W/2}" y1="20" x2="${W/2}" y2="${H-20}" stroke="#fff" stroke-opacity=".7" stroke-width="3"/><circle cx="${W/2}" cy="${H/2}" r="46" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3"/>`;
    g+=`<rect x="20" y="${H/2-60}" width="60" height="120" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3"/><rect x="${W-80}" y="${H/2-60}" width="60" height="120" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3"/>`;
    for(let i=0;i<10;i++) g+=`<rect x="${i*40}" y="0" width="20" height="${H}" fill="#fff" fill-opacity=".04"/>`;
    const bx=r(120,300), by=r(80,200); g+=`<circle cx="${bx}" cy="${by}" r="20" fill="#fff"/><path d="M${bx-7} ${by-6} l7 -5 7 5 -3 8 h-8z" fill="#14181D"/>`;
    if(/hockey|zsc|spengler/.test(t)) g+=`<ellipse cx="${bx+60}" cy="${by+40}" rx="22" ry="8" fill="#000"/>`;
    if(/ski|lauberhorn|adelboden/.test(t)) g+=`<path d="M0 ${H} L${W} ${r(20,80)} L${W} ${H}Z" fill="#fff" fill-opacity=".85"/>`;
  } else if(e.category==="Food"){
    for(let y=0;y<8;y++) for(let x=0;x<11;x++){ const rr=R()<.15?14:4; g+=`<circle cx="${18+x*37+(y%2)*18}" cy="${18+y*38}" r="${rr}" fill="${rr>5?cat.c2:"#fff"}" fill-opacity="${rr>5?.95:.35}"/>`; }
    g+=`<circle cx="${r(220,300)}" cy="${r(130,170)}" r="78" fill="#fff" fill-opacity=".92"/><circle cx="${r(250,270)}" cy="${r(140,160)}" r="54" fill="none" stroke="${bg}" stroke-opacity=".3" stroke-width="3"/>`;
  } else if(e.category==="Seasonal"){
    const lantern=/lantern|räbe|liecht|martin|lichter/.test(t), xmas=/christ|advent|wienacht|weihnacht|noël|noel|chlaus|klaus|samichlaus|winter|ice|silvester|new year/.test(t);
    const bg2 = lantern?"#1C1033":xmas?"#0B2A40":"#7C2D12"; g+=`<rect width="${W}" height="${H}" fill="${bg2}"/>`;
    if(lantern){ for(let i=0;i<9;i++){ const x=r(20,W-20), y=r(60,H-40), rr=r(12,26); g+=`<circle cx="${x}" cy="${y}" r="${rr*2.4}" fill="#FDBA74" fill-opacity=".12"/><circle cx="${x}" cy="${y}" r="${rr}" fill="#FB923C"/><path d="M${x-rr*.4} ${y} h${rr*.8}" stroke="#7C2D12" stroke-width="3"/><line x1="${x}" y1="${y-rr}" x2="${x}" y2="${y-rr-18}" stroke="#fff" stroke-opacity=".4"/>`; } }
    else if(xmas){ for(let i=0;i<60;i++) g+=`<circle cx="${r(0,W)}" cy="${r(0,H)}" r="${r(1,3.4)}" fill="#fff" fill-opacity="${r(.3,.9)}"/>`;
      for(let i=0;i<14;i++){ const x=15+i*28; g+=`<circle cx="${x}" cy="${40+Math.sin(i*.8)*12}" r="6" fill="${["#FBBF24","#F43F5E","#34D399"][i%3]}"/>`; }
      const tx=r(260,320); g+=`<path d="M${tx} 90 l50 90 h-100z M${tx} 140 l62 110 h-124z" fill="#16A34A"/><rect x="${tx-9}" y="250" width="18" height="30" fill="#78350F"/><circle cx="${tx}" cy="86" r="9" fill="#FBBF24"/>`; }
    else { for(let i=0;i<26;i++){ const x=r(0,W), y=r(0,H), s=r(10,24); g+=`<path d="M${x} ${y} q ${s} ${-s} ${s*2} 0 q ${-s} ${s} ${-s*2} 0z" fill="${["#F59E0B","#DC2626","#FCD34D","#B45309"][i%4]}" fill-opacity=".85" transform="rotate(${r(0,360)} ${x} ${y})"/>`; } }
  } else if(e.category==="Community"){
    for(let i=0;i<5;i++) g+=`<circle cx="${r(100,300)}" cy="${r(90,210)}" r="${r(60,100)}" fill="${[cat.c2,"#fff","#FDE047"][i%3]}" fill-opacity=".35" style="mix-blend-mode:screen"/>`;
    if(/israel|jewish|chanuk|hanuk|menorah|shabbat/.test(t)){ const x=r(220,300),y=140; g+=`<path d="M${x} ${y-50} l43 75 h-86z M${x} ${y+50} l43 -75 h-86z" fill="none" stroke="#fff" stroke-width="7"/>`; }
  } else { // Culture
    for(let i=0;i<6;i++){ const x=i*70+r(-5,5), w=56, h=r(110,200); g+=`<path d="M${x} ${H} V${H-h+w/2} a${w/2} ${w/2} 0 0 1 ${w} 0 V${H}Z" fill="${i%2?cat.c2:"#fff"}" fill-opacity="${i%2?.9:.18}"/>`; }
    g+=`<circle cx="${r(260,340)}" cy="${r(50,90)}" r="30" fill="#FDE047"/>`;
  }
  const grain = !opts.grain ? "" : `<filter id="gr${opts.uid||""}"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .18 0"/></filter>`;
  return `<svg class="poster" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${grain}<linearGradient id="sh${opts.uid||""}" x1="0" y1="0" x2="0" y2="1"><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs><rect width="${W}" height="${H}" fill="${bg}"/>${g}${opts.grain?`<rect width="${W}" height="${H}" filter="url(#gr${opts.uid||""})"/>`:""}<rect width="${W}" height="${H}" fill="url(#sh${opts.uid||""})"/></svg>`;
}

/* ---------- filters ---------- */
function matches(e){
  if(isPast(e)) return false;
  if(S.hidden[e.id]) return false;
  if(S.toggles.has("cheap") && !(e.free || (e.priceFromCHF!=null && e.priceFromCHF!=="" && +e.priceFromCHF<=50))) return false;
  if(S.aud!=="all" && !(e.audience||[]).includes(S.aud)) return false;
  if(S.cats.size && !S.cats.has(e.category)) return false;
  const tg=S.toggles;
  if(tg.has("free") && !e.free) return false;
  if(tg.has("gem") && e.scale!=="gem") return false;
  if(tg.has("big") && e.scale!=="big") return false;
  if(tg.has("english") && !(e.language==="English"||e.language==="No language needed"||e.language==="Mixed")) return false;
  if(tg.has("outdoor") && e.setting==="Indoor") return false;
  if(tg.has("newonly") && !isNew(e)) return false;
  if(tg.has("hot") && !isHot(e)) return false;
  if(tg.has("small") && !((e.tags||[]).includes("small venue"))) return false;
  if(S.region!=="all"){
    if(S.region==="near"){ if(!(e.region==="Zurich City"||e.region==="Gold Coast")) return false; }
    else if(e.region!==S.region) return false;
  }
  if(S.when!=="all"){
    const s=dayOnly(evStart(e)), en=dayOnly(evEnd(e));
    if(S.when==="later"){ if(s < addDays(TODAY,90)) return false; }
    else { const lim=addDays(TODAY,+S.when); if(s>lim) return false; if(en<TODAY) return false; }
  }
  if(S.q){ const hay=(e.title+" "+e.venue+" "+e.city+" "+(e.tags||[]).join(" ")+" "+e.summary+" "+e.category).toLowerCase(); if(!S.q.split(/\s+/).every(w=>hay.includes(w))) return false; }
  if(S.from||S.to){ const a=S.from?parseD(S.from):null, b=S.to?parseD(S.to):null; if(b && dayOnly(evStart(e))>b) return false; if(a && dayOnly(evEnd(e))<a) return false; }
  if(S.maxPrice!=null && !(e.free || (e.priceFromCHF!=null && e.priceFromCHF!=="" && +e.priceFromCHF<=S.maxPrice))) return false;
  if(S.kw && S.kw.length){ const hay=(e.title+" "+(e.tags||[]).join(" ")+" "+e.summary+" "+(e.description||"")+" "+e.venue+" "+e.city).toLowerCase(); if(!S.kw.some(k=>hay.includes(k))) return false; }
  return true;
}
function filtered(){ return S.events.filter(matches).sort((a,b)=>evStart(a)-evStart(b)); }

/* ---------- picks (own household) ---------- */
function marksFor(id){ return S.marks[id] || {}; }
function myMark(id){ return S.uid ? (marksFor(id)[S.uid]||null) : null; }
function peopleFor(id){ return Object.entries(marksFor(id)).filter(([u,st])=>st==="interested"||st==="going"); }
function personName(u){ const m=S.members[u]; return (m&&m.display_name)||(u===S.uid?"You":"Partner"); }
function initials(n){ return (n||"?").split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase(); }
function colorFor(u){ const c=["#7C3AED","#E8590C","#0CA678","#1D4ED8","#D6336C","#B45309"]; return c[hash(u)%c.length]; }
function avatarEl(u,title){ return `<span class="av" title="${esc(title||personName(u))}" style="background:${colorFor(u)}">${esc(initials(personName(u)))}</span>`; }
function avatars(id){
  const ps = peopleFor(id); const fr = S.friendPicks[id]||[];
  if(!ps.length && !fr.length) return "";
  return `<div class="who">${ps.map(([u,st])=>avatarEl(u, personName(u)+" · "+st)).join("")}${fr.length?`<span class="av fr" title="${esc(fr.map(f=>f.household_name+" · "+f.state).join(", "))}">+${fr.length}</span>`:""}</div>`;
}

/* ---------- card renderers ---------- */
let uidSeq=0;
function dateBox(e){
  const s=evStart(e), en=evEnd(e), sd=spanDays(e);
  if(isOngoing(e)) return `<div class="datebox range"><div class="dw">On now</div><div class="dd">till ${en.getDate()}</div><div class="dm">${MON[en.getMonth()]}</div></div>`;
  if(sd>0 && en.getMonth()!==s.getMonth()) return `<div class="datebox range"><div class="dw">${s.getDate()} ${MON[s.getMonth()]} →</div><div class="dd">${en.getDate()}</div><div class="dm">${MON[en.getMonth()]}</div></div>`;
  if(sd>0 && sd<40) return `<div class="datebox range"><div class="dw">${DOW[s.getDay()]}–${DOW[en.getDay()]}</div><div class="dd">${s.getDate()}–${en.getDate()}</div><div class="dm">${MON[s.getMonth()]}${en.getMonth()!==s.getMonth()?"/"+MON[en.getMonth()]:""}</div></div>`;
  return `<div class="datebox"><div class="dw">${DOW[s.getDay()]}</div><div class="dd">${s.getDate()}</div><div class="dm">${MON[s.getMonth()]}${s.getFullYear()!==TODAY.getFullYear()?" ’"+String(s.getFullYear()).slice(2):""}</div></div>`;
}
function statusTags(e){
  let t=""; if(S.invites[e.id]) t+=`<span class="tag inv">✓ Invited</span>`; if(isNew(e)) t+=`<span class="tag new">New</span>`;
  if(e.ticketStatus==="selling fast") t+=`<span class="tag hot">Selling fast</span>`;
  else if(e.ticketStatus==="sold out") t+=`<span class="tag sold">Sold out</span>`;
  else if(e.ticketStatus==="not yet on sale") t+=`<span class="tag hot">Sale soon</span>`;
  return t;
}
function icon(n){
  const P={heart:'<path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.3 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 18.7 5 21 8.3 19.5 11.8 17.5 16.4 12 21 12 21z"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',ticket:'<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2z"/><path d="M13 6v12" stroke-dasharray="2 2"/>',link:'<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',play:'<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="currentColor"/>',img:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',pin:'<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',
    sound:'<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    share:'<path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>',
    wa:'<path d="M4 20l1.3-4A8 8 0 1 1 8.4 19z"/><path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.6-2-1-1 1a4 4 0 0 1-2.4-2.4l1-1-1-2z" fill="currentColor" stroke="none"/>',
    users:'<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 4.5a3.2 3.2 0 0 1 0 6.4M18 14a6 6 0 0 1 3 6"/>',
    mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
    calq:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/><path d="m9 15 2 2 4-4"/>',
    sliders:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    phone:'<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    route:'<circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="5" r="2.5"/><path d="M8.5 19H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>',
    star:'<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    home:'<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/>',
    swap:'<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'};
  const fill = n==="heart"?"currentColor":"none";
  return `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
}
function actionsHTML(e){ // compact icon toggles on cards
  const m=myMark(e.id), id=esc(e.id), t=esc(e.title);
  return `<div class="cacts">
    <button class="ico skip" data-act="skip" data-id="${id}" title="Not for us" aria-label="Not for us: hide ${t}">${icon("x")}</button>
    <button class="ico int ${m==="interested"?"on":""}" data-act="int" data-id="${id}" aria-pressed="${m==="interested"}" title="Keen" aria-label="Keen on ${t}">${icon("heart")}</button>
    <button class="ico go ${m==="going"?"on":""}" data-act="go" data-id="${id}" aria-pressed="${m==="going"}" title="Going" aria-label="Going to ${t}">${icon("check")}</button>
  </div>`;
}
function audDots(e){ return (e.audience||[]).map(a=>`<span class="adot ${audClass(a)}">${esc(a)}</span>`).join(""); }
function placeText(e){ return (e.venue||"")+(e.city&&!(e.venue||"").includes(e.city)?(e.venue?", ":"")+e.city:""); }
function cardHTML(e){
  const id=++uidSeq;
  return `<article class="card" data-open="${esc(e.id)}" tabindex="0" aria-label="${esc(e.title)}">
    <div class="art">${poster(e,{uid:id})}
      <div class="tl"><span class="tag">${esc(e.category)}</span>${e.scale==="gem"?'<span class="tag gem">Gem</span>':""}</div>
      <div class="tr">${statusTags(e)}</div>
      <div class="bl">${dateBox(e)}${listenBtn(e)}</div><div class="br">${avatars(e.id)}${(()=>{const p=priceLabel(e);return `<span class="pricetag ${p.c}">${esc(p.t)}</span>`;})()}</div>
    </div>
    <div class="body">
      <h3 class="title">${esc(e.title)}</h3>
      ${e.summary?`<p class="blurb">${esc(e.summary)}</p>`:""}
      <p class="cmeta"><span class="mono">${esc(whenText(e))}</span><span>${esc(placeText(e))}</span></p>
      <div class="cfoot"><div class="auds">${audDots(e)}</div>${actionsHTML(e)}</div>
    </div>
  </article>`;
}
function fmtCHF(n){ n=+n; return Number.isInteger(n)?String(n):n.toFixed(0); }
function priceLabel(e){ if(e.free) return {t:"FREE",c:"free"}; const a=e.priceFromCHF, b=e.priceToCHF; if(a!=null&&a!==""&&+a>0){ const t = (b!=null&&b!==""&&+b>+a) ? "CHF "+fmtCHF(a)+"–"+fmtCHF(b) : "CHF "+fmtCHF(a)+((b==null||b==="")?"+":""); return {t, c:e.ticketStatus==="sold out"?"sold":""}; } if(a===0) return {t:"FREE",c:"free"}; return {t:/on sale/i.test(e.priceText||"")?(e.priceText.split("·").pop().trim()):"Price TBA",c:"tba"}; }
function shortPrice(e){ if(e.free) return "Free"; if(e.priceFromCHF!=null && e.priceFromCHF!=="") return "from CHF "+e.priceFromCHF; const p=(e.priceText||"").split(/[;(]/)[0]; return p.length>24?p.slice(0,22)+"…":p||"Price TBC"; }
function rowHTML(e){
  const s=evStart(e);
  return `<div class="lrow" data-open="${esc(e.id)}" tabindex="0"><div class="thumb">${poster(e,{uid:++uidSeq})}</div><div style="min-width:0"><div class="t">${esc(e.title)}</div><div class="s">${esc(e.city||"")} · ${esc(priceLabel(e).t)}${myMark(e.id)?" · "+(myMark(e.id)==="going"?"✓ going":"♥ keen"):""}</div></div><div class="d">${DOW[s.getDay()]}<b>${s.getDate()} ${MON[s.getMonth()]}</b></div></div>`;
}

/* ---------- views ---------- */
function render(){
  document.querySelectorAll(".seg button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.view===S.view));
  const main=$("#main");
  if(!S.loaded){ if(S.dbFailed) main.innerHTML=`<div class="empty">Couldn't load events. Check your connection and pull to refresh.</div>`; return; }
  uidSeq=0;
  if(S.view==="calendar") main.innerHTML = calendarView();
  else if(S.view==="who") main.innerHTML = whoView();
  else if(S.view==="ours") main.innerHTML = oursView();
  else main.innerHTML = discoverView();
  updCount();
}
function statusLine(){
  const m=S.meta||{}; const up=S.events.filter(e=>!isPast(e)); const nw=up.filter(isNew).length;
  return `<div class="status-line"><span><b>${up.length}</b> upcoming · updated ${esc(m.lastRun?fmtStamp(m.lastRun):"—")}</span>${nw?`<button type="button" class="newchip" data-tg="newonly" aria-pressed="${S.toggles.has("newonly")}">✦ ${nw} new this week</button>`:""}</div>${window.SO_install?window.SO_install.bannerHTML():""}`;
}
function fmtStamp(s){ const d=new Date(s); if(isNaN(d)) return s; const k=Math.round((dayOnly(d)-dayOnly(new Date()))/864e5); const day=k===0?"today":k===-1?"yesterday":DOW[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()]; return day+" "+hhmm(d); }
function weekendRange(){
  const d=TODAY.getDay(); let sat;
  if(d===6) sat=TODAY; else if(d===0) sat=addDays(TODAY,-1); else sat=addDays(TODAY,6-d);
  const fri=addDays(sat,-1); return [d===0?TODAY:(d===6?TODAY:fri), addDays(sat,1)];
}
function overlaps(e,a,b){ return dayOnly(evStart(e))<=b && dayOnly(evEnd(e))>=a; }
function discoverView(){
  const list=filtered();
  if(!list.length) return askBar()+statusLine()+`<div class="empty" style="margin-top:20px">Nothing matches these filters. <button class="chip" type="button" data-ask-clear>Clear all filters</button></div>`;
  const [wa,wb]=weekendRange();
  const wk=list.filter(e=>overlaps(e,wa,wb) && spanDays(e)<30);
  const ongoing=list.filter(e=>isOngoing(e) && spanDays(e)>=30);
  let h=askBar()+(window.SO_planner&&!S.askSummary?window.SO_planner.todayBanner()+window.SO_planner.ctaHTML():"")+statusLine();
  if(wk.length){ h+=sec("This weekend", wk.length, `${DOW[wa.getDay()]} ${wa.getDate()} – ${DOW[wb.getDay()]} ${wb.getDate()} ${MON[wb.getMonth()]}`)+`<div class="rail">${wk.map(cardHTML).join("")}</div>`; }
  const after=list.filter(e=>!wk.includes(e) && !ongoing.includes(e));
  const byMonth={}; after.forEach(e=>{ const s=isOngoing(e)?TODAY:evStart(e); const k=s.getFullYear()+"-"+String(s.getMonth()).padStart(2,"0"); (byMonth[k]=byMonth[k]||[]).push(e); });
  Object.keys(byMonth).sort().forEach(k=>{ const [y,m]=k.split("-").map(Number); const arr=byMonth[k]; h+=sec(MONL[m]+(y!==TODAY.getFullYear()?" "+y:""), arr.length)+`<div class="grid">${arr.map(cardHTML).join("")}</div>`; });
  if(ongoing.length){ h+=sec("Running for months", ongoing.length, "exhibitions & long runs")+`<div class="grid">${ongoing.map(cardHTML).join("")}</div>`; }
  return h;
}
function sec(t,n,sub){ return `<div class="sec-h"><h2>${esc(t)}</h2><span class="count">${n} ${n===1?"event":"events"}${sub?" · "+esc(sub):""}</span><span class="line"></span></div>`; }

function calendarView(){
  const list=filtered(); const m0=S.calMonth; const y=m0.getFullYear(), mo=m0.getMonth();
  const first=new Date(y,mo,1); const startOff=(first.getDay()+6)%7; const gridStart=addDays(first,-startOff);
  const days=[]; for(let i=0;i<42;i++) days.push(addDays(gridStart,i));
  const lastRowNeeded = days.slice(35).some(d=>d.getMonth()===mo); const cells = lastRowNeeded?days:days.slice(0,35);
  const byDay={}; const longRuns=[];
  list.forEach(e=>{ const sd=spanDays(e); if(sd>7){ if(overlaps(e,first,new Date(y,mo+1,0))) longRuns.push(e); const k=ymd(dayOnly(evStart(e))); (byDay[k]=byDay[k]||[]).push(e); return; }
    for(let i=0;i<=sd;i++){ const k=ymd(addDays(dayOnly(evStart(e)),i)); (byDay[k]=byDay[k]||[]).push(e); } });
  let h=`<div class="calhead"><h2>${MONL[mo]} ${y}</h2><button class="iconbtn" data-cal="-1" aria-label="Previous month">‹ Prev</button><button class="iconbtn" data-cal="0">Today</button><button class="iconbtn" data-cal="1" aria-label="Next month">Next ›</button></div>`;
  h+=`<div class="cal">`+["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div class="dow">${d}</div>`).join("");
  cells.forEach(d=>{ const k=ymd(d); const evs=(byDay[k]||[]); const cls=["day"]; if(d.getMonth()!==mo) cls.push("out"); if(+d===+TODAY) cls.push("today"); if(S.calSel===k) cls.push("sel"); if(d.getDay()===0||d.getDay()===6) cls.push("we");
    h+=`<div class="${cls.join(" ")}" data-day="${k}" tabindex="0" aria-label="${d.getDate()} ${MONL[d.getMonth()]}, ${evs.length} events"><span class="n">${d.getDate()}</span>`+
      evs.slice(0,3).map(e=>`<div class="ev" style="background:${CATS[e.category]?.c||"#333"}" data-open="${esc(e.id)}">${myMark(e.id)==="going"?"✓ ":myMark(e.id)?"♥ ":""}${esc(e.title)}</div>`).join("")+
      (evs.length>3?`<span class="more">+${evs.length-3} more</span>`:"")+
      `<div class="dots">${evs.slice(0,6).map(e=>`<i style="background:${CATS[e.category]?.c}"></i>`).join("")}</div></div>`; });
  h+=`</div><div class="legend">${Object.entries(CATS).map(([k,v])=>`<span><i style="background:${v.c}"></i>${k}</span>`).join("")}</div>`;
  const sel = S.calSel ? (byDay[S.calSel]||[]) : null;
  if(sel){ const d=parseD(S.calSel); h+=`<div id="dayHead" style="scroll-margin-top:120px"></div>`+sec(`${DOW[d.getDay()]} ${d.getDate()} ${MONL[d.getMonth()]}`, sel.length)+(sel.length?`<div class="grid">${sel.map(cardHTML).join("")}</div>`:`<div class="empty">Nothing on this day yet.</div>`); }
  else { const inMonth=list.filter(e=>overlaps(e,first,new Date(y,mo+1,0)) && spanDays(e)<=7); h+=sec(`All of ${MONL[mo]}`, inMonth.length, "tap a day to focus")+`<div class="col">${inMonth.map(rowHTML).join("")||'<div class="empty">No events this month with these filters.</div>'}</div>`; }
  if(longRuns.length) h+=sec("Running all month", longRuns.length)+`<div class="col">${longRuns.map(rowHTML).join("")}</div>`;
  return h;
}
function whoView(){
  const list=filtered();
  const col=(k,title,sw,note)=>{ const arr=list.filter(e=>(e.audience||[]).includes(k)).slice(0,60); return `<section class="col" data-k="${k}"><div class="col-h"><span class="sw" style="background:${sw}"></span><h3>${title}</h3><p>${list.filter(e=>(e.audience||[]).includes(k)).length}</p></div>${note?`<div class="kidnote">${note}</div>`:""}${arr.map(rowHTML).join("")||'<div class="empty">None with these filters.</div>'}</section>`; };
  const tabs=`<div class="whotabs">${[["Parents","Parents"],["Kids","Kids"],["Family","Family"]].map(([k,l])=>`<button class="chip" data-who="${k}" aria-pressed="${S.whoTab===k}">${l}</button>`).join("")}</div>`;
  return askBar()+statusLine()+tabs+`<div class="cols tab-${S.whoTab}">${col("Parents","Parents","#7C3AED","Date nights, concerts, food and grown-up culture.")}${col("Kids","Kids","#E8590C","Carnivals, kids festivals and hands-on fun.")}${col("Family","The whole family","#0CA678","Things everyone enjoys together.")}</div>`;
}
function oursView(){
  const up=S.events.filter(e=>!isPast(e) && !S.hidden[e.id]);
  const going=up.filter(e=>peopleFor(e.id).some(([u,st])=>st==="going")).sort((a,b)=>evStart(a)-evStart(b));
  const both=up.filter(e=>peopleFor(e.id).length>=2 && !going.includes(e)).sort((a,b)=>evStart(a)-evStart(b));
  const keen=up.filter(e=>peopleFor(e.id).length===1 && !going.includes(e)).sort((a,b)=>evStart(a)-evStart(b));
  let h=(window.SO_planner?window.SO_planner.tripsSection():"");
  h+=sec("We're going", going.length)+(going.length?`<div class="grid">${going.map(cardHTML).join("")}</div>`:`<div class="empty">Mark events ✓ Going and they'll collect here.</div>`);
  h+=sec("You're both keen", both.length, "time to decide")+(both.length?`<div class="grid">${both.map(cardHTML).join("")}</div>`:`<div class="empty">When you both tap ♥ Keen on the same event, it shows up here.</div>`);
  h+=sec("One of you is keen", keen.length)+(keen.length?`<div class="grid">${keen.map(cardHTML).join("")}</div>`:`<div class="empty">Nothing yet.</div>`);
  const fr=up.filter(e=>(S.friendPicks[e.id]||[]).length).sort((a,b)=>evStart(a)-evStart(b));
  h+=sec("Friends' plans", fr.length, "from friends who share with you")+(fr.length?`<div class="grid">${fr.map(cardHTML).join("")}</div>`:`<div class="empty">When friends share their plans with you, their picks show up here. Connect friends under Settings.</div>`);
  return h;
}

/* ---------- detail sheet ---------- */
function whoLine(id){
  const ps=peopleFor(id), fr=S.friendPicks[id]||[];
  const bits=ps.map(([u,st])=>`${esc(u===S.uid?"You":personName(u))} ${st==="going"?"✓ going":"♥ keen"}`).concat(fr.map(f=>`${esc(f.household_name)} ${f.state==="going"?"✓ going":"♥ keen"}`));
  return bits.length?`<span class="whoami">${bits.join(" · ")}</span>`:"";
}
function barHTML(e){
  const m=myMark(e.id), id=esc(e.id), tix=safeHref(e.ticketUrl) && e.ticketStatus!=="free entry";
  return `<button class="bbtn int ${m==="interested"?"on":""}" data-act="int" data-id="${id}" aria-pressed="${m==="interested"}">${icon("heart")}<span>Keen</span></button>
    <button class="bbtn go ${m==="going"?"on":""}" data-act="go" data-id="${id}" aria-pressed="${m==="going"}">${icon("check")}<span>Going</span></button>
    ${tix?`<button class="bbtn main ticket" data-act="tix" data-id="${id}" aria-expanded="${S.tixOpen===e.id}">${icon("ticket")}<span>${e.ticketStatus==="sold out"?"Sold out":"Tickets"}</span></button>`
         :`<button class="bbtn main" data-act="when" data-id="${id}">${icon("calq")}<span>When can we go?</span></button>`}`;
}
function refreshSheet(id){ // after a pick: update in place (keeps scroll position and open panels)
  const sh=$(`#sheetHost .sheet[data-ev="${CSS.escape(id)}"]`); if(!sh) return;
  const e=S.events.find(x=>x.id===id); if(!e) return;
  const bar=sh.querySelector(".sbar"); if(bar) bar.innerHTML=barHTML(e);
  const w=sh.querySelector(".whoslot"); if(w) w.innerHTML=whoLine(id);
}
function openSheet(id){
  const e=S.events.find(x=>x.id===id); if(!e) return;
  const maps="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent([e.venue,e.address||e.city].filter(Boolean).join(", "));
  const photos="https://www.google.com/search?tbm=isch&q="+encodeURIComponent(e.title+" "+(e.city||""));
  const video=safeHref(e.videoUrl) || ("https://www.youtube.com/results?search_query="+encodeURIComponent(e.title));
  const official=safeHref(e.url), src=safeHref(e.source), eid=esc(e.id);
  const tix=safeHref(e.ticketUrl) && e.ticketStatus!=="free entry";
  track("view", e.id);
  const p=priceLabel(e), price=p.t==="FREE"?"Free":p.t;
  const long=(e.description||"").length>260;
  const facts=[
    [icon("pin"), `${esc(e.venue||"")}${e.address||e.city?`<small>${esc(e.address||e.city)}</small>`:""}`, `<a href="${esc(maps)}" target="_blank" rel="noopener" data-track="map" data-id="${eid}">Directions</a>`],
    [icon("ticket"), `${esc(e.priceText&&!e.free?e.priceText:price)}<small>${esc(ticketLine(e))}</small>`, tix?`<a href="#" data-act="tix" data-id="${eid}">Details</a>`:""],
    [icon("users"), `${esc([(e.audience||[]).join(", "), e.language, e.setting].filter(Boolean).join(" · "))}`, ""]
  ];
  $("#sheetHost").innerHTML = `<div class="scrim" data-close="1"><div class="sheet ev" data-ev="${eid}" role="dialog" aria-modal="true" aria-label="${esc(e.title)}">
    <div class="art">${poster(e,{uid:"s",grain:true})}<div class="tl"><span class="tag">${esc(e.category)}</span>${e.scale==="gem"?'<span class="tag gem">Gem</span>':""}${statusTags(e)}</div>${dateBox(e)}
      <div class="topbtns"><button class="round" type="button" data-act="sharemenu" data-id="${eid}" aria-label="Share this event" aria-expanded="false">${icon("share")}</button><button class="round close" data-close="1" aria-label="Close">${icon("x")}</button></div>
      <div class="sharepop" id="sharePop" hidden>
        <button type="button" data-sendev="wa" data-id="${eid}">${icon("wa")} WhatsApp</button>
        <button type="button" data-sendev="mail" data-id="${eid}">${icon("mail")} Email</button>
        <button type="button" data-sendev="more" data-id="${eid}">${icon(navigator.share||window.SO_native.isNative?"share":"link")} ${navigator.share||window.SO_native.isNative?"More options":"Copy link"}</button>
      </div></div>
    <div class="inner">
      <header class="shead">
        <h2>${esc(e.title)}</h2>
        <p class="when">${esc(whenText(e))}${!e.timeKnown&&!/·/.test(whenText(e))?" · time TBC":""}</p>
        <p class="where">${esc(placeText(e))}</p>
        <div class="sline"><span class="pricetag ${p.c}">${esc(p.t)}</span>${listenBtn(e)}<span class="whoslot">${whoLine(e.id)}</span></div>
      </header>
      ${e.summary?`<p class="lede">${esc(e.summary)}</p>`:""}
      ${e.confidence==="likely"?`<div class="note warn">Date not confirmed yet: it's based on previous years, so check the official page before booking.</div>`:""}
      <section class="plan" aria-label="Plan it">
        <div class="planrow"><button class="btn when" type="button" data-act="when" data-id="${eid}">${icon("calq")} When can we go?</button>
          <div class="calwrap"><button class="btn" type="button" data-act="calmenu" data-id="${eid}" aria-expanded="false">${icon("cal")} Add to calendar</button>
            <div class="calpop" hidden><button type="button" data-act="cal" data-id="${eid}">${icon("cal")} Phone calendar</button><a href="${esc(gcalUrl(e))}" target="_blank" rel="noopener" data-track="calendar" data-id="${eid}">${icon("cal")} Google Calendar</a></div></div></div>
        <button class="btn planaround" type="button" data-act="planaround" data-id="${eid}">${icon("route")} Build a day around this</button>
        <div id="whenPanel"></div>
      </section>
      <div id="tixPanel">${S.tixOpen===e.id?tixHTML(e):""}</div>
      ${e.description?`<div class="about ${long?"clamp":""}"><p>${esc(e.description)}</p>${long?`<button type="button" class="more" data-act="readmore">Read more</button>`:""}</div>`:""}
      <ul class="facts2">${facts.map(f=>`<li>${f[0]}<span>${f[1]}</span>${f[2]}</li>`).join("")}</ul>
      <p class="links">${official?`<a href="${esc(official)}" target="_blank" rel="noopener" data-track="official" data-id="${eid}">${icon("link")} Website</a>`:""}<a href="${esc(video)}" target="_blank" rel="noopener" data-track="video" data-id="${eid}">${icon("play")} Video</a><a href="${esc(photos)}" target="_blank" rel="noopener" data-track="photos" data-id="${eid}">${icon("img")} Photos</a></p>
      ${(e.tags||[]).length?`<p class="tagline">${(e.tags||[]).map(esc).join(" · ")}</p>`:""}
      <p class="sfoot"><button type="button" class="quiet" data-act="skip" data-id="${eid}">${icon("x")} Not for us</button>${src?`<span>Source: <a href="${esc(src)}" target="_blank" rel="noopener" data-track="official" data-id="${eid}">${esc(hostOf(src))}</a></span>`:""}</p>
    </div>
    <div class="sbar">${barHTML(e)}</div>
  </div></div>`;
  document.body.style.overflow="hidden";
  setTimeout(()=>{ const d=$("#sheetHost .sheet.ev"); if(d){ d.setAttribute("tabindex","-1"); d.focus({preventScroll:true}); } },30);
}
function hostOf(u){ try{ return new URL(u).hostname.replace(/^www\./,""); }catch(e){ return u; } }
function ticketLine(e){ const st=e.ticketStatus||"unknown"; const map={"on sale":"On sale now","selling fast":"Selling fast. Book soon","sold out":"Sold out","not yet on sale":"Not on sale yet","at the door":"Pay at the door","free entry":"No tickets needed","registration":"Free or paid registration required","unknown":"Check the official page"}; return (e.ticketsRequired===false&&st!=="registration"?"No tickets needed":map[st]||st); }
function closeSheet(){ askStop(); AK.state="idle"; $("#sheetHost").innerHTML=""; document.body.style.overflow=""; S.tixOpen=null; }

function togglePop(sel, btn){
  const pop=$("#sheetHost "+sel); if(!pop) return; const show=pop.hidden;
  document.querySelectorAll("#sheetHost .sharepop,#sheetHost .calpop").forEach(x=>x.hidden=true);
  document.querySelectorAll('#sheetHost [data-act="sharemenu"],#sheetHost [data-act="calmenu"]').forEach(x=>x.setAttribute("aria-expanded","false"));
  pop.hidden=!show; btn.setAttribute("aria-expanded", String(show));
}
document.addEventListener("click", ev=>{ if(!ev.target.closest(".sharepop,.calpop,[data-act=sharemenu],[data-act=calmenu]")) document.querySelectorAll("#sheetHost .sharepop,#sheetHost .calpop").forEach(x=>x.hidden=true); }, true);
/* ---------- ticket details (live check of the seller's page) ---------- */
const AVAIL={"available":["Available","ok"],"few left":["Few left","hot"],"sold out":["Sold out","sold"],"not yet on sale":["Not on sale yet","wait"],"cancelled":["Cancelled","sold"]};
function availPill(a){ const x=AVAIL[a]; return x?`<span class="av-pill ${x[1]}">${x[0]}</span>`:""; }
function perfText(st){ const d=parseD(st); if(!d) return esc(st||""); return DOW[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()]+(d.getFullYear()!==TODAY.getFullYear()?" "+d.getFullYear():"")+(/T/.test(st)?" · "+hhmm(d):""); }
function chf(n){ n=+n; return "CHF "+(Number.isInteger(n)?String(n):n.toFixed(2)); }
function tixHTML(e){
  const t=(S.tix||{})[e.id]||{state:"loading"};
  const live=t.data&&t.data.live, saved=e.ticketInfo&&typeof e.ticketInfo==="object"?e.ticketInfo:null;
  const info=live||saved||{};
  const seller=(t.data&&t.data.seller)||hostOf(e.ticketUrl||e.url||"");
  const opts=(info.options||[]).filter(o=>o&&(o.priceCHF!=null||o.availability)), perfs=info.performances||[];
  let head;
  if(t.state==="loading") head=`<span class="tix-live"><span class="spin" aria-hidden="true"></span>Checking ${esc(seller)}…</span>`;
  else if(live) head=`<span class="tix-live ok">Live from ${esc(live.seller||seller)} · checked ${esc(hhmm(new Date(t.at)))}</span>`;
  else head=`<span class="tix-live">${t.state==="error"?"Couldn't run the live check.":t.data&&t.data.reason==="blocked"?esc(seller)+" doesn't allow automatic checks.":"The seller's page couldn't be read automatically."} Showing ${saved?"details saved by the daily scan"+(saved.checkedAt?" on "+esc(saved.checkedAt):""):"what the daily scan saved"}.</span>`;
  const status=live&&live.status&&live.status!=="unknown"?live.status:({"on sale":"available","selling fast":"few left","sold out":"sold out","not yet on sale":"not yet on sale"})[e.ticketStatus]||"";
  const rows=[];
  rows.push(["When", esc(whenText(e))+(!e.timeKnown&&!info.start?" · time TBC":"")]);
  if(info.doors||info.start) rows.push(["Times", [info.doors?"Doors "+esc(info.doors):"", info.start?"Start "+esc(info.start):""].filter(Boolean).join(" · ")]);
  rows.push(["Where", esc(e.venue||"")]);
  if(info.seating) rows.push(["Seating", esc(info.seating)]);
  if(info.ageLimit) rows.push(["Age", esc(info.ageLimit)]);
  if(info.saleStart) rows.push(["Sale starts", esc(perfText(info.saleStart))]);
  const priceBlock = opts.length
    ? `<table class="tix-opts"><tbody>${opts.map(o=>`<tr><td>${esc(o.label||"Ticket")}</td><td class="mono">${o.priceCHF!=null?esc(chf(o.priceCHF)):""}</td><td>${availPill(o.availability)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="tix-price"><b class="mono">${esc(priceLabel(e).t)}</b>${e.priceText&&!e.free&&e.priceText!==priceLabel(e).t?` <span>${esc(e.priceText)}</span>`:""}</p>`;
  const perfBlock = perfs.length>1 ? `<div class="tix-sub">All dates</div><ul class="tix-perfs">${perfs.map(p=>`<li><span class="mono">${perfText(p.start)}</span>${availPill(p.availability)}</li>`).join("")}</ul>` : "";
  const notes=(info.notes||[]).concat(typeof info.note==="string"?[info.note]:[]).filter(Boolean);
  const soldOut=status==="sold out";
  return `<section class="tix" aria-label="Ticket details" aria-busy="${t.state==="loading"}">
    <div class="tix-head"><h3>Tickets ${availPill(status)}</h3>${head}</div>
    <dl class="tix-facts">${rows.map(r=>`<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("")}</dl>
    <div class="tix-sub">Prices${live?"":" (as last saved)"}</div>${priceBlock}${perfBlock}
    ${notes.map(n=>`<div class="note warn">${esc(n)}</div>`).join("")}
    <div class="btnrow">
      <a class="btn ticket" href="${esc(safeHref(e.ticketUrl))}" target="_blank" rel="noopener" data-track="tickets" data-id="${esc(e.id)}">${icon("ticket")} ${soldOut?"Open seller's page":"Continue to checkout"}</a>
      <button class="btn" data-act="tixrefresh" data-id="${esc(e.id)}" ${t.state==="loading"?"disabled":""}>Check again</button>
      <button class="btn" data-act="tixclose" data-id="${esc(e.id)}">Not now</button>
    </div>
    <p class="tix-foot">You pay on ${esc(seller)}, with your own card, TWINT or Apple Pay. Swiss Outings never sees payment details. Booking fees may be added at checkout.</p>
  </section>`;
}
function paintTix(id){ const e=S.events.find(x=>x.id===id), host=$("#tixPanel"); if(e&&host&&S.tixOpen===id&&$(`#sheetHost .sheet[data-ev="${CSS.escape(id)}"]`)) host.innerHTML=tixHTML(e); }
async function loadTix(id, force){
  S.tix=S.tix||{};
  const have=S.tix[id];
  if(have&&have.state==="done"&&!force&&Date.now()-have.at<10*60e3){ paintTix(id); return; }
  S.tix[id]={state:"loading", data:have&&have.data, at:have&&have.at}; paintTix(id);
  try{
    // "Check again" uses a 5-minute bucket so the shared 30-minute cache can be skipped, but not on every tap.
    const r=await fetch(window.SO_native.api("/api/tickets")+"?id="+encodeURIComponent(id)+(force?"&r="+Math.floor(Date.now()/300e3):""));
    if(!r.ok) throw new Error("http "+r.status);
    const data=await r.json();
    S.tix[id]={state:"done", data, at:data.checkedAt?new Date(data.checkedAt).getTime():Date.now()};
  }catch(err){ S.tix[id]={state:"error", data:null, at:Date.now()}; }
  paintTix(id);
}
function openTix(id){
  if(S.tixOpen===id){ S.tixOpen=null; const h=$("#tixPanel"); if(h) h.innerHTML=""; const b=$('#sheetHost [data-act="tix"]'); b&&b.setAttribute("aria-expanded","false"); return; }
  S.tixOpen=id; track("tickets", id, {step:"panel"}); const b=$('#sheetHost [data-act="tix"]'); b&&b.setAttribute("aria-expanded","true");
  loadTix(id,false);
  const h=$("#tixPanel"); h&&h.scrollIntoView({behavior:"smooth",block:"nearest"});
}

/* ---------- calendar ---------- */
function pad(n){ return String(n).padStart(2,"0"); }
function icsLocal(d){ return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate())+"T"+pad(d.getHours())+pad(d.getMinutes())+"00"; }
function icsDate(d){ return d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate()); }
function timing(e){
  const s=evStart(e); const hasTime=e.timeKnown && /T/.test(e.start); const sd=spanDays(e);
  if(!hasTime || (sd>0 && !/T/.test(e.end||""))) return {allDay:true, s:dayOnly(s), e:addDays(dayOnly(sd>14?s:evEnd(e)),1)};
  let en = e.end && /T/.test(e.end) ? parseD(e.end) : new Date(s.getTime()+2*3600e3); if(en<=s || sd>1) en=new Date(s.getTime()+3*3600e3);
  return {allDay:false, s, e:en};
}
function gcalUrl(e){
  const t=timing(e); const dates = t.allDay ? icsDate(t.s)+"/"+icsDate(t.e) : icsLocal(t.s)+"/"+icsLocal(t.e);
  const details=[e.summary, e.ticketUrl?("Tickets: "+e.ticketUrl):"", e.url?("More: "+e.url):""].filter(Boolean).join("\n");
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(e.title)+"&dates="+dates+"&ctz=Europe/Zurich&details="+encodeURIComponent(details)+"&location="+encodeURIComponent([e.venue,e.address||e.city].filter(Boolean).join(", "));
}
async function addToCalendar(id){
  const e=S.events.find(x=>x.id===id); if(!e) return;
  if(myMark(id)!=="going") setMark(id,"going");
  track("calendar", id);
  if(window.SO_native.isNative){
    const t=timing(e); window.SO_native.haptic("light");
    const ok=await window.SO_native.addToCalendar({title:e.title, start:t.s.getTime(), end:(t.allDay?addDays(t.e,-1):t.e).getTime(), allDay:t.allDay, location:[e.venue,e.address].filter(Boolean).join(", "), notes:[e.summary, priceLabel(e).t, e.ticketUrl?("Tickets: "+e.ticketUrl):""].filter(Boolean).join("\n"), url:e.url||e.ticketUrl||""});
    if(ok){ toast("Added to Our plans"); return; }
  }
  toast("Opening your calendar · added to Our plans");
  setTimeout(()=>{ window.location.href = window.SO_native.api("/api/ics")+"?id="+encodeURIComponent(id); }, 250);
}

/* ---------- picks write ---------- */
async function setMark(id, state){
  if(!S.uid || !S.household){ toast("Sign in first."); return; }
  const cur=myMark(id); const next = cur===state ? null : state; window.SO_native.haptic(next==="going"?"success":"light");
  track(next==="going"?"going":next==="interested"?"keen":cur==="going"?"ungoing":"unkeen", id);
  const m=Object.assign({}, S.marks[id]||{}); if(next) m[S.uid]=next; else delete m[S.uid]; S.marks[id]=m; render(); refreshSheet(id);
  const q = next ? sb.from("picks").upsert({event_id:id, user_id:S.uid, household_id:S.household.id, state:next, updated_at:new Date().toISOString()})
                 : sb.from("picks").delete().eq("event_id",id).eq("user_id",S.uid);
  const { error } = await q; if(error) toast("Couldn't save that pick: "+error.message);
}

/* ---------- settings ---------- */
async function openSettings(){
  const h=S.household||{}; const brief=(S.config.brief||"");
  let friends=[];
  try{ const r=await sb.from("friendships").select("household_id,friend_household_id,share_plans"); friends=r.data||[]; }catch(e){}
  const mine=friends.filter(f=>f.household_id===h.id);
  const ids=[...new Set(mine.map(f=>f.friend_household_id))]; let names={};
  if(ids.length){ const r=await sb.from("households").select("id,name").in("id",ids); (r.data||[]).forEach(x=>names[x.id]=x.name); }
  const members=Object.values(S.members);
  $("#sheetHost").innerHTML=`<div class="scrim" data-close="1"><div class="sheet" role="dialog" aria-modal="true" aria-label="Settings"><div class="inner" style="padding-top:calc(22px + env(safe-area-inset-top,0px))">
    <div style="display:flex;align-items:center;gap:10px"><h2 style="margin-right:auto">Settings</h2><button class="iconbtn" data-close="1" aria-label="Close">${icon("x")}</button></div>
    <div class="form">
      <div><label>Your household</label>
        <div class="hidrow"><input id="hhName" value="${esc(h.name||"")}" aria-label="Household name" style="flex:1;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:9px 11px"><button class="chip" id="saveHh" type="button">Save</button></div>
        <p class="desc" style="margin:8px 0 4px">Members: ${members.map(m=>esc(m.display_name||"Member")).join(", ")||"just you"}</p>
        <p class="desc" style="margin:4px 0">Partner's code: <b class="mono" style="color:var(--ink)">${esc(h.join_code||"")}</b> · or <a href="#" data-invite-open>send them a link</a></p>
      </div>
      <div><label>Friends</label>
        <p class="desc" style="margin:6px 0 8px">Friends who join with your link are connected to you. Your plans stay private unless you switch on sharing for that friend.</p>
        <div class="btnrow"><button class="btn primary" type="button" data-invite-open>${icon("users")} Invite friends</button></div>
        <div class="hidrow" style="margin-top:6px"><input id="friendCode" placeholder="Friend’s friend-code" style="flex:1;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:9px 11px"><button class="chip" type="button" id="connectFriend">Connect</button></div>
        <p class="desc" style="margin:4px 0">Your friend-code: <b class="mono" style="color:var(--ink)">${esc(h.friend_code||"")}</b></p>
        ${mine.map(f=>`<div class="hidrow"><span>${esc(names[f.friend_household_id]||"Friend")}</span><label style="display:flex;align-items:center;gap:6px;font:500 13px var(--f-body);text-transform:none;letter-spacing:0;color:var(--ink)"><input type="checkbox" data-share="${esc(f.friend_household_id)}" ${f.share_plans?"checked":""}> Share our plans</label></div>`).join("")||'<p class="desc" style="margin:4px 0">No friends connected yet.</p>'}
      </div>
      <div id="calSet"><label>Your calendar</label><p class="desc" style="margin:6px 0 8px">Used by “When can we go?” to suggest dates you're free. Only busy/free times are checked.</p><div id="calSetBody" class="desc">Checking…</div></div>
      ${S.isAdmin?`<div><label for="brief">The brief (admin)</label><p class="desc" style="margin:6px 0 8px">The daily scan reads this before it searches.</p><textarea id="brief">${esc(brief)}</textarea><div class="btnrow" style="margin-top:8px"><button class="btn primary" type="button" id="saveBrief">Save brief</button></div></div>`:""}
      <p class="note">Daily scan: every morning. ${S.config.scan&&S.config.scan.lastRun?"Last run "+esc(fmtStamp(S.config.scan.lastRun))+". "+esc(S.config.scan.lastNote||""):""}</p>
      <div><label>Hidden events (${Object.keys(S.hidden).length})</label><p class="desc" style="margin:6px 0 8px">Events your household marked “Not for us”. The daily scan learns from this list.</p>${Object.values(S.hidden).sort((a,b)=>(b.at||"").localeCompare(a.at||"")).map(x=>`<div class="hidrow"><span>${esc(x.title||x.eventId)}</span><button type="button" class="chip" data-restore="${esc(x.eventId)}">Restore</button></div>`).join("")||'<p class="desc" style="margin:0">Nothing hidden yet.</p>'}</div>
      <div class="btnrow"><button class="btn" type="button" id="signOut">Sign out</button><button class="btn" type="button" id="leaveHh" style="color:var(--bad)">Delete my account</button></div>
      <p class="note">Privacy: we store your email, name, household and picks to run the app. Nothing is shared outside your household unless you switch on sharing for a friend. “Delete my account” permanently removes your login, email, picks and activity.</p>
    </div></div></div></div>`;
  document.body.style.overflow="hidden";
  calStatus().then(c=>{ const el=$("#calSetBody"); if(!el) return; el.innerHTML = c
    ? `<div class="hidrow"><span>✓ ${esc(c.label||c.provider)}</span><button class="chip" type="button" id="calOff">Disconnect</button></div>`
    : `<button class="btn" type="button" data-act="calconnect">${icon("calq")} Connect my calendar</button>`;
    const off=$("#calOff"); if(off) off.onclick=async()=>{ await sb.rpc("delete_my_calendar"); toast("Calendar disconnected"); openSettings(); }; });
}

/* ---------- main menu ---------- */
function openMenu(){
  const me=S.members[S.uid]||{}, IG=window.SO_install;
  const row=(attrs, ic, t, sub)=>`<button class="ig-row" type="button" ${attrs}><span class="rowic">${icon(ic)}</span><span><b>${t}</b><small>${sub}</small></span><span aria-hidden="true">›</span></button>`;
  sheetShell(me.display_name?("Hi "+me.display_name):"Menu", `<div class="setrows">
    ${row("data-open-settings","gear","Settings","Household, partner, friends, calendar, account")}
    ${row("data-invite-open","users","Invite people","Send a link by WhatsApp or email")}
    ${row("data-tips-open","phone",IG&&IG.isStandalone()?"Help":"Install the app &amp; help","Put Swiss Outings on your home screen")}
    ${row('data-contact="venue"',"pin","Suggest a venue or place","We'll check it every morning")}
    ${row('data-contact="contact"',"mail","Contact us","Questions, ideas, problems")}
    ${S.isAdmin?`<a class="ig-row" href="/admin.html"><span class="rowic">${icon("cal")}</span><span><b>Admin dashboard</b><small>Users, activity, events, messages</small></span><span aria-hidden="true">›</span></a>`:""}
  </div>`);
}

/* ---------- sharing an event ---------- */
function origin(){ return window.SO_native.origin; }
function eventLink(e){ return origin()+"/e/"+encodeURIComponent(e.id); }
async function shareEvent(id, how){
  const e=S.events.find(x=>x.id===id); if(!e) return;
  const url=eventLink(e), where=[e.venue, e.city&&!(e.venue||"").includes(e.city)?e.city:""].filter(Boolean).join(", ");
  const line=`${e.title}\n${whenText(e)}${where?" · "+where:""}\n${priceLabel(e).t==="FREE"?"Free":priceLabel(e).t}`;
  track("share", id, {via:how});
  if(how==="wa"){ const t=`${line}\n\nWant to go? ${url}`; if(window.SO_native.isNative && await window.SO_native.share({title:e.title,text:t})) return; window.open("https://wa.me/?text="+encodeURIComponent(t), "_blank", "noopener"); return; }
  if(how==="mail"){ location.href="mailto:?subject="+encodeURIComponent("Want to go? "+e.title)+"&body="+encodeURIComponent(`${line}\n\n${e.summary||""}\n\nAll the details: ${url}\n\nFound on Swiss Outings, concerts, carnivals and family days out across Switzerland.`); return; }
  if(window.SO_native.isNative){ window.SO_native.share({title:e.title, text:line, url}); return; }
  if(navigator.share){ try{ await navigator.share({title:e.title, text:line, url}); }catch(x){} return; }
  copyPlain(url, "Link copied. Paste it anywhere.");
}
function copyPlain(t, msg){ try{ navigator.clipboard.writeText(t).then(()=>toast(msg||"Copied"),()=>toast(t)); }catch(x){ toast(t); } }

/* ---------- invite partner / friends ---------- */
function inviteLinks(){ const h=S.household||{}; return { partner: h.join_code?origin()+"/?join="+h.join_code:"", friend: h.friend_code?origin()+"/?invite="+h.friend_code:"" }; }
function inviteText(who){
  const L=inviteLinks(), me=(S.members[S.uid]&&S.members[S.uid].display_name)||"";
  return who==="partner"
    ? {subject:"Join our household on Swiss Outings", text:`Join our household on Swiss Outings so we can plan outings together. Tap the link, create your account, and we'll see each other's ♥ keen and ✓ going picks.\n\n${L.partner}`}
    : {subject:(me?me+" invited you to ":"Join me on ")+"Swiss Outings", text:`I use Swiss Outings to find concerts, carnivals, cow parades and family days out around Zurich. It's free. Join me and we can share plans:\n\n${L.friend}`};
}
async function sendInvite(how, who){
  const m=inviteText(who), link=inviteLinks()[who]; if(!link){ toast("One moment, still loading your codes."); return; }
  track("invite", null, {via:how, who});
  if(how==="wa"){ if(window.SO_native.isNative && await window.SO_native.share({title:m.subject,text:m.text})) return; window.open("https://wa.me/?text="+encodeURIComponent(m.text),"_blank","noopener"); return; }
  if(how==="mail"){ location.href="mailto:?subject="+encodeURIComponent(m.subject)+"&body="+encodeURIComponent(m.text); return; }
  if(how==="more" && (window.SO_native.isNative||navigator.share)){ try{ window.SO_native.isNative ? await window.SO_native.share({title:m.subject,text:m.text}) : await navigator.share({title:m.subject,text:m.text}); }catch(x){} return; }
  copyPlain(link, "Invite link copied");
}
function sendRow(who){ return `<div class="sendrow">
  <button class="btn wa" type="button" data-send="wa" data-who="${who}">${icon("wa")} WhatsApp</button>
  <button class="btn" type="button" data-send="mail" data-who="${who}">${icon("mail")} Email</button>
  <button class="btn" type="button" data-send="${navigator.share||window.SO_native.isNative?"more":"copy"}" data-who="${who}">${icon(navigator.share||window.SO_native.isNative?"share":"link")} ${navigator.share||window.SO_native.isNative?"More":"Copy link"}</button></div>`; }
function sheetShell(label, inner){
  $("#sheetHost").innerHTML=`<div class="scrim" data-close="1"><div class="sheet small" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="inner" style="padding-top:calc(22px + env(safe-area-inset-top,0px))">
    <div style="display:flex;align-items:center;gap:10px"><h2 style="margin-right:auto">${esc(label)}</h2><button class="iconbtn" data-close="1" aria-label="Close">${icon("x")}</button></div>${inner}</div></div></div>`;
  document.body.style.overflow="hidden";
}
function openInvite(){
  sheetShell("Invite people", `
    <section class="invcard"><div class="invhead">${icon("users")}<div><h3>Friends &amp; family</h3><p>They get their own free account and are connected to you. You choose later whether to share your plans with them.</p></div></div>${sendRow("friend")}</section>
    <section class="invcard"><div class="invhead">${icon("heart")}<div><h3>Your partner</h3><p>They join <b>your household</b>, so you both see each other's ♥ keen and ✓ going picks right away.</p></div></div>${sendRow("partner")}</section>
    <p class="note">Each link works for as many people as you like.</p>`);
}

/* ---------- contact us / suggest a venue ---------- */
function openContact(kind, msg){
  const me=S.members[S.uid]||{};
  sheetShell(kind==="venue"?"Suggest a place":"Contact us", `
    <form id="contactForm" class="form" novalidate>
      <p class="desc" style="margin:0">${kind==="venue"?"Tell us the venues, villages, clubs or websites you'd like us to check every morning. We read every message.":"Questions, ideas or something not working? Write to us. We'll reply by email."}</p>
      <div><label for="cKind">About</label><select id="cKind" class="chip" style="width:100%;padding:10px 12px">
        <option value="venue" ${kind==="venue"?"selected":""}>Suggest a venue, place or website to cover</option>
        <option value="contact" ${kind==="contact"?"selected":""}>Question or feedback</option>
        <option value="bug" ${kind==="bug"?"selected":""}>Something isn't working</option></select></div>
      <div><label for="cName">Your name</label><input id="cName" class="inp" autocomplete="name" value="${esc(me.display_name||"")}"></div>
      <div><label for="cEmail">Your email (for our reply)</label><input id="cEmail" class="inp" type="email" autocomplete="email" inputmode="email" value="${esc(S.email||"")}"></div>
      <div><label for="cBody">Message</label><textarea id="cBody" rows="5" placeholder="${kind==="venue"?"e.g. Kulturhaus Helferei in Zurich, or the Uster Chilbi website":"Write your message"}"></textarea></div>
      <input type="text" id="cHp" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px">
      ${msg?`<p class="ob-msg err" role="alert">${esc(msg)}</p>`:""}
      <div class="btnrow"><button class="btn primary" type="submit">Send message</button></div>
    </form>`);
  $("#cBody").focus();
  $("#contactForm").onsubmit=async ev=>{
    ev.preventDefault(); if($("#cHp").value) return;
    const body=$("#cBody").value.trim(), kindV=$("#cKind").value, name=$("#cName").value.trim(), email=$("#cEmail").value.trim();
    if(body.length<2) return openContact(kindV, "Please write a message.");
    if(email && !/^\S+@\S+\.\S+$/.test(email)) return openContact(kindV, "That email address doesn't look right.");
    const b=ev.target.querySelector("button[type=submit]"); b.disabled=true; b.textContent="Sending…";
    const {data:id, error}=await sb.rpc("submit_message",{p_kind:kindV, p_name:name, p_email:email, p_body:body});
    if(error){ b.disabled=false; b.textContent="Send message"; toast(error.message); return; }
    track("contact", null, {kind:kindV});
    try{ fetch(window.SO_native.api("/api/contact"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id, kind:kindV, name, email, body})}); }catch(x){}
    sheetShell("Thank you!", `<div class="thanks"><p>Your message is on its way. ${kindV==="venue"?"We'll look at those places and add them to the morning search.":"We'll get back to you by email."}</p><button class="btn primary" type="button" data-close="1">Done</button></div>`);
  };
}

/* ---------- "an app is coming" + home screen tips ---------- */
function openTips(){
  const IG=window.SO_install;
  sheetShell("Welcome to Swiss Outings", `
    <section class="tipcard"><h3>📱 A proper app is on its way</h3><p>We're building Swiss Outings for the App Store and Google Play. Until then, put it on your home screen: it opens full-screen and feels just like an app.</p>
      ${IG&&!IG.isStandalone()?IG.stepsHTML():`<p class="note">You're already using it from your home screen. 👍</p>`}</section>
    <section class="tipcard"><h3>📍 Missing a place you love?</h3><p>Tell us which venues, villages, clubs or websites to cover, and we'll check them every morning.</p>
      <button class="btn" type="button" data-contact="venue">Suggest a place</button></section>
    <section class="tipcard"><h3>👋 Better together</h3><p>Invite your partner and friends to see who's keen on what.</p>
      <button class="btn" type="button" data-invite-open>Invite people</button></section>
    <div class="btnrow"><button class="btn primary" type="button" data-close="1">Got it, show me events</button></div>`);
  IG && IG.wire($("#sheetHost")); track("install_help", null, {from:"tips"});
  try{ localStorage.setItem("so.tipsSeen","1"); }catch(x){}
}
function maybeShowTips(){ let seen=false; try{ seen=localStorage.getItem("so.tipsSeen")==="1"; }catch(x){} if(!seen && !$("#sheetHost").innerHTML && document.getElementById("gate").hidden) setTimeout(()=>{ if(!$("#sheetHost").innerHTML) openTips(); }, 1200); }

/* ---------- "When can we go?" (checks connected calendars) ---------- */
async function authHeader(){ const {data}=await sb.auth.getSession(); const t=data.session&&data.session.access_token; return t?{Authorization:"Bearer "+t}:{}; }
async function calApi(action, payload){
  const r=await fetch(window.SO_native.api("/api/cal")+"?action="+action,{method:"POST",headers:{"Content-Type":"application/json",...(await authHeader())},body:JSON.stringify(payload||{})});
  let j={}; try{ j=await r.json(); }catch(x){} if(!r.ok) throw new Error(j.error||"Something went wrong. Please try again."); return j;
}
function whoFree(r){ const n=(r.checked||[]).length; return n>1?(n===2?"you're both free":"everyone's free"):"you're free"; }
async function whenCanWeGo(id){
  const host=$("#whenPanel"); if(!host) return;
  host.innerHTML=`<section class="whenbox" aria-busy="true"><span class="spin"></span> Checking your calendar…</section>`;
  let r; try{ r=await calApi("when",{event_id:id}); }catch(err){ host.innerHTML=`<section class="whenbox"><p>${esc(err.message)}</p></section>`; return; }
  track("when", id, {result: r.needsConnect?"not connected":r.best?"free":"busy"});
  if(r.needsConnect){ host.innerHTML=`<section class="whenbox"><h3>Find a date that works</h3><p>Connect your calendar once and we'll tell you which ${r.dates>1?"of the "+r.dates+" dates ":"date "}you're free for. We only check free/busy times and never store your appointments.</p><div class="btnrow"><button class="btn primary" type="button" data-act="calconnect">${icon("calq")} Connect my calendar</button></div></section>`; return; }
  if(r.past){ host.innerHTML=`<section class="whenbox"><p>This event has no upcoming dates.</p></section>`; return; }
  const book=(x,primary)=>`<button class="btn ${primary?"primary":""}" type="button" data-act="bookon" data-id="${esc(id)}" data-on="${esc(x.local)}">${primary?icon("check")+" Book it":esc(x.when)}</button>`;
  const missing=Object.values(S.members).filter(m=>m.user_id!==S.uid && !(r.checked||[]).includes(m.display_name||"Partner")).map(m=>m.display_name||"Your partner");
  let h=`<section class="whenbox">`;
  if(r.best) h+=`<div class="whenbest"><span class="ok">✓</span><div><b>${esc(r.best.when)}</b><small>${r.single?"The only date, and "+whoFree(r):whoFree(r)[0].toUpperCase()+whoFree(r).slice(1)}${r.best.pref>0?" · a good day for this":""}</small></div>${book(r.best,true)}</div>`;
  else h+=`<div class="whenbest none"><span class="no">!</span><div><b>${r.single?"You're busy then":"No free date found"}</b><small>${r.single?"Your calendar has something that overlaps (including travel time).":"Every date clashes with your calendars."}</small></div></div>`;
  if(r.more&&r.more.length) h+=`<div class="whenmore"><span>Also free:</span>${r.more.map(x=>book(x,false)).join("")}</div>`;
  if(r.clashes&&r.clashes.length) h+=`<ul class="whenclash">${r.clashes.map(c=>`<li>⚠️ ${esc(c.when)}: ${esc(c.busy.join(" & "))} ${c.busy.length>1||c.busy[0]!=="You"?"busy":"are busy"}</li>`).join("")}</ul>`;
  const notes=[]; if((r.failed||[]).length) notes.push("Couldn't read "+r.failed.join(" & ")+"'s calendar right now.");
  if(missing.length) notes.push(missing.join(" & ")+" hasn't connected a calendar yet, so only "+((r.checked||[]).join(" & ")||"yours")+" was checked.");
  if(!r.meConnected) notes.push(`You haven't connected your own calendar. <a href="#" data-act="calconnect">Connect it</a>`);
  if(notes.length) h+=`<p class="whennote">${notes.join(" ")}</p>`;
  host.innerHTML=h+`</section>`;
}
function bookOn(id, on){
  const e=S.events.find(x=>x.id===id); if(!e) return;
  if(myMark(id)!=="going") setMark(id,"going");
  track("calendar", id, {on});
  toast("Booked in · added to Our plans");
  setTimeout(()=>{ window.location.href=window.SO_native.api("/api/ics")+"?id="+encodeURIComponent(id)+"&on="+encodeURIComponent(on); }, 250);
}
async function calStatus(){ try{ const {data}=await sb.rpc("my_calendar"); return (data&&data[0])||null; }catch(x){ return null; } }
function openCalendarConnect(msg){
  const IG=window.SO_install||{}; const ios=IG.isIOS;
  sheetShell("Connect your calendar", `
    <p class="desc" style="margin:0">Swiss Outings only checks when you're <b>busy or free</b> to suggest dates. It never stores or shows your appointments, and you can disconnect anytime in Settings.</p>
    <section class="invcard"><div class="invhead">${icon("calq")}<div><h3>Google Calendar</h3><p>Sign in with Google and allow “see your availability”.</p></div></div>
      <button class="btn primary" type="button" id="gcalBtn">Connect Google Calendar</button></section>
    <section class="invcard"><div class="invhead">${icon("link")}<div><h3>iPhone (iCloud), Outlook or other</h3><p>Copy your calendar's private link and paste it here.</p></div></div>
      <details ${ios?"open":""}><summary>How to get the link on iPhone</summary><ol class="steps"><li>Open the <b>Calendar</b> app and tap <b>Calendars</b> at the bottom.</li><li>Tap the <b>ⓘ</b> next to your main calendar (it must be an iCloud calendar).</li><li>Switch on <b>Public Calendar</b>, then tap <b>Share Link…</b> → <b>Copy</b>.</li><li>Paste it below. The link is long and random, so nobody can guess it.</li></ol></details>
      <details><summary>How to get the link in Outlook</summary><ol class="steps"><li>Open Outlook on the web → <b>Settings</b> → <b>Calendar</b> → <b>Shared calendars</b>.</li><li>Under <b>Publish a calendar</b>, pick your calendar and <b>Can view when I'm busy</b>, then <b>Publish</b>.</li><li>Copy the <b>ICS</b> link and paste it below.</li></ol></details>
      <details><summary>How to get the link in Google Calendar (instead of signing in)</summary><ol class="steps"><li>On a computer, open Google Calendar → <b>Settings</b> → your calendar.</li><li>Copy the <b>Secret address in iCal format</b> and paste it below.</li></ol></details>
      <form id="icsForm" class="askform"><input id="icsUrl" class="inp" placeholder="webcal://… or https://…" autocomplete="off" inputmode="url"><button class="btn primary" type="submit">Connect</button></form>
      ${msg?`<p class="ob-msg err" role="alert">${esc(msg)}</p>`:""}</section>`);
  $("#gcalBtn").onclick=async()=>{ const b=$("#gcalBtn"); b.disabled=true; b.textContent="Opening Google…"; try{ const r=await calApi("google-start"); track("calendar_connect",null,{provider:"google"}); flushLog(); location.href=r.url; }catch(err){ b.disabled=false; b.textContent="Connect Google Calendar"; toast(err.message); } };
  $("#icsForm").onsubmit=async ev=>{ ev.preventDefault(); const b=ev.target.querySelector("button"); b.disabled=true; b.textContent="Checking…";
    try{ const r=await calApi("link",{url:$("#icsUrl").value}); track("calendar_connect",null,{provider:"ics"}); closeSheet(); toast(r.label+" connected. Tap “When can we go?” on any event."); }
    catch(err){ openCalendarConnect(err.message); } };
}

/* ---------- ask by voice or in your own words ---------- */
function askBar(){
  const fbtn=`<button type="button" class="fbtn2" id="openFilters" aria-label="Filters">${icon("sliders")}<span>Filters</span><span class="fcount" id="fcount" ${activeCount()&&!S.askSummary?"":"hidden"}>${activeCount()}</span></button>`;
  if(S.askSummary) return `<div class="askbar on"><button type="button" class="askbtn" data-ask-open>${icon("mic")}<span><small>Showing</small>${esc(S.askSummary)}</span></button><button type="button" class="askx" data-ask-clear aria-label="Clear this search">${icon("x")}</button>${fbtn}</div>`;
  return `<div class="askbar"><button type="button" class="askbtn" data-ask-open>${icon("mic")}<span><small>Ask or search</small>“Kids stuff this weekend…”</span></button>${fbtn}</div>`;
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const AK={rec:null, media:null, chunks:[], timer:null, state:"idle"};
function askStop(){ try{ AK.rec&&AK.rec.abort(); }catch(x){} try{ if(AK.media&&AK.media.state!=="inactive") AK.media.stop(); }catch(x){} clearTimeout(AK.timer); AK.rec=null; }
function openAsk(msg){
  sheetShell("What are you in the mood for?", `
    <div class="askwrap">
      <button type="button" class="micbig" id="micBtn" aria-label="Tap and speak">${icon("mic")}</button>
      <p class="asklive" id="askLive" aria-live="polite">${esc(msg||"Tap the microphone and say what you're looking for.")}</p>
      <form id="askForm" class="askform"><input id="askText" class="inp" placeholder="…or type it here" autocomplete="off" enterkeyhint="search"><button class="btn primary" type="submit">Find</button></form>
      <div class="askex"><span>Try:</span>${["Kids stuff this weekend near Zurich","A jazz or soul concert for a date night","Free outdoor things in November","Christmas markets around the lake"].map(x=>`<button type="button" class="chip" data-ask-ex="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    </div>`);
  const live=$("#askLive"), mic=$("#micBtn");
  $("#askForm").onsubmit=ev=>{ ev.preventDefault(); const t=$("#askText").value.trim(); if(t) runAsk({text:t}); };
  document.querySelectorAll("[data-ask-ex]").forEach(b=>b.onclick=()=>runAsk({text:b.dataset.askEx}));
  mic.onclick=()=>{
    if(AK.state==="listening"){ // tap again = done
      if(AK.rec) AK.rec.stop(); else if(AK.media&&AK.media.state==="recording") AK.media.stop(); return; }
    askStop(); AK.state="listening"; mic.classList.add("on"); live.textContent="Listening…";
    if(SR){
      const r=new SR(); AK.rec=r; r.lang=(navigator.language||"en-GB").startsWith("de")?"de-CH":"en-GB"; r.interimResults=true; r.maxAlternatives=1; let final="";
      r.onresult=ev=>{ let t=""; for(const res of ev.results){ t+=res[0].transcript; } final=t; live.textContent="“"+t+"”"; };
      r.onerror=ev=>{ AK.state="idle"; mic.classList.remove("on"); live.textContent= ev.error==="not-allowed"||ev.error==="service-not-allowed" ? "Microphone access is blocked. Allow it in your browser settings, or type below." : "Didn't catch that. Tap and try again, or type below."; };
      r.onend=()=>{ if(AK.state!=="listening") return; AK.state="idle"; mic.classList.remove("on"); if(final.trim()) runAsk({text:final.trim()}); else live.textContent="Didn't catch that. Tap and try again, or type below."; };
      try{ r.start(); }catch(x){ AK.state="idle"; mic.classList.remove("on"); live.textContent="Couldn't start the microphone. Type below instead."; }
      return;
    }
    if(navigator.mediaDevices && window.MediaRecorder){
      navigator.mediaDevices.getUserMedia({audio:true}).then(stream=>{
        const mr=new MediaRecorder(stream); AK.media=mr; AK.chunks=[];
        mr.ondataavailable=e=>{ if(e.data.size) AK.chunks.push(e.data); };
        mr.onstop=()=>{ stream.getTracks().forEach(t=>t.stop()); AK.state="idle"; mic.classList.remove("on"); const blob=new Blob(AK.chunks,{type:mr.mimeType||"audio/webm"}); if(blob.size<1500){ live.textContent="Didn't catch that. Tap and try again."; return; }
          const fr=new FileReader(); fr.onload=()=>runAsk({audio:String(fr.result).split(",")[1], mime:blob.type}); fr.readAsDataURL(blob); };
        mr.start(); live.textContent="Listening… tap again when you're done."; AK.timer=setTimeout(()=>{ if(mr.state==="recording") mr.stop(); },12000);
      }).catch(()=>{ AK.state="idle"; mic.classList.remove("on"); live.textContent="Microphone access is blocked. Allow it in your browser settings, or type below."; });
      return;
    }
    AK.state="idle"; mic.classList.remove("on"); live.textContent="Voice isn't supported in this browser. Type below instead."; $("#askText").focus();
  };
}
async function runAsk(input){
  if(input.text && window.SO_planner && /\b(plan|organi[sz]e)\b.*\b(day|weekend|saturday|sunday|trip|outing|today|tomorrow)\b/i.test(input.text)){ closeSheet(); const t=input.text.toLowerCase(); window.SO_planner.open({note:input.text, vibe:/hik|nature|walk|mountain|forest|lake/.test(t)?"nature":/museum|city|culture/.test(t)?"city":/rain/.test(t)?"rainy":undefined, from:"ask"}); return; }
  const live=$("#askLive"); if(live) live.innerHTML=`<span class="spin"></span> Finding events${input.text?" for “"+esc(input.text)+"”":""}…`;
  let res=null;
  try{
    const {data}=await sb.auth.getSession(); const tok=data.session&&data.session.access_token;
    const r=await fetch(window.SO_native.api("/api/ask"),{method:"POST",headers:{"Content-Type":"application/json",...(tok?{Authorization:"Bearer "+tok}:{})},body:JSON.stringify(input)});
    if(r.ok) res=await r.json();
  }catch(x){}
  if(!res){
    if(!input.text){ openAsk("Voice search isn't switched on yet. Type what you're looking for below."); return; }
    res={transcript:input.text, filters:localParse(input.text)};
  }
  applyAsk(res.filters||{}, res.transcript||input.text||"");
}
function applyAsk(f, said){
  resetFilters();
  if(f.audience) S.aud=f.audience;
  (f.categories||[]).forEach(c=>CATS[c]&&S.cats.add(c));
  (f.toggles||[]).forEach(t=>S.toggles.add(t));
  if(f.region) S.region=f.region;
  S.from=f.from||null; S.to=f.to||null;
  if(f.maxPrice!=null) S.maxPrice=f.maxPrice;
  S.kw=f.keywords||[];
  S.askSummary=f.summary||said;
  const r=$("#region"); if(r) r.value=S.region;
  buildFilters();
  let n=filtered().length;
  if(!n && S.kw.length){ S.kw=[]; n=filtered().length; }   // keywords too narrow: keep the other filters
  track("search", null, {voice:true, q:String(said).slice(0,140), results:n, filters:f});
  closeSheet(); if(S.view==="ours") S.view="discover"; render(); window.scrollTo({top:0});
  toast(n?`${n} ${n===1?"event":"events"} · ${S.askSummary}`:"Nothing matches that yet. Try something broader.");
}
// Built-in fallback when the AI search isn't available.
function localParse(text){
  const t=" "+text.toLowerCase()+" ", has=re=>re.test(t), f={categories:[],toggles:[],keywords:[]};
  if(has(/\b(kids?|children|child|toddler|kinder)\b/)) f.audience="Kids"; else if(has(/\b(family|families|whole family|familie)\b/)) f.audience="Family"; else if(has(/\b(date|romantic|adults?|grown.?ups?|couple|parents)\b/)) f.audience="Parents";
  const C={Music:/\b(concert|gig|music|band|live music|konzert|jazz|soul|folk|indie|rock|80s|90s)\b/,Festival:/\b(festival|carnival|chilbi|fasnacht|fair|kilbi)\b/,Film:/\b(film|cinema|movie|kino)\b/,Outdoors:/\b(hike|hiking|walk|outdoors?|bike|nature)\b/,Sport:/\b(football|soccer|hockey|match|game|sport|fcz|zsc|gc)\b/,Food:/\b(food|eat|market|wine|beer|tasting)\b/,Seasonal:/\b(christmas|advent|xmas|lantern|räben|samichlaus|halloween|easter)\b/,Culture:/\b(museum|exhibition|theatre|theater|art|opera|ballet|culture)\b/};
  for(const [k,re] of Object.entries(C)) if(has(re)) f.categories.push(k);
  if(f.categories.includes("Seasonal") && has(/\bmarket/)) f.categories=f.categories.filter(c=>c!=="Food");
  if(has(/\bfree\b|gratis/)) f.toggles.push("free"); else if(has(/\b(cheap|budget|affordable|not too expensive|inexpensive)\b/)) f.toggles.push("cheap");
  if(has(/\benglish\b/)) f.toggles.push("english");
  if(has(/\b(outside|outdoor)\b/)) f.toggles.push("outdoor");
  if(has(/\b(near|nearby|close|around here|lake|küsnacht|kusnacht|meilen|erlenbach|zollikon|gold coast|zurich|zürich)\b/)) f.region="near";
  const m=t.match(/(?:under|below|max|less than)\s*(?:chf|fr\.?)?\s*(\d{1,4})/); if(m) f.maxPrice=+m[1];
  ["jazz","soul","folk","indie","80s","90s","rock","classical","opera","hockey","christmas market","zoo","circus","lantern","cow"].forEach(k=>{ if(t.includes(k)) f.keywords.push(k); });
  const d=new Date(TODAY), day=d.getDay(); const iso=x=>ymd(x);
  if(has(/\btoday|tonight\b/)){ f.from=f.to=iso(d); }
  else if(has(/\btomorrow\b/)){ f.from=f.to=iso(addDays(d,1)); }
  else if(has(/\bnext weekend\b/)){ const sat=addDays(d,((6-day+7)%7)+7); f.from=iso(addDays(sat,-1)); f.to=iso(addDays(sat,1)); }
  else if(has(/\b(this )?weekend\b/)){ const [a,b]=weekendRange(); f.from=iso(a); f.to=iso(b); }
  else if(has(/\bnext week\b/)){ const mon=addDays(d,((8-day)%7)||7); f.from=iso(mon); f.to=iso(addDays(mon,6)); }
  else if(has(/\bthis week\b/)){ f.from=iso(d); f.to=iso(addDays(d,(7-day)%7)); }
  else { MONL.forEach((mn,i)=>{ if(t.includes(mn.toLowerCase())){ const y=i<d.getMonth()?d.getFullYear()+1:d.getFullYear(); f.from=iso(new Date(y,i,1)); f.to=iso(new Date(y,i+1,0)); } }); }
  const bits=[f.audience==="Kids"?"For kids":f.audience==="Family"?"For the family":f.audience==="Parents"?"For grown-ups":"", f.categories.join(" & "), f.toggles.includes("free")?"free":"", f.region?"near Zurich":"", f.from?(f.from===f.to?f.from:"from "+f.from):""].filter(Boolean);
  f.summary=bits.join(" · ")||text;
  return f;
}

/* ---------- toast ---------- */
let tt, undoFn=null; function toast(m, undo){ undoFn=undo||null; $("#toastHost").innerHTML=`<div class="toast"><span>${esc(m)}</span>${undo?'<button type="button" id="undoBtn">Undo</button>':""}</div>`; clearTimeout(tt); tt=setTimeout(()=>{ $("#toastHost").innerHTML=""; undoFn=null; }, undo?6000:3800); }
async function hideEvent(id){
  const e=S.events.find(x=>x.id===id); if(!e||!S.household) return;
  S.hidden[id]={eventId:id, at:new Date().toISOString(), title:e.title};
  if($("#sheetHost .sheet[data-ev]")) closeSheet();
  render();
  toast("Hidden: "+e.title, ()=>unhideEvent(id)); track("hide", id);
  const { error } = await sb.from("hidden").upsert({household_id:S.household.id, event_id:id, by_user:S.uid, title:e.title, category:e.category, tags:e.tags||[]});
  if(error) toast("Couldn't save that: "+error.message);
}
async function unhideEvent(id){ track("unhide", id); delete S.hidden[id]; render(); if($("#sheetHost [aria-label=Settings]")) openSettings(); await sb.from("hidden").delete().eq("household_id",S.household.id).eq("event_id",id); }

/* ---------- filter UI ---------- */
function activeCount(){ return (S.aud!=="all"?1:0)+S.cats.size+S.toggles.size+(S.when!=="all"?1:0)+(S.region!=="all"?1:0)+(S.q?1:0)+(S.from||S.to?1:0)+(S.maxPrice!=null?1:0)+(S.kw&&S.kw.length?1:0); }
function resetFilters(){ S.aud="all"; S.cats.clear(); S.toggles.clear(); S.when="all"; S.region="all"; S.q=""; S.from=S.to=null; S.maxPrice=null; S.kw=[]; S.askSummary=null; const q=$("#q"); if(q) q.value=""; const w=$("#when"); if(w) w.value="all"; const r=$("#region"); if(r) r.value="all"; buildFilters(); }
function updCount(){ const n=activeCount(), el=$("#fcount"); if(el){ el.hidden=!n; el.textContent=n; } const b=$("#closeFilters"); if(b) b.textContent="Show "+filtered().length+" events"; }
function openFilters(on){ $("#filters").classList.toggle("open",on); $("#fscrim").classList.toggle("on",on); $("header.top").style.zIndex=on?"47":""; document.body.style.overflow=on?"hidden":""; if(on) updCount(); }
function buildFilters(){
  $("#audChips").innerHTML = AUD.map(a=>`<button class="chip" data-aud="${a.k}" aria-pressed="${S.aud===a.k}">${a.sw?`<span class="dot" style="background:${a.sw}"></span>`:""}${a.l}</button>`).join("");
  $("#toggles").innerHTML = TOGGLES.map(t=>`<button class="chip" data-tg="${t.k}" aria-pressed="${S.toggles.has(t.k)}">${t.l}</button>`).join("");
  $("#catChips").innerHTML = Object.entries(CATS).map(([k,v])=>`<button class="chip" data-cat="${k}" aria-pressed="${S.cats.has(k)}"><span class="dot" style="background:${v.c}"></span>${k}</button>`).join("");
}

/* ---------- events ---------- */
document.addEventListener("click", ev=>{
  const t=ev.target;
  const act=t.closest("[data-act]");
  if(act){ ev.stopPropagation(); const id=act.dataset.id; if(act.dataset.act==="listen"){ listen(id); return; } if(act.dataset.act==="sharemenu"){ togglePop("#sharePop", act); return; } if(act.dataset.act==="calmenu"){ togglePop(".calpop", act); return; } if(act.dataset.act==="readmore"){ const a=act.closest(".about"); a&&a.classList.remove("clamp"); act.remove(); return; } if(act.dataset.act==="when"){ whenCanWeGo(id); return; } if(act.dataset.act==="bookon"){ bookOn(id, act.dataset.on); return; } if(act.dataset.act==="calconnect"){ openCalendarConnect(); return; } if(act.dataset.act==="skip") hideEvent(id); else if(act.dataset.act==="int") setMark(id,"interested"); else if(act.dataset.act==="go") setMark(id,"going"); else if(act.dataset.act==="cal") addToCalendar(id); else if(act.dataset.act==="tix"){ ev.preventDefault(); openTix(id); } else if(act.dataset.act==="tixrefresh") loadTix(id,true); else if(act.dataset.act==="tixclose"){ if(S.tixOpen===id) openTix(id); } return; }
  const tr=t.closest("[data-track]"); if(tr){ track(tr.dataset.track, tr.dataset.id||null, tr.dataset.track==="tickets"?{step:"checkout"}:{}); }
  const sh=t.closest("[data-sendev]"); if(sh){ ev.stopPropagation(); shareEvent(sh.dataset.id, sh.dataset.sendev); return; }
  const sv=t.closest("[data-send]"); if(sv){ sendInvite(sv.dataset.send, sv.dataset.who); return; }
  if(t.closest("[data-invite-open]")){ ev.preventDefault(); openInvite(); return; }
  const co=t.closest("[data-contact]"); if(co){ ev.preventDefault(); openContact(co.dataset.contact||"contact"); return; }
  if(t.closest("[data-tips-open]")){ ev.preventDefault(); openTips(); return; }
  const v=t.closest(".seg button"); if(v){ S.view=v.dataset.view; try{localStorage.setItem("so.view",S.view);}catch(e){} render(); window.scrollTo({top:0}); return; }
  const a=t.closest("[data-aud]"); if(a){ S.aud=a.dataset.aud; buildFilters(); render(); return; }
  const g=t.closest("[data-tg]"); if(g){ const k=g.dataset.tg; if(S.toggles.has(k)) S.toggles.delete(k); else { S.toggles.add(k); if(k==="gem") S.toggles.delete("big"); if(k==="big") S.toggles.delete("gem"); } buildFilters(); render(); return; }
  const c=t.closest("[data-cat]"); if(c){ const k=c.dataset.cat; S.cats.has(k)?S.cats.delete(k):S.cats.add(k); buildFilters(); render(); return; }
  const cal=t.closest("[data-cal]"); if(cal){ const n=+cal.dataset.cal; S.calMonth = n===0? new Date(TODAY.getFullYear(),TODAY.getMonth(),1) : new Date(S.calMonth.getFullYear(), S.calMonth.getMonth()+n, 1); S.calSel=null; render(); return; }
  const op=t.closest("[data-open]"); if(op && !t.closest(".sheet")){ openSheet(op.dataset.open); return; }
  const day=t.closest("[data-day]"); if(day){ S.calSel = S.calSel===day.dataset.day?null:day.dataset.day; render(); if(S.calSel && window.innerWidth<760){ const h=$("#dayHead"); h&&h.scrollIntoView({behavior:"smooth",block:"start"}); } return; }
  if(t.id==="undoBtn"){ const f=undoFn; undoFn=null; $("#toastHost").innerHTML=""; f&&f(); return; }
  const rs=t.closest("[data-restore]"); if(rs){ unhideEvent(rs.dataset.restore); return; }
  if(t.closest("#openSettings")||t.closest("[data-open-settings]")){ openSettings(); return; }
  if(t.closest("#openMenu")){ openMenu(); return; }
  if(t.closest("#openFilters")){ openFilters(true); return; }
  if(t.id==="closeFilters"||t.id==="fscrim"){ openFilters(false); window.scrollTo({top:0}); return; }
  if(t.id==="clearFilters"||t.closest("[data-ask-clear]")){ resetFilters(); render(); return; }
  if(t.closest("[data-ask-open]")){ openAsk(); return; }
  const wt=t.closest("[data-who]"); if(wt){ S.whoTab=wt.dataset.who; render(); return; }
  const cp=t.closest("[data-copy]"); if(cp){ copyText(cp.dataset.copy); return; }
  if(t.id==="newInvite"){ (async()=>{ const {error}=await sb.rpc("create_invite"); if(error) toast(error.message); else openSettings(); })(); return; }
  if(t.id==="connectFriend"){ (async()=>{ const {data,error}=await sb.rpc("connect_friend",{p_code:$("#friendCode").value}); if(error) toast(error.message); else if(!data) toast("We couldn't find that friend code. Check it and try again."); else { toast("Connected"); openSettings(); } })(); return; }
  if(t.id==="saveHh"){ (async()=>{ const {error}=await sb.from("households").update({name:$("#hhName").value.trim()}).eq("id",S.household.id); toast(error?error.message:"Saved"); if(!error) S.household.name=$("#hhName").value.trim(); })(); return; }
  if(t.id==="saveBrief"){ (async()=>{ const brief=$("#brief").value.trim(); const {error}=await sb.from("app_config").upsert({key:"brief", value:brief, updated_at:new Date().toISOString()}); if(!error) S.config.brief=brief; toast(error?error.message:"Saved. The next scan uses the new brief."); })(); return; }
  if(t.id==="signOut"){ (async()=>{ await sb.auth.signOut(); location.reload(); })(); return; }
  if(t.id==="leaveHh"){ if(t.dataset.sure!=="1"){ t.dataset.sure="1"; t.textContent="Tap again to delete"; return; } (async()=>{ const {error}=await sb.rpc("delete_my_account"); if(error){ toast("Couldn't delete: "+error.message); return; } try{ localStorage.clear(); }catch(x){} await sb.auth.signOut(); location.reload(); })(); return; }
  // close only on the backdrop itself or an explicit close button (not on every button inside a sheet)
  if((t.dataset && t.dataset.close) || t.closest("button[data-close]")){ closeSheet(); return; }
});
document.addEventListener("keydown", ev=>{
  if(ev.key==="Escape"){ if($("#sheetHost").innerHTML) closeSheet(); else openFilters(false); }
  if(ev.key==="Enter"){ const op=ev.target.closest&&ev.target.closest("[data-open]"); if(op && ev.target===op){ openSheet(op.dataset.open); } const d=ev.target.closest&&ev.target.closest("[data-day]"); if(d && ev.target===d){ S.calSel=d.dataset.day; render(); } }
});
document.addEventListener("change", ev=>{ const s=ev.target.closest&&ev.target.closest("[data-share]"); if(s){ (async()=>{ const {error}=await sb.from("friendships").update({share_plans:s.checked}).eq("household_id",S.household.id).eq("friend_household_id",s.dataset.share); toast(error?error.message:(s.checked?"Now sharing your plans":"Stopped sharing")); })(); } });
function copyText(t){ if(window.SO_native.isNative && /^https?:/.test(t)){ window.SO_native.share({title:"Swiss Outings", text:"Join us on Swiss Outings", url:t}); return; } try{ navigator.clipboard.writeText(t).then(()=>toast("Copied"),()=>toast(t)); }catch(e){ toast(t); } }
let qt, qlog; $("#q").addEventListener("input", e=>{ clearTimeout(qt); qt=setTimeout(()=>{ S.q=e.target.value.trim().toLowerCase(); render(); },150); clearTimeout(qlog); qlog=setTimeout(()=>{ if(S.q.length>=3) track("search", null, {q:S.q.slice(0,60), results:filtered().length}); },1800); });
$("#when").addEventListener("change", e=>{ S.when=e.target.value; render(); });
$("#region").addEventListener("change", e=>{ S.region=e.target.value; render(); });

/* ---------- boot ---------- */
buildFilters(); render();
window.__app={S,render,buildFilters,parseD,isPast,poster,esc,fmtStamp,toast,isNew,openSettings,openSheet,track,flushLog,maybeShowTips,openTips,openInvite,openContact,sheetShell,icon,closeSheet,authHeader,ymd,addDays,TODAY,whenText,copyPlain};
})();
