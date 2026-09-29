/* Swiss Outings — onboarding, auth and data layer (Supabase) */
(function(){
"use strict";
const C = window.SO_CONFIG;
const sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
window.sb = sb;
const A = window.__app, S = A.S, esc = A.esc;
const IG = window.SO_install;
const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);

/* invite / join codes survive the email-confirmation round trip */
function cacheGet(k){ try{ return JSON.parse(localStorage.getItem("so."+k)||"null"); }catch(e){ return null; } }
function cacheSet(k,v){ try{ v==null?localStorage.removeItem("so."+k):localStorage.setItem("so."+k, JSON.stringify(v)); }catch(e){} }
if(params.get("invite")) cacheSet("pending", {invite: params.get("invite").toUpperCase()});
if(params.get("join")) cacheSet("pending", {join: params.get("join").toUpperCase()});
const pending = () => cacheGet("pending") || {};

/* ---------- friendly errors ---------- */
function friendly(m){
  m = String(m||"");
  if(/invalid login credentials/i.test(m)) return "That email and password don't match. Try again, or reset your password.";
  if(/email not confirmed/i.test(m)) return "Please confirm your email first. Tap the link we sent you.";
  if(/already registered|already exists/i.test(m)) return "You already have an account with this email. Sign in instead.";
  if(/password should be at least|weak/i.test(m)) return "Please use at least 8 characters for your password.";
  if(/rate limit|too many/i.test(m)) return "Too many emails in a short time. Wait a few minutes and try again.";
  if(/household code was not found/i.test(m)) return "We couldn't find that household code. Check it with your partner.";
  if(/invite code is not valid|already used/i.test(m)) return "That invite code isn't valid or has already been used. Ask your friend for a new one.";
  if(/network|fetch/i.test(m)) return "No connection. Check your internet and try again.";
  return m;
}

/* ---------- gate shell ---------- */
const X = '<svg viewBox="0 0 12 12"><path d="M4.5 1h3v3.5H11v3H7.5V11h-3V7.5H1v-3h3.5z" fill="#fff"/></svg>';
function gate(html){ const g=$("#gate"); g.hidden=!html; g.innerHTML=html||""; document.body.classList.toggle("gated", !!html); if(html){ g.scrollTop=0; } }
function dots(n){ return `<div class="ob-steps" aria-label="Step ${n} of 3">${["Account","About you","Install"].map((l,i)=>`<span class="${i+1<n?"done":i+1===n?"on":""}"><i></i>${l}</span>`).join("")}</div>`; }
function card(inner, opts={}){ return `<div class="ob"><div class="ob-card ${opts.wide?"wide":""}">${opts.back?`<button class="ob-back" type="button" data-go="${opts.back}" aria-label="Back">‹ Back</button>`:""}${inner}</div></div>`; }
function field(id, label, attrs, extra){ return `<div class="ob-field"><label for="${id}">${label}</label><div class="ob-inp"><input id="${id}" ${attrs}>${extra||""}</div></div>`; }
function msgBox(m, kind){ return m ? `<p class="ob-msg ${kind||"err"}" role="alert">${esc(m)}</p>` : ""; }
function busy(btn, on, label){ if(!btn) return; btn.disabled=on; if(on){ btn.dataset.l=btn.innerHTML; btn.innerHTML=`<span class="spin"></span>${label||"One moment…"}`; } else if(btn.dataset.l){ btn.innerHTML=btn.dataset.l; } }
document.addEventListener("click", e => { const g=e.target.closest("#gate [data-go]"); if(g){ e.preventDefault(); screens[g.dataset.go](); } const t=e.target.closest("[data-eye]"); if(t){ const i=$("#"+t.dataset.eye); i.type=i.type==="password"?"text":"password"; t.textContent=i.type==="password"?"Show":"Hide"; } });
const eye = id => `<button type="button" class="ob-eye" data-eye="${id}">Show</button>`;

/* ---------- welcome collage ---------- */
let previewEvents = null;
async function loadPreview(){
  if(previewEvents) return previewEvents;
  const c = cacheGet("events"); if(c && c.length) previewEvents = c;
  else { try{ const today=new Date().toISOString().slice(0,10); const {data}=await sb.from("events").select("id,data").gte("end_date",today).order("start_date").limit(120); previewEvents=(data||[]).map(r=>Object.assign({},r.data,{id:r.id})); }catch(e){ previewEvents=[]; } }
  return previewEvents;
}
function pickCollage(list){
  const up = list.filter(e=>!A.isPast(e)); const seen=new Set(), out=[];
  for(const e of up){ if(!seen.has(e.category)){ seen.add(e.category); out.push(e); } if(out.length===6) break; }
  for(const e of up){ if(out.length>=6) break; if(!out.includes(e)) out.push(e); }
  return out;
}
function collageHTML(list){
  const six = pickCollage(list||[]); if(!six.length) return `<div class="ob-collage empty"></div>`;
  return `<div class="ob-collage" aria-hidden="true">${six.map((e,i)=>`<div class="ob-tile t${i}">${A.poster(e,{uid:"ob"+i})}<span>${esc(e.title)}</span></div>`).join("")}</div>`;
}

/* ---------- screens ---------- */
let pw = null, pwEmail = null; // kept in memory only, to continue automatically after email confirmation
const screens = {
  async welcome(){
    const p = pending();
    const html = () => `<div class="ob ob-welcome"><div class="ob-hero">${collageHTML(previewEvents)}<div class="ob-fade"></div></div>
      <div class="ob-card ob-wcard">
        <div class="ob-brand"><span class="cross">${X}</span><h1>Swiss Outings</h1></div>
        ${p.invite||p.join?`<p class="ob-invited">🎉 You've been invited</p>`:""}
        <p class="ob-lead">Concerts, carnivals, cow parades and village gigs across Switzerland, found for you every morning.</p>
        <ul class="ob-points">
          <li><b>${(previewEvents||[]).filter(e=>!A.isPast(e)).length||"250+"}</b> upcoming events, big and small</li>
          <li>Plan together: <b>♥ keen</b> and <b>✓ going</b> are shared with your partner</li>
          <li>Tickets, prices and calendar invites in one tap</li>
        </ul>
        <button class="btn primary ob-cta" type="button" data-go="signup">Get started</button>
        <button class="btn ob-ghost" type="button" data-go="signin">I already have an account</button>
      </div></div>`;
    gate(html());
    if(!previewEvents){ await loadPreview(); if(!$("#gate").hidden && $(".ob-welcome")) gate(html()); }
  },

  signup(m){
    gate(card(`${dots(1)}<h2>Create your account</h2><p class="ob-sub">Use the email you check on this phone. We'll send a link to confirm it.</p>
      <form id="f" class="ob-form" novalidate>
        ${field("em","Email",`type="email" autocomplete="email" inputmode="email" required value="${esc(cacheGet("email")||"")}"`)}
        ${field("pw","Password",`type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"`, eye("pw"))}
        ${msgBox(m)}
        <button class="btn primary ob-cta" type="submit">Create account</button>
      </form>
      <p class="ob-foot">Already have one? <a href="#" data-go="signin">Sign in</a></p>`, {back:"welcome"}));
    $("#em").value ? $("#pw").focus() : $("#em").focus();
    $("#f").onsubmit = async ev => {
      ev.preventDefault(); const email=$("#em").value.trim(), pass=$("#pw").value;
      if(!/^\S+@\S+\.\S+$/.test(email)) return screens.signup("Please enter a valid email address.");
      if(pass.length<8) return screens.signup("Please use at least 8 characters for your password.");
      cacheSet("email", email); const b=ev.target.querySelector("button[type=submit]"); busy(b,true,"Creating your account…");
      const r = await sb.auth.signUp({ email, password: pass, options:{ emailRedirectTo: location.origin + "/?confirmed=1" } });
      busy(b,false);
      if(r.error) return screens.signup(friendly(r.error.message));
      if(r.data && r.data.user && Array.isArray(r.data.user.identities) && r.data.user.identities.length===0) return screens.signin("You already have an account with this email. Sign in below.");
      if(!r.data.session){ pw=pass; pwEmail=email; return screens.checkEmail(email); }
      start();
    };
  },

  checkEmail(email, note){
    email = email || pwEmail || cacheGet("email") || "";
    const mail = IG.isIOS ? `<a class="btn ob-ghost" href="message://">Open Mail</a>` : /gmail\.com$/i.test(email) ? `<a class="btn ob-ghost" href="https://mail.google.com/mail/u/0/#search/from%3Asupabase" target="_blank" rel="noopener">Open Gmail</a>` : "";
    gate(card(`${dots(1)}<div class="ob-env" aria-hidden="true"><svg viewBox="0 0 64 48"><rect x="2" y="2" width="60" height="44" rx="7" fill="#FFE14D" stroke="#14181D" stroke-width="3"/><path d="M4 6l28 22L60 6" fill="none" stroke="#14181D" stroke-width="3" stroke-linejoin="round"/></svg><span class="ob-ping"></span></div>
      <h2>Check your inbox</h2><p class="ob-sub">We sent a confirmation link to <b>${esc(email)}</b>. Tap it, then come back here.${pw?" This screen will continue by itself.":""}</p>
      ${msgBox(note, "ok")}
      <div class="ob-btns">${mail}<button class="btn primary ob-cta" type="button" id="iveConfirmed">I've confirmed, continue</button></div>
      <p class="ob-foot">Nothing arrived? Check spam, or <a href="#" id="resend">send it again</a>. · <a href="#" data-go="signup">Use a different email</a></p>`));
    $("#resend").onclick = async e => { e.preventDefault(); const {error}=await sb.auth.resend({type:"signup", email, options:{emailRedirectTo: location.origin + "/?confirmed=1"}}); screens.checkEmail(email, error?friendly(error.message):"Sent again. It can take a minute."); };
    $("#iveConfirmed").onclick = async () => { if(!(await tryAutoSignIn())) screens.signin("Great! Now sign in with your password.", email); };
  },

  signin(m, emailPrefill){
    gate(card(`<div class="ob-brand sm"><span class="cross">${X}</span><h1>Swiss Outings</h1></div><h2>Welcome back</h2>
      <form id="f" class="ob-form" novalidate>
        ${field("em","Email",`type="email" autocomplete="email" inputmode="email" required value="${esc(emailPrefill||cacheGet("email")||"")}"`)}
        ${field("pw","Password",`type="password" autocomplete="current-password" required`, eye("pw"))}
        ${msgBox(m, /^Great|^Password|^Sent/.test(m||"")?"ok":"err")}
        <button class="btn primary ob-cta" type="submit">Sign in</button>
      </form>
      <p class="ob-foot"><a href="#" data-go="reset">Forgot password?</a> · New here? <a href="#" data-go="signup">Create an account</a></p>`, {back:"welcome"}));
    ($("#em").value ? $("#pw") : $("#em")).focus();
    $("#f").onsubmit = async ev => {
      ev.preventDefault(); const email=$("#em").value.trim(); cacheSet("email",email);
      const b=ev.target.querySelector("button[type=submit]"); busy(b,true,"Signing in…");
      const r = await sb.auth.signInWithPassword({ email, password: $("#pw").value });
      busy(b,false);
      if(r.error) return screens.signin(friendly(r.error.message), email);
      start();
    };
  },

  reset(m){
    gate(card(`<h2>Reset your password</h2><p class="ob-sub">We'll email you a link to choose a new one.</p>
      <form id="f" class="ob-form">${field("em","Email",`type="email" autocomplete="email" required value="${esc(cacheGet("email")||"")}"`)}${msgBox(m)}
      <button class="btn primary ob-cta" type="submit">Email me a link</button></form>`, {back:"signin"}));
    $("#f").onsubmit = async ev => { ev.preventDefault(); const email=$("#em").value.trim(); const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo: location.origin+"/?reset=1"}); if(error) return screens.reset(friendly(error.message)); screens.signin("Sent! Open the link in the email to choose a new password.", email); };
  },

  newPassword(m){
    gate(card(`<h2>Choose a new password</h2><form id="f" class="ob-form">${field("pw","New password",`type="password" minlength="8" required autocomplete="new-password"`, eye("pw"))}${msgBox(m)}<button class="btn primary ob-cta" type="submit">Save password</button></form>`));
    $("#f").onsubmit = async ev => { ev.preventDefault(); const {error}=await sb.auth.updateUser({password:$("#pw").value}); if(error) return screens.newPassword(friendly(error.message)); history.replaceState(null,"","/"); start(); };
  },

  profile(m){
    const p = pending(); const mode = p.invite ? "invite" : "join";
    const locked = !!(p.invite || p.join);
    gate(card(`${dots(2)}<h2>About you</h2><p class="ob-sub">${locked?(p.invite?"Your invite code is filled in. Just add your name and a household name.":"Your partner's code is filled in. Just add your first name."):"How should the app greet you, and whose plans do you share?"}</p>
      <form id="f" class="ob-form" novalidate>
        ${field("nm","Your first name",`required autocomplete="given-name" autocapitalize="words" value="${esc(cacheGet("name")||"")}"`)}
        ${locked?"":`<div class="ob-choice" role="radiogroup" aria-label="How are you joining?">
          <button type="button" role="radio" data-mode="join" aria-checked="${mode==="join"}"><b>👫 Join my partner</b><span>They're already on Outings and gave you a 6-letter household code.</span></button>
          <button type="button" role="radio" data-mode="invite" aria-checked="${mode==="invite"}"><b>✉️ I have a friend's invite</b><span>Start your own household. Your plans stay private.</span></button>
        </div>`}
        <div id="joinBox" ${mode==="join"?"":"hidden"}>${field("jc","Household code",`autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="e.g. BARDEA" value="${esc(p.join||"")}" ${p.join?"readonly":""}`)}</div>
        <div id="invBox" ${mode==="invite"?"":"hidden"}>${field("ic","Invite code",`autocapitalize="characters" autocomplete="off" spellcheck="false" value="${esc(p.invite||"")}" ${p.invite?"readonly":""}`)}${field("hn","Household name",`placeholder="e.g. The Cohens" autocapitalize="words"`)}</div>
        ${msgBox(m)}
        <button class="btn primary ob-cta" type="submit">Continue</button>
      </form>
      <p class="ob-foot">No code? Ask whoever told you about Swiss Outings. It's invite-only. · <a href="#" id="obOut">Sign out</a></p>`));
    let cur = mode;
    document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{ cur=b.dataset.mode; document.querySelectorAll("[data-mode]").forEach(x=>x.setAttribute("aria-checked", x===b)); $("#joinBox").hidden=cur!=="join"; $("#invBox").hidden=cur!=="invite"; });
    $("#obOut").onclick = async e => { e.preventDefault(); await sb.auth.signOut(); cacheSet("pending",null); location.href="/"; };
    $("#nm").focus();
    $("#f").onsubmit = async ev => {
      ev.preventDefault(); const name=$("#nm").value.trim(); if(!name) return screens.profile("Please add your first name.");
      cacheSet("name", name);
      const b=ev.target.querySelector("button[type=submit]"); busy(b,true);
      const r = cur==="invite" ? await sb.rpc("redeem_invite",{p_code:$("#ic").value, p_household_name:$("#hn").value, p_name:name})
                               : await sb.rpc("join_household",{p_code:$("#jc").value, p_name:name});
      busy(b,false);
      if(r.error) return screens.profile(friendly(r.error.message));
      cacheSet("pending", null); history.replaceState(null,"","/");
      cacheSet("needsInstall", 1);
      start();
    };
  },

  install(){
    gate(card(`${dots(3)}<h2>Put it on your home screen</h2><p class="ob-sub">Outings opens full-screen like a real app, with no App Store needed.</p>
      ${IG.stepsHTML()}
      <button class="btn primary ob-cta" type="button" id="obDone">${IG.platform()==="desktop"?"Continue to the app":"Done, show me events"}</button>
      <p class="ob-foot"><a href="#" id="obLater">I'll do it later</a> · You can always find this in Settings.</p>`, {wide:true}) + IG.pointer());
    IG.wire($("#gate"));
    const done = () => { cacheSet("needsInstall", null); gate(null); document.querySelector(".ig-pointer")?.remove(); A.toast("Welcome"+(cacheGet("name")?", "+cacheGet("name"):"")+"! Tap ♥ on anything you like."); };
    $("#obDone").onclick = done; $("#obLater").onclick = e => { e.preventDefault(); done(); };
  }
};

async function tryAutoSignIn(){
  if(!pw || !pwEmail) return false;
  const r = await sb.auth.signInWithPassword({ email: pwEmail, password: pw });
  if(r.error) return false;
  pw = null; start(); return true;
}
document.addEventListener("visibilitychange", () => { if(!document.hidden && pw) tryAutoSignIn(); });

/* ---------- data ---------- */
function mapEvent(row){ const e=Object.assign({}, row.data); e.id=row.id; if(row.first_seen) e.firstSeen=row.first_seen; return e; }
async function loadEvents(){
  const out=[]; let from=0;
  while(true){ const {data,error}=await sb.from("events").select("id,data,first_seen").range(from, from+999); if(error) throw error; out.push(...data); if(data.length<1000) break; from+=1000; }
  S.events = out.map(mapEvent); cacheSet("events", S.events);
}
async function loadPicks(){
  const {data} = await sb.from("picks").select("event_id,user_id,state,household_id").eq("household_id", S.household.id);
  const m={}; (data||[]).forEach(p=>{ (m[p.event_id]=m[p.event_id]||{})[p.user_id]=p.state; }); S.marks=m;
  const fr = await sb.rpc("friend_picks"); const f={}; (fr.data||[]).forEach(x=>{ (f[x.event_id]=f[x.event_id]||[]).push({household_name:x.household_name,state:x.state}); }); S.friendPicks=f;
}
async function loadHidden(){
  const {data} = await sb.from("hidden").select("event_id,title,created_at").eq("household_id", S.household.id);
  const m={}; (data||[]).forEach(h=>m[h.event_id]={eventId:h.event_id,title:h.title,at:h.created_at}); S.hidden=m;
}
async function loadConfig(){
  const {data} = await sb.from("app_config").select("key,value");
  const c={}; (data||[]).forEach(r=>c[r.key]=r.value); S.config=c;
  S.meta = { seedDate:"2026-09-26", lastRun: c.scan&&c.scan.lastRun, lastAdded: c.scan&&c.scan.lastAdded };
}
async function adminImports(){
  if(!S.isAdmin) return;
  try{
    if(!S.events.length){
      const seed = await (await fetch("/seed.json",{cache:"no-store"})).json();
      const {error} = await sb.rpc("import_seed",{p_events:seed.events, p_picks:seed.picks, p_hidden:seed.hidden});
      if(!error) await loadEvents();
    }
    const pr = await fetch("/pending.json",{cache:"no-store"});
    if(pr.ok){ const p = await pr.json(); if(p && p.events && p.events.length){ const {error}=await sb.rpc("admin_upsert_events",{p:p.events, p_added:p.added||null, p_note:p.note||null}); if(!error){ await Promise.all([loadEvents(), loadConfig()]); } } }
  }catch(e){ console.warn("import", e); }
}
function setSubline(){
  const sl=$("#subline"); if(!sl) return;
  const sc=S.config.scan||{}; const n=S.events.filter(e=>!A.isPast(e)).length;
  sl.textContent = sc.lastRun ? "Updated "+A.fmtStamp(sc.lastRun)+(sc.lastAdded?" · "+sc.lastAdded+" new":"") : "Switzerland · "+n+" upcoming";
}
let rtStarted=false;
function realtime(){
  if(rtStarted) return; rtStarted=true;
  sb.channel("hh-"+S.household.id)
    .on("postgres_changes",{event:"*",schema:"public",table:"picks",filter:"household_id=eq."+S.household.id}, ()=>{ loadPicks().then(A.render); })
    .on("postgres_changes",{event:"*",schema:"public",table:"hidden",filter:"household_id=eq."+S.household.id}, ()=>{ loadHidden().then(A.render); })
    .subscribe();
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden && S.household){ Promise.all([loadEvents(),loadPicks(),loadHidden(),loadConfig()]).then(()=>{ setSubline(); A.render(); }).catch(()=>{}); } });
}

/* ---------- start ---------- */
async function start(){
  if(params.get("reset")){ const {data}=await sb.auth.getSession(); if(data.session) return screens.newPassword(); }
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){
    const p=pending();
    if(params.get("confirmed")) return screens.signin("Great! Your email is confirmed. Sign in to continue.");
    return (p.invite||p.join) ? screens.welcome() : (cacheGet("email") ? screens.signin() : screens.welcome());
  }
  S.uid = session.user.id;
  const mem = await sb.from("members").select("user_id,household_id,display_name,is_admin").eq("user_id", S.uid).maybeSingle();
  if(!mem.data) return screens.profile();
  S.isAdmin = !!mem.data.is_admin;
  const hh = await sb.from("households").select("*").eq("id", mem.data.household_id).single();
  S.household = hh.data;
  const ms = await sb.from("members").select("user_id,display_name,is_admin").eq("household_id", S.household.id);
  S.members={}; (ms.data||[]).forEach(m=>S.members[m.user_id]=m);
  if(cacheGet("needsInstall") && !IG.isStandalone()) screens.install(); else gate(null);
  const cached=cacheGet("events"); if(cached && !S.events.length){ S.events=cached; S.loaded=true; A.render(); }
  try{
    await Promise.all([loadEvents(), loadConfig()]);
    await adminImports();
    await Promise.all([loadPicks(), loadHidden()]);
  }catch(e){ console.error(e); if(!S.events.length){ S.dbFailed=true; } }
  S.loaded = true;
  setSubline();
  A.render();
  realtime();
}
sb.auth.onAuthStateChange((ev)=>{ if(ev==="PASSWORD_RECOVERY") screens.newPassword(); });
start();

/* ---------- service worker ---------- */
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("/sw.js").catch(()=>{})); }
})();
