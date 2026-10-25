/* Swiss Outings — admin dashboard. All data comes from admin_* database functions, which refuse non-admins. */
(function(){
"use strict";
const C = window.SO_CONFIG;
const sb = window.supabase.createClient(C.url, C.key, { auth: { persistSession: true, autoRefreshToken: true } });
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const KIND = { app_open:"opened the app", sign_in:"signed in", sign_up:"signed up", view:"viewed", listen:"listened to", keen:"♥ keen on", unkeen:"un-keened", going:"✓ going to",
  ungoing:"no longer going to", hide:"✕ hid", unhide:"restored", calendar:"added to calendar", tickets:"🎟 tickets", official:"opened official page", video:"watched video",
  photos:"looked at photos", map:"opened map", share:"shared", invite:"sent an invite", contact:"sent a message", install_help:"opened install help", search:"searched" };
const A = { tab: (location.hash||"#overview").slice(1), users: [], hh: [], sort: {} };

function ago(t){ if(!t) return "—"; const s=(Date.now()-new Date(t))/1000; if(s<60) return "just now"; if(s<3600) return Math.floor(s/60)+" min ago"; if(s<86400) return Math.floor(s/3600)+" h ago"; if(s<86400*30) return Math.floor(s/86400)+" d ago"; return new Date(t).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}); }
function dt(t){ return t? new Date(t).toLocaleString("en-GB",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}) : "—"; }
function toast(m){ const d=document.createElement("div"); d.className="toast"; d.textContent=m; document.body.appendChild(d); setTimeout(()=>d.remove(),3000); }
async function rpc(fn, args){ const {data,error}=await sb.rpc(fn,args||{}); if(error){ toast(error.message); throw error; } return data; }
function evLink(id, title){ return id ? `<a href="/e/${encodeURIComponent(id)}" target="_blank" rel="noopener">${esc(title||id)}</a>` : ""; }
function metaText(k, m){ if(!m||typeof m!=="object") return ""; if(k==="search") return `“${esc(m.q||"")}”${m.voice?" 🎙":""} → ${m.results??"?"} results`; if(k==="share"||k==="invite") return esc([m.via,m.who].filter(Boolean).join(" · ")); if(k==="tickets") return esc(m.step||""); if(k==="app_open") return esc([m.platform, m.installed?"home screen":""].filter(Boolean).join(" · ")); if(k==="sign_up") return esc(m.joined||""); if(k==="contact") return esc(m.kind||""); return ""; }
function actRow(a, showWho){ return `<tr>${`<td class="muted">${dt(a.at)}</td>`}${showWho?`<td><a href="#" data-user="${esc(a.user_id)}">${esc(a.who||"?")}</a></td>`:""}<td><span class="k-${esc(a.kind)}">${esc(KIND[a.kind]||a.kind)}</span></td><td class="wrapc">${evLink(a.event_id, a.event_title)} <span class="muted">${metaText(a.kind,a.meta)}</span></td></tr>`; }
function sortable(rows, key, cols){ const s=A.sort[key]; if(!s) return rows; const c=cols[s.col]; return rows.slice().sort((a,b)=>{ const x=c(a), y=c(b); return (x>y?1:x<y?-1:0)*(s.dir); }); }

/* ---------- views ---------- */
const V = {
  async overview(){
    const o = await rpc("admin_overview");
    const daily=o.daily||[], max=Math.max(1,...daily.map(d=>d.active)), maxA=Math.max(1,...(o.added_daily||[]).map(d=>d.n));
    const scan=o.scan||{};
    $("#main").innerHTML = `<h2>Overview</h2>
      <div class="kpis">
        <div class="kpi"><b>${o.users}</b><span>accounts (${o.confirmed} confirmed)</span></div>
        <div class="kpi"><b>${o.active1}</b><span>active today</span></div>
        <div class="kpi"><b>${o.active7}</b><span>active last 7 days</span></div>
        <div class="kpi"><b>${o.signups7}</b><span>sign-ups last 7 days</span></div>
        <div class="kpi"><b>${o.households}</b><span>households</span></div>
        <div class="kpi"><b>${o.events_upcoming}</b><span>upcoming events</span></div>
        <div class="kpi"><b>${o.events_added7}</b><span>events added last 7 days</span></div>
        <div class="kpi"><b>${o.picks}</b><span>keen / going picks</span></div>
        <div class="kpi"><b>${o.hidden}</b><span>hidden (“not for us”)</span></div>
        <div class="kpi"><b>${o.messages_open}</b><span>unread messages</span></div>
      </div>
      <div class="grid2">
        <div class="panel"><h3>Active people per day (30 days)</h3><div class="chart">${daily.map(d=>`<div style="height:${d.active/max*100}%" title="${esc(d.day)}: ${d.active} active, ${d.actions} actions, ${d.signups} sign-ups"></div>`).join("")}</div><div class="chart-x"><span>${esc(daily[0]&&daily[0].day||"")}</span><span>today</span></div></div>
        <div class="panel"><h3>Events added by the morning scan (30 days)</h3><div class="chart">${(o.added_daily||[]).map(d=>`<div class="alt" style="height:${d.n/maxA*100}%" title="${esc(d.day)}: ${d.n} new"></div>`).join("")||'<p class="muted">No data</p>'}</div><div class="chart-x"><span></span><span>today</span></div></div>
      </div>
      <div class="panel"><h3>Sunday email</h3><p class="muted">Goes out every Sunday around 7:00 to everyone who opted in.</p><button class="btn" type="button" id="nlTest">Send me this week's email now</button> <span class="muted" id="nlMsg"></span></div>
      <div class="panel"><h3>Last morning scan</h3><p><b>${esc(dt(scan.lastRun))}</b> · ${esc(scan.lastAdded??0)} new<br><span class="muted">${esc(scan.lastNote||"")}</span></p></div>
      <div class="panel"><h3>Latest activity</h3><table><tbody id="latest"></tbody></table><p><a href="#activity">See all activity →</a></p></div>`;
    const act = await rpc("admin_recent_activity",{p_limit:15});
    $("#latest").innerHTML = act.map(a=>actRow(a,true)).join("") || `<tr><td class="muted">No activity yet. It is recorded from the new app version onwards.</td></tr>`;
  },
  async users(){
    A.users = await rpc("admin_users");
    const cols={name:u=>(u.display_name||u.email||"").toLowerCase(), last:u=>u.last_active||u.last_sign_in_at||"", joined:u=>u.created_at, views:u=>+u.views, listens:u=>+u.listens, keen:u=>+u.keen, going:u=>+u.going, hidden:u=>+u.hidden, clicks:u=>+u.clicks, shares:u=>+u.shares};
    const q=(A.uq||"").toLowerCase();
    const rows=sortable(A.users.filter(u=>!q||(u.email+" "+(u.display_name||"")+" "+(u.household_name||"")).toLowerCase().includes(q)),"users",cols);
    $("#main").innerHTML = `<h2>Users (${A.users.length})</h2>
      <div class="tools"><input id="uq" placeholder="Search name, email, household" value="${esc(A.uq||"")}"><span class="muted">Click a person for their full history and to manage them.</span></div>
      <div class="panel"><table><thead><tr><th data-sort="name">Person</th><th>Household</th><th data-sort="last">Last active</th><th data-sort="joined">Joined</th><th class="num" data-sort="views">Viewed</th><th class="num" data-sort="listens">Listened</th><th class="num" data-sort="keen">♥ Keen</th><th class="num" data-sort="going">✓ Going</th><th class="num" data-sort="hidden">✕ Hidden</th><th class="num" data-sort="clicks">Clicks out</th><th class="num" data-sort="shares">Shares</th></tr></thead>
      <tbody>${rows.map(u=>`<tr class="click" data-user="${esc(u.user_id)}"><td><b>${esc(u.display_name||"(no name)")}</b>${u.is_admin?' <span class="pill">admin</span>':""}${u.confirmed?"":' <span class="pill" style="color:var(--bad)">unconfirmed</span>'}<br><span class="muted">${esc(u.email)}</span></td><td>${esc(u.household_name||"—")}</td><td>${ago(u.last_active||u.last_sign_in_at)}</td><td class="muted">${ago(u.created_at)}</td><td class="num">${u.views}</td><td class="num">${u.listens}</td><td class="num">${u.keen}</td><td class="num">${u.going}</td><td class="num">${u.hidden}</td><td class="num">${u.clicks}</td><td class="num">${u.shares}</td></tr>`).join("")}</tbody></table></div>`;
    $("#uq").oninput=e=>{ A.uq=e.target.value; clearTimeout(A.uqT); A.uqT=setTimeout(()=>{ V.users().then(()=>{ const i=$("#uq"); i.focus(); i.setSelectionRange(i.value.length,i.value.length); }); },250); };
  },
  async activity(){
    const kind=A.kind||"";
    const act = await rpc("admin_recent_activity",{p_limit:500});
    const rows = act.filter(a=>!kind||a.kind===kind);
    $("#main").innerHTML = `<h2>Activity</h2>
      <div class="tools"><select id="kind"><option value="">Everything</option>${Object.entries(KIND).map(([k,l])=>`<option value="${k}" ${k===kind?"selected":""}>${esc(l)}</option>`).join("")}</select><span class="muted">Latest 500 actions, newest first.</span></div>
      <div class="panel"><table><thead><tr><th>When</th><th>Who</th><th>Did</th><th>What</th></tr></thead><tbody>${rows.map(a=>actRow(a,true)).join("")||'<tr><td class="muted" colspan="4">Nothing yet.</td></tr>'}</tbody></table></div>`;
    $("#kind").onchange=e=>{ A.kind=e.target.value; V.activity(); };
  },
  async events(){
    const days=A.days||30;
    const ev = await rpc("admin_event_stats",{p_days:days});
    const cols={title:e=>(e.title||"").toLowerCase(), date:e=>e.start_date||"", views:e=>+e.views, listens:e=>+e.listens, keen:e=>+e.keen, going:e=>+e.going, hidden:e=>+e.hidden, clicks:e=>+e.clicks, shares:e=>+e.shares};
    const rows=sortable(ev,"events",cols);
    $("#main").innerHTML = `<h2>Events people interact with</h2>
      <div class="tools"><select id="days">${[7,30,90,365].map(d=>`<option value="${d}" ${d===days?"selected":""}>Views & clicks: last ${d} days</option>`).join("")}</select><span class="muted">Keen / going / hidden are current totals.</span></div>
      <div class="panel"><table><thead><tr><th data-sort="title">Event</th><th data-sort="date">Date</th><th>Category</th><th class="num" data-sort="views">Viewed</th><th class="num" data-sort="listens">Listened</th><th class="num" data-sort="keen">♥ Keen</th><th class="num" data-sort="going">✓ Going</th><th class="num" data-sort="hidden">✕ Hidden</th><th class="num" data-sort="clicks">Clicks out</th><th class="num" data-sort="shares">Shares</th></tr></thead>
      <tbody>${rows.map(e=>`<tr><td class="wrapc">${evLink(e.event_id,e.title)}${e.start_date?"":' <span class="pill">past</span>'}</td><td class="muted">${esc(e.start_date||"")}</td><td>${esc(e.category||"")}</td><td class="num">${e.views}</td><td class="num">${e.listens}</td><td class="num">${e.keen}</td><td class="num">${e.going}</td><td class="num">${e.hidden}</td><td class="num">${e.clicks}</td><td class="num">${e.shares}</td></tr>`).join("")||'<tr><td class="muted" colspan="10">Nothing yet.</td></tr>'}</tbody></table></div>`;
    $("#days").onchange=e=>{ A.days=+e.target.value; V.events(); };
  },
  async messages(){
    const ms = await rpc("admin_messages");
    const L={venue:"📍 Venue suggestion",contact:"✉️ Message",bug:"🐞 Problem"};
    $("#main").innerHTML = `<h2>Messages</h2>${ms.map(m=>`<div class="msg ${m.handled?"done":""}"><b>${esc(L[m.kind]||m.kind)}</b> · ${esc(m.name||"(no name)")} ${m.email?`· <a href="mailto:${esc(m.email)}?subject=${encodeURIComponent("Re: your message to Swiss Outings")}">${esc(m.email)}</a>`:""} <span class="muted">· ${dt(m.at)}</span>
      <p>${esc(m.body)}</p><button class="btn" data-done="${m.id}" data-v="${m.handled?0:1}">${m.handled?"Mark as unread":"Mark as done"}</button>${m.user_id?` <button class="btn" data-user="${esc(m.user_id)}">See this person</button>`:""}</div>`).join("") || '<p class="muted">No messages yet.</p>'}`;
  },
  async households(){
    A.hh = await rpc("admin_households");
    $("#main").innerHTML = `<h2>Households (${A.hh.length})</h2><div class="panel"><table><thead><tr><th>Household</th><th>Members</th><th class="num">Friends</th><th>Created</th></tr></thead><tbody>
      ${A.hh.map(h=>`<tr><td><b>${esc(h.name)}</b></td><td>${(h.members||[]).map(m=>`<a href="#" data-user="${esc(m.user_id)}">${esc(m.name||"(no name)")}</a>`).join(", ")||'<span class="muted">empty</span>'}</td><td class="num">${h.friends}</td><td class="muted">${ago(h.created_at)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted">To put two partners in one household, open one of them and use “Move to household”.</p>`;
  }
};

/* ---------- person drawer ---------- */
async function openUser(id){
  if(!A.users.length) A.users = await rpc("admin_users");
  if(!A.hh.length) A.hh = await rpc("admin_households");
  const u = A.users.find(x=>x.user_id===id); if(!u){ toast("User not found"); return; }
  const d = await rpc("admin_user_detail",{p_user:id});
  $("#drawer").innerHTML = `<div class="drawer" data-close><div>
    <div class="tools" style="justify-content:space-between"><h2 style="margin:0">${esc(u.display_name||"(no name)")}</h2><button class="btn" data-close>Close</button></div>
    <p class="muted" style="margin-top:0">${esc(u.email)} · joined ${dt(u.created_at)} · last active ${ago(u.last_active||u.last_sign_in_at)}${u.confirmed?"":" · <b>email not confirmed</b>"}</p>
    <div class="kpis"><div class="kpi"><b>${u.views}</b><span>events viewed</span></div><div class="kpi"><b>${u.listens}</b><span>listened</span></div><div class="kpi"><b>${u.keen}</b><span>♥ keen</span></div><div class="kpi"><b>${u.going}</b><span>✓ going</span></div><div class="kpi"><b>${u.hidden}</b><span>✕ hidden</span></div><div class="kpi"><b>${u.clicks}</b><span>clicks to tickets/sites</span></div></div>
    <div class="panel"><h3>Manage</h3>
      <div class="tools"><input id="nm" value="${esc(u.display_name||"")}" placeholder="Display name"><button class="btn" id="saveNm">Rename</button></div>
      <div class="tools"><select id="mv">${A.hh.map(h=>`<option value="${esc(h.id)}" ${h.id===u.household_id?"selected":""}>${esc(h.name)} (${(h.members||[]).map(m=>esc(m.name||"?")).join(", ")})</option>`).join("")}</select><button class="btn" id="move">Move to household</button></div>
      <div class="tools"><button class="btn" id="adm">${u.is_admin?"Remove admin rights":"Make admin"}</button><button class="btn danger" id="del">Delete this person</button></div>
      <p class="muted">Household: ${esc(u.household_name||"none")} · members: ${(d.household_members||[]).map(m=>esc(m.name||"?")).join(", ")} · friends: ${(d.friends||[]).map(f=>esc(f.household)+(f.share_plans?" (sharing)":"")).join(", ")||"none"}</p>
    </div>
    <div class="grid2">
      <div class="panel"><h3>Picks (${d.picks.length})</h3><table><tbody>${d.picks.map(p=>`<tr><td>${p.state==="going"?"✓ going":"♥ keen"}</td><td class="wrapc">${evLink(p.event_id,p.title)}</td><td class="muted">${esc(p.start||"")}</td></tr>`).join("")||'<tr><td class="muted">None</td></tr>'}</tbody></table></div>
      <div class="panel"><h3>Didn't like (${d.hidden.length})</h3><table><tbody>${d.hidden.map(h=>`<tr><td class="wrapc">${esc(h.title||h.event_id)}</td><td class="muted">${esc(h.category||"")}</td></tr>`).join("")||'<tr><td class="muted">None</td></tr>'}</tbody></table></div>
    </div>
    <div class="panel"><h3>Everything they did (latest 400)</h3><table><tbody>${d.activity.map(a=>actRow(a,false)).join("")||'<tr><td class="muted">No activity recorded yet.</td></tr>'}</tbody></table></div>
  </div></div>`;
  const reload = async () => { A.users=[]; A.hh=[]; await V[A.tab](); openUser(id); };
  $("#saveNm").onclick=async()=>{ await rpc("admin_set_name",{p_user:id,p_name:$("#nm").value}); toast("Renamed"); reload(); };
  $("#move").onclick=async()=>{ if(!confirm("Move "+(u.display_name||u.email)+" into this household? Their picks move with them.")) return; await rpc("admin_move_user",{p_user:id,p_household:$("#mv").value}); toast("Moved"); reload(); };
  $("#adm").onclick=async()=>{ if(!confirm(u.is_admin?"Remove admin rights?":"Give admin rights? They will see everyone's data.")) return; await rpc("admin_set_admin",{p_user:id,p_on:!u.is_admin}); toast("Updated"); reload(); };
  $("#del").onclick=async()=>{ const t=prompt("This permanently deletes "+(u.email)+", their picks and history. Type DELETE to confirm."); if(t!=="DELETE") return; await rpc("admin_delete_user",{p_user:id}); toast("Deleted"); $("#drawer").innerHTML=""; A.users=[]; V[A.tab](); };
}

/* ---------- wiring ---------- */
function show(tab){ if(!V[tab]) tab="overview"; A.tab=tab; history.replaceState(null,"","#"+tab); document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-pressed", b.dataset.tab===tab)); $("#main").innerHTML='<p class="muted">Loading…</p>'; V[tab]().catch(e=>{ $("#main").innerHTML=`<p class="muted">Couldn't load: ${esc(e.message||e)}</p>`; }); }
document.addEventListener("click", e=>{
  const t=e.target;
  const tb=t.closest("#tabs button"); if(tb){ show(tb.dataset.tab); return; }
  const u=t.closest("[data-user]"); if(u){ e.preventDefault(); openUser(u.dataset.user); return; }
  if(t.matches("[data-close]")){ $("#drawer").innerHTML=""; return; }
  const th=t.closest("th[data-sort]"); if(th){ const key=A.tab, col=th.dataset.sort, cur=A.sort[key]; A.sort[key]={col, dir: cur&&cur.col===col ? -cur.dir : -1}; V[key](); return; }
  const dn=t.closest("[data-done]"); if(dn){ rpc("admin_message_done",{p_id:+dn.dataset.done,p_done:dn.dataset.v==="1"}).then(()=>{ V.messages(); badge(); }); return; }
  const a=t.closest('a[href^="#"]'); if(a && V[a.getAttribute("href").slice(1)]){ e.preventDefault(); show(a.getAttribute("href").slice(1)); }
});
document.addEventListener("click", async e=>{ if(e.target.id!=="nlTest") return; const m=$("#nlMsg"); m.textContent="Sending…";
  try{ const {data:{session}}=await sb.auth.getSession(); const r=await fetch("/api/newsletter?action=test",{method:"POST",headers:{Authorization:"Bearer "+session.access_token}}); const j=await r.json().catch(()=>({}));
    m.textContent = r.ok ? (j.sent ? "Sent! Check your inbox." : (j.note||"Nothing sent.")) : (j.error||("Error "+r.status)); }catch(x){ m.textContent="Couldn't send: "+x.message; } });
document.addEventListener("keydown", e=>{ if(e.key==="Escape") $("#drawer").innerHTML=""; });
async function badge(){ try{ const o=await rpc("admin_overview"); const b=document.querySelector('[data-tab="messages"]'); b.innerHTML="Messages"+(o.messages_open?`<span class="badge">${o.messages_open}</span>`:""); }catch(x){} }

(async function boot(){
  const {data:{session}} = await sb.auth.getSession();
  if(!session){ $("#main").innerHTML=`<div class="center"><h2>Please sign in</h2><p class="muted">Sign in to Swiss Outings first, then come back to this page.</p><a class="btn p" href="/">Open Swiss Outings</a></div>`; return; }
  const {data:isAccount} = await sb.rpc("i_am_admin_account");
  if(!isAccount){ $("#main").innerHTML=`<div class="center"><h2>Admins only</h2><p class="muted">This page is only for the people who run Swiss Outings.</p><a class="btn p" href="/">Back to events</a></div>`; return; }
  if(!(await secondStep())) return;
  const {data:isAdmin} = await sb.rpc("i_am_admin");
  if(!isAdmin){ $("#main").innerHTML=`<div class="center"><h2>Couldn't confirm admin access</h2><p class="muted">Please reload the page and enter a fresh code.</p></div>`; return; }
  show(A.tab); badge();
})();

/* ---------- second step: 6-digit code from an authenticator app (Supabase MFA) ---------- */
// Returns true when this session already has the second step (aal2); otherwise shows the setup or code screen and returns false.
async function secondStep(){
  let lvl=null; try{ const r=await sb.auth.mfa.getAuthenticatorAssuranceLevel(); lvl=r.data&&r.data.currentLevel; }catch(x){}
  if(lvl==="aal2") return true;
  let factors=[]; try{ const r=await sb.auth.mfa.listFactors(); factors=(r.data&&r.data.all)||[]; }catch(x){}
  const ok=factors.find(f=>f.factor_type==="totp" && f.status==="verified");
  const box=(inner)=>{ $("#main").innerHTML=`<div class="center mfa"><h2>🔒 Admin sign-in, step 2</h2>${inner}</div>`; };
  const codeForm=(factorId, lead)=>`${lead}<form id="mfaF" class="mfaform"><input id="mfaC" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="123456" aria-label="6-digit code" required><button class="btn p" type="submit">Unlock admin</button></form><p class="muted" id="mfaMsg" role="alert"></p>`;
  const wire=(factorId)=>{ const f=$("#mfaF"); setTimeout(()=>$("#mfaC").focus(),50);
    f.onsubmit=async e=>{ e.preventDefault(); const code=$("#mfaC").value.replace(/\D/g,""); $("#mfaMsg").textContent="Checking…";
      const {error}=await sb.auth.mfa.challengeAndVerify({factorId, code});
      if(error){ $("#mfaMsg").textContent="That code didn't work. Wait for the next code and try again."; $("#mfaC").value=""; return; }
      location.reload(); }; };
  if(ok){
    box(codeForm(ok.id, `<p class="muted">Open your authenticator app (Google Authenticator, 1Password, Authy…) and type the 6-digit code for <b>Swiss Outings</b>.</p>`));
    wire(ok.id); return false;
  }
  // first time: set up the authenticator
  for(const f of factors.filter(f=>f.status!=="verified")){ try{ await sb.auth.mfa.unenroll({factorId:f.id}); }catch(x){} }
  const {data, error}=await sb.auth.mfa.enroll({factorType:"totp", friendlyName:"Swiss Outings admin "+new Date().toISOString().slice(0,10)});
  if(error||!data||!data.totp){ box(`<p class="muted">Couldn't start the setup: ${esc((error&&error.message)||"unknown error")}. Check that MFA (TOTP) is enabled in Supabase → Authentication → Multi-factor.</p>`); return false; }
  box(codeForm(data.id, `<p class="muted">For extra safety the admin pages need a second step. One-time setup:</p>
    <ol class="mfasteps"><li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, 1Password or Authy).</li>
    <li>In the app, tap <b>+</b> and scan this code:</li></ol>
    <img class="mfaqr" alt="QR code for your authenticator app" src="${esc(data.totp.qr_code)}">
    <p class="muted small">Can't scan? Enter this key by hand: <code>${esc(data.totp.secret)}</code></p>
    <p class="muted">3. Type the 6-digit code the app shows:</p>`));
  wire(data.id); return false;
}
})();
