
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
  const P={heart:'<path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.3 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 18.7 5 21 8.3 19.5 11.8 17.5 16.4 12 21 12 21z"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',ticket:'<path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v8a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2z"/><path d="M13 6v12" stroke-dasharray="2 2"/>',link:'<path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',play:'<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l6-3.5z" fill="currentColor"/>',img:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',pin:'<path d="M12 21s7-6.1 7-11.5A7 7 0 0 0 5 9.5C5 14.9 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>'};
  const fill = n==="heart"?"currentColor":"none";
  return `<svg viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
}
function actionsHTML(e){
  const m=myMark(e.id), inv=S.invites[e.id];
  return `<div class="actions">
    <button class="act int ${m==="interested"?"on":""}" data-act="int" data-id="${esc(e.id)}" aria-pressed="${m==="interested"}" title="Interested">${icon("heart")}<span>Keen</span></button>
    <button class="act go ${m==="going"?"on":""}" data-act="go" data-id="${esc(e.id)}" aria-pressed="${m==="going"}" title="We're going">${icon("check")}<span>Going</span></button>
    <button class="act inv" data-act="cal" data-id="${esc(e.id)}" title="Add to your calendar">${icon("cal")}<span>Add</span></button>
    <button class="act skip" data-act="skip" data-id="${esc(e.id)}" title="Not for us: hide this event" aria-label="Not for us">${icon("x")}</button>
  </div>`;
}
function cardHTML(e){
  const id=++uidSeq; const aud=(e.audience||[]);
  return `<article class="card" data-open="${esc(e.id)}" tabindex="0" aria-label="${esc(e.title)}">
    <div class="art">${poster(e,{uid:id})}
      <div class="tl"><span class="tag">${esc(e.category)}</span>${e.scale==="gem"?'<span class="tag gem">Gem</span>':""}</div>
      <div class="tr">${statusTags(e)}</div>
      ${dateBox(e)}<div class="br">${avatars(e.id)}${(()=>{const p=priceLabel(e);return `<span class="pricetag ${p.c}">${esc(p.t)}</span>`;})()}</div>
    </div>
    <div class="body">
      <h3 class="title">${esc(e.title)}</h3>
      <div class="meta">
        <div class="row"><span class="mono">${esc(whenText(e))}</span></div>
        <div class="row"><span>${esc(e.venue||"")}${e.city&&!(e.venue||"").includes(e.city)?", "+esc(e.city):""}</span></div>
      </div>
      <div class="aud">${aud.map(a=>`<span class="pill ${audClass(a)}">${esc(a)}</span>`).join("")}</div>
      ${actionsHTML(e)}
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
  const m=S.meta||{}; const up=S.events.filter(e=>!isPast(e));
  return `<div class="status-line"><span><b>${up.length}</b> upcoming</span><span><b>${up.filter(e=>e.free).length}</b> free</span><span><b>${up.filter(e=>e.scale==="gem").length}</b> hidden gems</span><span>Last scan <b>${esc(m.lastRun?fmtStamp(m.lastRun):"—")}</b></span>${m.lastAdded!=null?`<span><b>${m.lastAdded}</b> added last scan</span>`:""}</div>`;
}
function fmtStamp(s){ const d=new Date(s); if(isNaN(d)) return s; return DOW[d.getDay()]+" "+d.getDate()+" "+MON[d.getMonth()]+" "+hhmm(d); }
function weekendRange(){
  const d=TODAY.getDay(); let sat;
  if(d===6) sat=TODAY; else if(d===0) sat=addDays(TODAY,-1); else sat=addDays(TODAY,6-d);
  const fri=addDays(sat,-1); return [d===0?TODAY:(d===6?TODAY:fri), addDays(sat,1)];
}
function overlaps(e,a,b){ return dayOnly(evStart(e))<=b && dayOnly(evEnd(e))>=a; }
function discoverView(){
  const list=filtered();
  if(!list.length) return statusLine()+`<div class="empty" style="margin-top:20px">Nothing matches these filters. Clear a filter or widen the time range.</div>`;
  const [wa,wb]=weekendRange();
  const wk=list.filter(e=>overlaps(e,wa,wb) && spanDays(e)<30);
  const ongoing=list.filter(e=>isOngoing(e) && spanDays(e)>=30);
  let h=statusLine();
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
  const tabs=`<div class="whotabs">${[["Parents","Parents"],["Kids","Liam &amp; Ellie"],["Family","Family"]].map(([k,l])=>`<button class="chip" data-who="${k}" aria-pressed="${S.whoTab===k}">${l}</button>`).join("")}</div>`;
  return statusLine()+tabs+`<div class="cols tab-${S.whoTab}">${col("Parents","Parents","#7C3AED","Date nights, concerts, food and grown-up culture.")}${col("Kids","Liam &amp; Ellie","#E8590C","Carnivals, kids festivals and hands-on fun.")}${col("Family","All four of us","#0CA678","Things everyone enjoys together.")}</div>`;
}
function oursView(){
  const up=S.events.filter(e=>!isPast(e) && !S.hidden[e.id]);
  const going=up.filter(e=>peopleFor(e.id).some(([u,st])=>st==="going")).sort((a,b)=>evStart(a)-evStart(b));
  const both=up.filter(e=>peopleFor(e.id).length>=2 && !going.includes(e)).sort((a,b)=>evStart(a)-evStart(b));
  const keen=up.filter(e=>peopleFor(e.id).length===1 && !going.includes(e)).sort((a,b)=>evStart(a)-evStart(b));
  let h=statusLine();
  h+=sec("We're going", going.length)+(going.length?`<div class="grid">${going.map(cardHTML).join("")}</div>`:`<div class="empty">Mark events ✓ Going and they'll collect here.</div>`);
  h+=sec("You're both keen", both.length, "time to decide")+(both.length?`<div class="grid">${both.map(cardHTML).join("")}</div>`:`<div class="empty">When you both tap ♥ Keen on the same event, it shows up here.</div>`);
  h+=sec("One of you is keen", keen.length)+(keen.length?`<div class="grid">${keen.map(cardHTML).join("")}</div>`:`<div class="empty">Nothing yet.</div>`);
  const fr=up.filter(e=>(S.friendPicks[e.id]||[]).length).sort((a,b)=>evStart(a)-evStart(b));
  h+=sec("Friends' plans", fr.length, "from friends who share with you")+(fr.length?`<div class="grid">${fr.map(cardHTML).join("")}</div>`:`<div class="empty">When friends share their plans with you, their picks show up here. Connect friends under Settings.</div>`);
  return h;
}

/* ---------- detail sheet ---------- */
function openSheet(id){
  const e=S.events.find(x=>x.id===id); if(!e) return;
  const people=peopleFor(e.id);
  const maps="https://www.google.com/maps/search/?api=1&query="+encodeURIComponent([e.venue,e.address||e.city].filter(Boolean).join(", "));
  const photos="https://www.google.com/search?tbm=isch&q="+encodeURIComponent(e.title+" "+(e.city||""));
  const video=e.videoUrl || ("https://www.youtube.com/results?search_query="+encodeURIComponent(e.title));
  const conf = e.confidence==="likely" ? `<div class="note warn">Date not yet confirmed by the organiser. It's based on previous years, so check the official page before booking.</div>` : "";
  $("#sheetHost").innerHTML = `<div class="scrim" data-close="1"><div class="sheet" data-ev="${esc(e.id)}" role="dialog" aria-modal="true" aria-label="${esc(e.title)}">
    <div class="art" style="position:relative">${poster(e,{uid:"s",grain:true})}<div class="tl"><span class="tag">${esc(e.category)}</span>${e.scale==="gem"?'<span class="tag gem">Gem</span>':'<span class="tag">Big event</span>'}${statusTags(e)}</div>${dateBox(e)}<button class="close" data-close="1" aria-label="Close">${icon("x")}</button></div>
    <div class="inner">
      <h2>${esc(e.title)}</h2>
      <p class="lede">${esc(e.summary)}</p>
      <div class="btnrow">
        <button class="btn primary" data-act="cal" data-id="${esc(e.id)}">${icon("cal")} Add to calendar</button>
        <a class="btn" href="${esc(gcalUrl(e))}" target="_blank" rel="noopener">${icon("cal")} Google Calendar</a>
        ${e.ticketUrl && e.ticketStatus!=="free entry" ? `<a class="btn ticket" href="${esc(e.ticketUrl)}" target="_blank" rel="noopener">${icon("ticket")} ${e.ticketStatus==="sold out"?"Tickets (sold out)":"Get tickets"}</a>`:""}
      </div>
      <div class="btnrow">
        <button class="btn ${myMark(e.id)==="interested"?"primary":""}" data-act="int" data-id="${esc(e.id)}" aria-pressed="${myMark(e.id)==="interested"}">${icon("heart")} Keen</button>
        <button class="btn ${myMark(e.id)==="going"?"primary":""}" data-act="go" data-id="${esc(e.id)}" aria-pressed="${myMark(e.id)==="going"}">${icon("check")} Going</button>
        <button class="btn" data-act="skip" data-id="${esc(e.id)}">${icon("x")} Not for us</button>
        ${people.length||(S.friendPicks[e.id]||[]).length?`<div class="whobox">${people.map(([u,st])=>`<span class="person">${avatarEl(u)}${esc(personName(u))} · ${st==="going"?"going":"keen"}</span>`).join("")}${(S.friendPicks[e.id]||[]).map(f=>`<span class="person"><span class="av fr">★</span>${esc(f.household_name)} · ${f.state==="going"?"going":"keen"}</span>`).join("")}</div>`:""}
      </div>
      ${conf}
      <p class="desc">${esc(e.description)}</p>
      <dl class="facts">
        <dt>When</dt><dd class="mono">${esc(whenText(e))}${!e.timeKnown?" · time TBC":""}</dd>
        <dt>Where</dt><dd>${esc(e.venue||"")}<br><span style="color:var(--muted)">${esc(e.address||e.city||"")}</span> · <a href="${esc(maps)}" target="_blank" rel="noopener">Map</a></dd>
        <dt>Price</dt><dd><b class="mono">${esc(priceLabel(e).t)}</b>${e.priceText&&!e.free&&e.priceText!==priceLabel(e).t?`<br><span style="color:var(--muted)">${esc(e.priceText)}</span>`:""}</dd>
        <dt>Tickets</dt><dd>${esc(ticketLine(e))}</dd>
        <dt>For</dt><dd>${(e.audience||[]).map(a=>`<span class="pill ${audClass(a)}">${esc(a)}</span>`).join(" ")}</dd>
        <dt>Language</dt><dd>${esc(e.language||"")}</dd>
        <dt>Setting</dt><dd>${esc(e.setting||"")} · ${esc(e.region||"")}</dd>
        ${(e.tags||[]).length?`<dt>Tags</dt><dd style="color:var(--muted)">${(e.tags||[]).map(esc).join(" · ")}</dd>`:""}
      </dl>
      <div class="btnrow">
        ${e.url?`<a class="btn" href="${esc(e.url)}" target="_blank" rel="noopener">${icon("link")} Official page</a>`:""}
        <a class="btn" href="${esc(video)}" target="_blank" rel="noopener">${icon("play")} Video</a>
        <a class="btn" href="${esc(photos)}" target="_blank" rel="noopener">${icon("img")} Photos</a>
        <a class="btn" href="${esc(maps)}" target="_blank" rel="noopener">${icon("pin")} Directions</a>
      </div>
      <div id="inviteMsg"></div>
      <p class="note">“Add to calendar” opens the event in your phone’s calendar and marks it Going. ${e.source?`Source: <a href="${esc(e.source)}" target="_blank" rel="noopener">${esc(hostOf(e.source))}</a>`:""}</p>
    </div></div></div>`;
  document.body.style.overflow="hidden";
  setTimeout(()=>{ const c=$("#sheetHost .close"); c&&c.focus(); },30);
}
function hostOf(u){ try{ return new URL(u).hostname.replace(/^www\./,""); }catch(e){ return u; } }
function ticketLine(e){ const st=e.ticketStatus||"unknown"; const map={"on sale":"On sale now","selling fast":"Selling fast. Book soon","sold out":"Sold out","not yet on sale":"Not on sale yet","at the door":"Pay at the door","free entry":"No tickets needed","registration":"Free or paid registration required","unknown":"Check the official page"}; return (e.ticketsRequired===false&&st!=="registration"?"No tickets needed":map[st]||st); }
function closeSheet(){ $("#sheetHost").innerHTML=""; document.body.style.overflow=""; }

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
  toast("Opening your calendar · added to Our plans");
  setTimeout(()=>{ window.location.href = "/api/ics?id="+encodeURIComponent(id); }, 250);
}

/* ---------- picks write ---------- */
async function setMark(id, state){
  if(!S.uid || !S.household){ toast("Sign in first."); return; }
  const cur=myMark(id); const next = cur===state ? null : state;
  const m=Object.assign({}, S.marks[id]||{}); if(next) m[S.uid]=next; else delete m[S.uid]; S.marks[id]=m; render(); if($("#sheetHost .sheet[data-ev]")) openSheet(id);
  const q = next ? sb.from("picks").upsert({event_id:id, user_id:S.uid, household_id:S.household.id, state:next, updated_at:new Date().toISOString()})
                 : sb.from("picks").delete().eq("event_id",id).eq("user_id",S.uid);
  const { error } = await q; if(error) toast("Couldn't save that pick: "+error.message);
}

/* ---------- settings ---------- */
async function openSettings(){
  const h=S.household||{}; const brief=(S.config.brief||"");
  let invites=[], friends=[];
  try{ const r=await sb.from("app_invites").select("code,used_by_household,created_at").order("created_at",{ascending:false}); invites=r.data||[]; }catch(e){}
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
        <p class="desc" style="margin:4px 0">Partner joins with code <b class="mono" style="color:var(--ink)">${esc(h.join_code||"")}</b> <button class="chip" type="button" data-copy="${esc(h.join_code||"")}">Copy</button></p>
      </div>
      <div><label>Friends</label>
        <p class="desc" style="margin:6px 0 8px">Invite a friend’s household: create a code and send it with the app link. They join as their own household and are connected to you. Your plans stay private unless you switch sharing on per friend.</p>
        <div class="btnrow"><button class="btn primary" type="button" id="newInvite">Create invite code</button></div>
        ${invites.filter(i=>!i.used_by_household).map(i=>`<div class="hidrow"><span class="mono">${esc(i.code)}</span><button class="chip" type="button" data-copy="${esc(location.origin+"/?invite="+i.code)}">Copy invite link</button></div>`).join("")}
        <div class="hidrow" style="margin-top:6px"><input id="friendCode" placeholder="Friend’s friend-code" style="flex:1;background:var(--surface2);border:1px solid var(--line);border-radius:10px;padding:9px 11px"><button class="chip" type="button" id="connectFriend">Connect</button></div>
        <p class="desc" style="margin:4px 0">Your friend-code: <b class="mono" style="color:var(--ink)">${esc(h.friend_code||"")}</b></p>
        ${mine.map(f=>`<div class="hidrow"><span>${esc(names[f.friend_household_id]||"Friend")}</span><label style="display:flex;align-items:center;gap:6px;font:500 13px var(--f-body);text-transform:none;letter-spacing:0;color:var(--ink)"><input type="checkbox" data-share="${esc(f.friend_household_id)}" ${f.share_plans?"checked":""}> Share our plans</label></div>`).join("")||'<p class="desc" style="margin:4px 0">No friends connected yet.</p>'}
      </div>
      ${S.isAdmin?`<div><label for="brief">The brief (admin)</label><p class="desc" style="margin:6px 0 8px">The daily scan reads this before it searches.</p><textarea id="brief">${esc(brief)}</textarea><div class="btnrow" style="margin-top:8px"><button class="btn primary" type="button" id="saveBrief">Save brief</button></div></div>`:""}
      <p class="note">Daily scan: every morning. ${S.config.scan&&S.config.scan.lastRun?"Last run "+esc(fmtStamp(S.config.scan.lastRun))+". "+esc(S.config.scan.lastNote||""):""}</p>
      <div><label>Hidden events (${Object.keys(S.hidden).length})</label><p class="desc" style="margin:6px 0 8px">Events your household marked “Not for us”. The daily scan learns from this list.</p>${Object.values(S.hidden).sort((a,b)=>(b.at||"").localeCompare(a.at||"")).map(x=>`<div class="hidrow"><span>${esc(x.title||x.eventId)}</span><button type="button" class="chip" data-restore="${esc(x.eventId)}">Restore</button></div>`).join("")||'<p class="desc" style="margin:0">Nothing hidden yet.</p>'}</div>
      <div class="btnrow"><button class="btn" type="button" id="signOut">Sign out</button><button class="btn" type="button" id="leaveHh" style="color:var(--bad)">Delete my account</button></div>
      <p class="note">Privacy: we store your email, name, household and picks to run the app. Nothing is shared outside your household unless you switch on sharing for a friend. “Delete my account” removes your membership and picks.</p>
    </div></div></div></div>`;
  document.body.style.overflow="hidden";
}

/* ---------- toast ---------- */
let tt, undoFn=null; function toast(m, undo){ undoFn=undo||null; $("#toastHost").innerHTML=`<div class="toast"><span>${esc(m)}</span>${undo?'<button type="button" id="undoBtn">Undo</button>':""}</div>`; clearTimeout(tt); tt=setTimeout(()=>{ $("#toastHost").innerHTML=""; undoFn=null; }, undo?6000:3800); }
async function hideEvent(id){
  const e=S.events.find(x=>x.id===id); if(!e||!S.household) return;
  S.hidden[id]={eventId:id, at:new Date().toISOString(), title:e.title};
  if($("#sheetHost .sheet[data-ev]")) closeSheet();
  render();
  toast("Hidden: "+e.title, ()=>unhideEvent(id));
  const { error } = await sb.from("hidden").upsert({household_id:S.household.id, event_id:id, by_user:S.uid, title:e.title, category:e.category, tags:e.tags||[]});
  if(error) toast("Couldn't save that: "+error.message);
}
async function unhideEvent(id){ delete S.hidden[id]; render(); if($("#sheetHost [aria-label=Settings]")) openSettings(); await sb.from("hidden").delete().eq("household_id",S.household.id).eq("event_id",id); }

/* ---------- filter UI ---------- */
function activeCount(){ return (S.aud!=="all"?1:0)+S.cats.size+S.toggles.size+(S.when!=="all"?1:0)+(S.region!=="all"?1:0)+(S.q?1:0); }
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
  if(act){ ev.stopPropagation(); const id=act.dataset.id; if(act.dataset.act==="skip") hideEvent(id); else if(act.dataset.act==="int") setMark(id,"interested"); else if(act.dataset.act==="go") setMark(id,"going"); else if(act.dataset.act==="cal") addToCalendar(id); return; }
  const v=t.closest(".seg button"); if(v){ S.view=v.dataset.view; try{localStorage.setItem("so.view",S.view);}catch(e){} render(); window.scrollTo({top:0}); return; }
  const a=t.closest("[data-aud]"); if(a){ S.aud=a.dataset.aud; buildFilters(); render(); return; }
  const g=t.closest("[data-tg]"); if(g){ const k=g.dataset.tg; if(S.toggles.has(k)) S.toggles.delete(k); else { S.toggles.add(k); if(k==="gem") S.toggles.delete("big"); if(k==="big") S.toggles.delete("gem"); } buildFilters(); render(); return; }
  const c=t.closest("[data-cat]"); if(c){ const k=c.dataset.cat; S.cats.has(k)?S.cats.delete(k):S.cats.add(k); buildFilters(); render(); return; }
  const cal=t.closest("[data-cal]"); if(cal){ const n=+cal.dataset.cal; S.calMonth = n===0? new Date(TODAY.getFullYear(),TODAY.getMonth(),1) : new Date(S.calMonth.getFullYear(), S.calMonth.getMonth()+n, 1); S.calSel=null; render(); return; }
  const op=t.closest("[data-open]"); if(op && !t.closest(".sheet")){ openSheet(op.dataset.open); return; }
  const day=t.closest("[data-day]"); if(day){ S.calSel = S.calSel===day.dataset.day?null:day.dataset.day; render(); if(S.calSel && window.innerWidth<760){ const h=$("#dayHead"); h&&h.scrollIntoView({behavior:"smooth",block:"start"}); } return; }
  if(t.id==="undoBtn"){ const f=undoFn; undoFn=null; $("#toastHost").innerHTML=""; f&&f(); return; }
  const rs=t.closest("[data-restore]"); if(rs){ unhideEvent(rs.dataset.restore); return; }
  if(t.closest("#openSettings")){ openSettings(); return; }
  if(t.closest("#openFilters")){ openFilters(true); return; }
  if(t.id==="closeFilters"||t.id==="fscrim"){ openFilters(false); window.scrollTo({top:0}); return; }
  if(t.id==="clearFilters"){ S.aud="all"; S.cats.clear(); S.toggles.clear(); S.when="all"; S.region="all"; S.q=""; $("#q").value=""; $("#when").value="all"; $("#region").value="all"; buildFilters(); render(); return; }
  const wt=t.closest("[data-who]"); if(wt){ S.whoTab=wt.dataset.who; render(); return; }
  const cp=t.closest("[data-copy]"); if(cp){ copyText(cp.dataset.copy); return; }
  if(t.id==="newInvite"){ (async()=>{ const {error}=await sb.rpc("create_invite"); if(error) toast(error.message); else openSettings(); })(); return; }
  if(t.id==="connectFriend"){ (async()=>{ const {error}=await sb.rpc("connect_friend",{p_code:$("#friendCode").value}); if(error) toast(error.message); else { toast("Connected"); openSettings(); } })(); return; }
  if(t.id==="saveHh"){ (async()=>{ const {error}=await sb.from("households").update({name:$("#hhName").value.trim()}).eq("id",S.household.id); toast(error?error.message:"Saved"); if(!error) S.household.name=$("#hhName").value.trim(); })(); return; }
  if(t.id==="saveBrief"){ (async()=>{ const brief=$("#brief").value.trim(); const {error}=await sb.from("app_config").upsert({key:"brief", value:brief, updated_at:new Date().toISOString()}); if(!error) S.config.brief=brief; toast(error?error.message:"Saved. The next scan uses the new brief."); })(); return; }
  if(t.id==="signOut"){ (async()=>{ await sb.auth.signOut(); location.reload(); })(); return; }
  if(t.id==="leaveHh"){ if(t.dataset.sure!=="1"){ t.dataset.sure="1"; t.textContent="Tap again to delete"; return; } (async()=>{ await sb.from("picks").delete().eq("user_id",S.uid); await sb.from("members").delete().eq("user_id",S.uid); await sb.auth.signOut(); location.reload(); })(); return; }
  if(t.dataset && t.dataset.close || (t.closest("[data-close]") && t.closest("button"))){ closeSheet(); return; }
});
document.addEventListener("keydown", ev=>{
  if(ev.key==="Escape"){ if($("#sheetHost").innerHTML) closeSheet(); else openFilters(false); }
  if(ev.key==="Enter"){ const op=ev.target.closest&&ev.target.closest("[data-open]"); if(op && ev.target===op){ openSheet(op.dataset.open); } const d=ev.target.closest&&ev.target.closest("[data-day]"); if(d && ev.target===d){ S.calSel=d.dataset.day; render(); } }
});
document.addEventListener("change", ev=>{ const s=ev.target.closest&&ev.target.closest("[data-share]"); if(s){ (async()=>{ const {error}=await sb.from("friendships").update({share_plans:s.checked}).eq("household_id",S.household.id).eq("friend_household_id",s.dataset.share); toast(error?error.message:(s.checked?"Now sharing your plans":"Stopped sharing")); })(); } });
function copyText(t){ try{ navigator.clipboard.writeText(t).then(()=>toast("Copied"),()=>toast(t)); }catch(e){ toast(t); } }
let qt; $("#q").addEventListener("input", e=>{ clearTimeout(qt); qt=setTimeout(()=>{ S.q=e.target.value.trim().toLowerCase(); render(); },150); });
$("#when").addEventListener("change", e=>{ S.when=e.target.value; render(); });
$("#region").addEventListener("change", e=>{ S.region=e.target.value; render(); });

/* ---------- boot ---------- */
buildFilters(); render();
window.__app={S,render,buildFilters,parseD,isPast};
})();
