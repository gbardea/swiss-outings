/* Swiss Outings — auth, onboarding and data layer (Supabase) */
(function(){
"use strict";
const C = window.SO_CONFIG;
const sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
window.sb = sb;
const A = window.__app, S = A.S;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const params = new URLSearchParams(location.search);
const inviteParam = params.get("invite"), joinParam = params.get("join");

/* ---------- offline cache ---------- */
function cacheGet(k){ try{ return JSON.parse(localStorage.getItem("so."+k)||"null"); }catch(e){ return null; } }
function cacheSet(k,v){ try{ localStorage.setItem("so."+k, JSON.stringify(v)); }catch(e){} }

/* ---------- gate (sign in / onboarding) ---------- */
function gate(html){ const g=$("#gate"); g.hidden=!html; g.innerHTML=html||""; document.body.classList.toggle("gated", !!html); }
function authScreen(mode, msg){
  mode = mode||"signin";
  gate(`<div class="gate-card">
    <div class="gate-brand"><span class="cross" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M4.5 1h3v3.5H11v3H7.5V11h-3V7.5H1v-3h3.5z" fill="#fff"/></svg></span><h1>Swiss Outings</h1></div>
    <p class="gate-sub">Concerts, carnivals, cow parades and village gigs across Switzerland — planned together.</p>
    <form id="authForm" class="form" autocomplete="on">
      <div><label for="aEmail">Email</label><input id="aEmail" type="email" required autocomplete="email" inputmode="email" value="${esc(cacheGet("email")||"")}"></div>
      ${mode!=="reset"?`<div><label for="aPass">Password</label><input id="aPass" type="password" required minlength="8" autocomplete="${mode==="signup"?"new-password":"current-password"}"></div>`:""}
      <button class="btn primary" type="submit" style="justify-content:center">${mode==="signup"?"Create account":mode==="reset"?"Email me a reset link":"Sign in"}</button>
      ${msg?`<p class="note ${/error|not|invalid|wrong/i.test(msg)?"warn":""}">${esc(msg)}</p>`:""}
      <p class="gate-links">${mode==="signin"?`New here? <a href="#" data-mode="signup">Create an account</a> · <a href="#" data-mode="reset">Forgot password</a>`:`<a href="#" data-mode="signin">Back to sign in</a>`}</p>
    </form></div>`);
  $("#authForm").onsubmit = async ev => {
    ev.preventDefault();
    const email=$("#aEmail").value.trim(), pass=$("#aPass")&&$("#aPass").value; cacheSet("email",email);
    const btn=ev.target.querySelector("button[type=submit]"); btn.disabled=true;
    let r;
    if(mode==="signup") r = await sb.auth.signUp({ email, password: pass, options:{ emailRedirectTo: location.origin + "/" + location.search } });
    else if(mode==="reset") r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/?reset=1" });
    else r = await sb.auth.signInWithPassword({ email, password: pass });
    btn.disabled=false;
    if(r.error) return authScreen(mode, r.error.message);
    if(mode==="signup" && !r.data.session) return authScreen("signin", "Check your inbox and tap the confirmation link, then sign in here.");
    if(mode==="reset") return authScreen("signin", "Reset link sent. Check your email.");
    start();
  };
  document.querySelectorAll("[data-mode]").forEach(a=>a.onclick=e=>{ e.preventDefault(); authScreen(a.dataset.mode); });
}
function newPasswordScreen(){
  gate(`<div class="gate-card"><h2>Choose a new password</h2><form id="pwForm" class="form"><div><label for="np">New password</label><input id="np" type="password" minlength="8" required autocomplete="new-password"></div><button class="btn primary" type="submit" style="justify-content:center">Save password</button></form></div>`);
  $("#pwForm").onsubmit=async ev=>{ ev.preventDefault(); const {error}=await sb.auth.updateUser({password:$("#np").value}); if(error) alert(error.message); else { history.replaceState(null,"","/"); start(); } };
}
function onboardScreen(msg){
  gate(`<div class="gate-card">
    <h2>Welcome! One more step</h2>
    <p class="gate-sub">Join your partner’s household, or start a new one with an invite code from a friend.</p>
    <form id="obForm" class="form">
      <div><label for="obName">Your first name</label><input id="obName" required autocomplete="given-name"></div>
      <div class="seg" style="width:100%"><button type="button" data-ob="join" aria-pressed="${inviteParam?"false":"true"}">Join a household</button><button type="button" data-ob="invite" aria-pressed="${inviteParam?"true":"false"}">I have an invite</button></div>
      <div id="obJoin" ${inviteParam?"hidden":""}><label for="obCode">Household code</label><input id="obCode" autocapitalize="characters" value="${esc(joinParam||"")}" placeholder="e.g. BARDEA"></div>
      <div id="obInvite" ${inviteParam?"":"hidden"}><label for="obInv">Invite code</label><input id="obInv" autocapitalize="characters" value="${esc(inviteParam||"")}"><label for="obHh" style="margin-top:10px;display:block">Household name</label><input id="obHh" placeholder="e.g. The Cohens"></div>
      <button class="btn primary" type="submit" style="justify-content:center">Continue</button>
      ${msg?`<p class="note warn">${esc(msg)}</p>`:""}
      <p class="gate-links"><a href="#" id="obOut">Sign out</a></p>
    </form></div>`);
  document.querySelectorAll("[data-ob]").forEach(b=>b.onclick=()=>{ document.querySelectorAll("[data-ob]").forEach(x=>x.setAttribute("aria-pressed", x===b)); $("#obJoin").hidden=b.dataset.ob!=="join"; $("#obInvite").hidden=b.dataset.ob!=="invite"; });
  $("#obOut").onclick=async e=>{ e.preventDefault(); await sb.auth.signOut(); location.href="/"; };
  $("#obForm").onsubmit=async ev=>{
    ev.preventDefault();
    const name=$("#obName").value.trim(); const invite=!$("#obInvite").hidden;
    const r = invite ? await sb.rpc("redeem_invite",{p_code:$("#obInv").value, p_household_name:$("#obHh").value, p_name:name})
                     : await sb.rpc("join_household",{p_code:$("#obCode").value, p_name:name});
    if(r.error) return onboardScreen(r.error.message);
    history.replaceState(null,"","/"); start();
  };
}

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
async function maybeSeed(){
  if(!S.isAdmin || S.events.length) return;
  try{
    const seed = await (await fetch("/seed.json",{cache:"no-store"})).json();
    const {error} = await sb.rpc("import_seed",{p_events:seed.events, p_picks:seed.picks, p_hidden:seed.hidden});
    if(!error) await loadEvents();
  }catch(e){ console.warn("seed", e); }
}
let rtStarted=false;
function realtime(){
  if(rtStarted) return; rtStarted=true;
  sb.channel("hh-"+S.household.id)
    .on("postgres_changes",{event:"*",schema:"public",table:"picks",filter:"household_id=eq."+S.household.id}, ()=>{ loadPicks().then(A.render); })
    .on("postgres_changes",{event:"*",schema:"public",table:"hidden",filter:"household_id=eq."+S.household.id}, ()=>{ loadHidden().then(A.render); })
    .subscribe();
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden){ Promise.all([loadEvents(),loadPicks(),loadHidden()]).then(A.render).catch(()=>{}); } });
}

/* ---------- start ---------- */
async function start(){
  if(params.get("reset")){ const {data}=await sb.auth.getSession(); if(data.session) return newPasswordScreen(); }
  const { data:{ session } } = await sb.auth.getSession();
  if(!session){
    // show cached feed behind the sign-in card if we have one
    const c=cacheGet("events"); if(c){ S.events=c; S.loaded=true; A.render(); }
    return authScreen(inviteParam||joinParam ? "signup" : "signin", inviteParam||joinParam ? "Create an account to accept the invite." : "");
  }
  S.uid = session.user.id;
  const mem = await sb.from("members").select("user_id,household_id,display_name,is_admin").eq("user_id", S.uid).maybeSingle();
  if(!mem.data) return onboardScreen();
  S.isAdmin = !!mem.data.is_admin;
  const hh = await sb.from("households").select("*").eq("id", mem.data.household_id).single();
  S.household = hh.data;
  const ms = await sb.from("members").select("user_id,display_name,is_admin").eq("household_id", S.household.id);
  S.members={}; (ms.data||[]).forEach(m=>S.members[m.user_id]=m);
  gate(null);
  const cached=cacheGet("events"); if(cached && !S.events.length){ S.events=cached; S.loaded=true; A.render(); }
  try{
    await Promise.all([loadEvents(), loadConfig()]);
    await maybeSeed();
    await Promise.all([loadPicks(), loadHidden()]);
  }catch(e){ console.error(e); if(!S.events.length){ S.dbFailed=true; } }
  S.loaded = true;
  const up=S.events.filter(e=>!A.isPast(e)).length;
  const sl=$("#subline"); if(sl) sl.textContent="Switzerland · "+up+" upcoming";
  A.render();
  realtime();
}
sb.auth.onAuthStateChange((ev)=>{ if(ev==="PASSWORD_RECOVERY") newPasswordScreen(); });
start();

/* ---------- service worker ---------- */
if("serviceWorker" in navigator){ window.addEventListener("load", ()=>navigator.serviceWorker.register("/sw.js").catch(()=>{})); }
})();
