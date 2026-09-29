/* Swiss Outings — "put it on your home screen" guide */
(function(){
"use strict";
const ua = navigator.userAgent || "";
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|GSA\/|LinkedInApp|Twitter|Snapchat|Pinterest|MicroMessenger/.test(ua);
const iosOtherBrowser = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo/.test(ua);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isMobile = isIOS || isAndroid;
let deferredPrompt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; document.querySelectorAll("[data-native-install]").forEach(b => b.hidden = false); });
window.addEventListener("appinstalled", () => { deferredPrompt = null; try{ localStorage.setItem("so.installed","1"); }catch(e){} });

const URL_ = location.origin;
const I = {
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7.5 7.5 4.5-4.5 4.5 4.5"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  vdots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  compass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>'
};
const appIcon = '<img src="/icons/apple-touch-icon.png" alt="" width="44" height="44" style="border-radius:11px;display:block">';

function step(n, icon, title, body){
  return `<li class="ig-step"><span class="ig-n">${n}</span><div class="ig-body"><div class="ig-t">${title}</div>${body?`<div class="ig-d">${body}</div>`:""}</div><span class="ig-ic">${icon}</span></li>`;
}
function kbd(icon, label){ return `<span class="ig-kbd">${icon}${label?`<span>${label}</span>`:""}</span>`; }

function platform(){
  if(isStandalone()) return "installed";
  if(isIOS && inApp) return "ios-inapp";
  if(isIOS && iosOtherBrowser) return "ios-other";
  if(isIOS) return "ios";
  if(isAndroid && inApp) return "android-inapp";
  if(isAndroid) return "android";
  return "desktop";
}

function stepsHTML(){
  const p = platform();
  if(p === "installed") return `<div class="ig-done">${I.check}<div><b>You're all set.</b><br>You're using Outings from your home screen.</div></div>`;
  if(p === "ios") return `<ol class="ig-steps">
      ${step(1, I.share, `Tap ${kbd(I.share,"Share")} in Safari`, `It's in the toolbar at the bottom of the screen. On iOS 26, tap ${kbd(I.dots,"")} first, then <b>Share</b>.`)}
      ${step(2, I.plus, `Tap ${kbd(I.plus,"Add to Home Screen")}`, `Scroll down the list if you don't see it. It may be under <b>View More</b>.`)}
      ${step(3, appIcon, `Keep “Open as Web App” on, then tap <b>Add</b>`, `Outings now sits on your home screen next to your other apps.`)}
      ${step(4, I.compass, `Open Outings from your home screen`, `Sign in once more there. After that, you stay signed in.`)}
    </ol>`;
  if(p === "ios-other" || p === "ios-inapp") return `<div class="ig-warn"><b>Open this page in Safari first.</b> ${p==="ios-inapp"?"This page opened inside another app, which can't add it to your home screen.":"Safari gives you the smoothest install on iPhone."}</div>
    <ol class="ig-steps">
      ${step(1, I.copy, `Copy the link`, `<button class="btn ig-copy" type="button" data-ig-copy>${I.copy} Copy ${URL_.replace(/^https?:\/\//,"")}</button>`)}
      ${step(2, I.compass, `Open Safari and paste it`, `Tap the address bar, paste the link and go.`)}
      ${step(3, I.share, `Tap ${kbd(I.share,"Share")} → ${kbd(I.plus,"Add to Home Screen")} → <b>Add</b>`, `The guide shows up again in Safari if you need it.`)}
    </ol>`;
  if(p === "android-inapp") return `<div class="ig-warn"><b>Open this page in Chrome first.</b> Tap ${kbd(I.vdots,"")} at the top right and choose <b>Open in Chrome</b> (or “Open in browser”).</div>`;
  if(p === "android") return `<button class="btn primary ig-big" type="button" data-native-install ${deferredPrompt?"":"hidden"}>${I.plus} Install Outings</button>
    <ol class="ig-steps">
      ${step(1, I.vdots, `Tap ${kbd(I.vdots,"")} in Chrome`, `It's at the top right of the screen.`)}
      ${step(2, I.plus, `Tap <b>Add to Home screen</b> or <b>Install app</b>`, ``)}
      ${step(3, appIcon, `Tap <b>Install</b>`, `Outings now sits on your home screen and in your app drawer.`)}
    </ol>`;
  return `<div class="ig-desk"><div id="igQr" class="ig-qr" aria-label="QR code for ${URL_}"></div>
      <div><div class="ig-t">Scan with your phone's camera</div><div class="ig-d">It opens <b>${URL_.replace(/^https?:\/\//,"")}</b>. Then add it to your home screen: on iPhone, tap ${kbd(I.share,"Share")} → <b>Add to Home Screen</b> in Safari. On Android, tap ${kbd(I.vdots,"")} → <b>Install app</b> in Chrome.</div>
      <button class="btn" type="button" data-native-install ${deferredPrompt?"":"hidden"} style="margin-top:10px">${I.plus} Install on this computer</button></div></div>`;
}

function mountQR(root){
  const el = root.querySelector("#igQr"); if(!el) return;
  const draw = () => { try{ el.innerHTML=""; new window.QRCode(el, { text: URL_, width: 132, height: 132, colorDark: "#14181D", colorLight: "#ffffff" }); }catch(e){} };
  if(window.QRCode) return draw();
  const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; s.onload = draw; document.head.appendChild(s);
}

function wire(root){
  mountQR(root);
  root.querySelectorAll("[data-ig-copy]").forEach(b => b.onclick = async () => { try{ await navigator.clipboard.writeText(URL_); b.innerHTML = I.check + " Copied, now open Safari"; }catch(e){ b.textContent = URL_; } });
  root.querySelectorAll("[data-native-install]").forEach(b => b.onclick = async () => { if(!deferredPrompt) return; deferredPrompt.prompt(); const r = await deferredPrompt.userChoice; deferredPrompt = null; if(r && r.outcome === "accepted"){ b.innerHTML = I.check + " Installed"; b.disabled = true; } });
}

function pointer(){
  if(platform() !== "ios") return "";
  return `<div class="ig-pointer" aria-hidden="true"><span>Safari's toolbar is down here</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v15M5.5 12.5 12 19l6.5-6.5"/></svg></div>`;
}

/* Full-screen sheet version (from settings / banner) */
function open(){
  const host = document.getElementById("sheetHost");
  host.innerHTML = `<div class="scrim ig-scrim" data-ig-close><div class="ig-sheet" role="dialog" aria-modal="true" aria-label="Add to home screen">
    <div class="ig-head">${appIcon}<div><h2>Put Outings on your home screen</h2><p>It opens full-screen like a real app, with no App Store needed.</p></div><button class="iconbtn" type="button" data-ig-close aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    ${stepsHTML()}
    <button class="btn primary ig-big" type="button" data-ig-close>Got it</button>
  </div></div>${pointer()}`;
  document.body.style.overflow = "hidden";
  wire(host);
  host.querySelectorAll("[data-ig-close]").forEach(el => el.addEventListener("click", ev => { if(ev.target === el || el.tagName === "BUTTON"){ host.innerHTML = ""; document.body.style.overflow = ""; } }));
}

/* Small in-feed banner for mobile browsers */
function bannerHTML(){
  if(isStandalone() || !isMobile) return "";
  try{ if(localStorage.getItem("so.igDismissed") === "1") return ""; }catch(e){}
  return `<div class="ig-banner" role="region" aria-label="Install app">${appIcon}<div class="ig-bt"><b>Get Outings on your home screen</b><span>One tap to open, full-screen, like an app.</span></div><button class="btn primary" type="button" data-ig-open>Show me</button><button class="ig-x" type="button" data-ig-dismiss aria-label="Dismiss">✕</button></div>`;
}
document.addEventListener("click", ev => {
  if(ev.target.closest("[data-ig-open]")){ open(); return; }
  if(ev.target.closest("[data-ig-dismiss]")){ try{ localStorage.setItem("so.igDismissed","1"); }catch(e){} const b = ev.target.closest(".ig-banner"); b && b.remove(); }
});

window.SO_install = { open, stepsHTML, wire, pointer, bannerHTML, platform, isStandalone, isMobile, isIOS };
})();
