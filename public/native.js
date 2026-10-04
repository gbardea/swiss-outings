/* Swiss Outings — bridge to the iPhone app shell (no-op in a browser) */
(function(){
"use strict";
const C = window.Capacitor;
const native = !!(C && C.isNativePlatform && C.isNativePlatform());
const WEB = (window.SO_CONFIG && window.SO_CONFIG.web) || "https://swiss-outings.vercel.app";
const P = n => (native && C.Plugins && C.Plugins[n]) || null;
const N = window.SO_native = {
  isNative: native,
  origin: native ? WEB : location.origin,
  api: p => (native ? WEB : "") + p,
  haptic(kind){ const h=P("Haptics"); if(!h) return; try{ kind==="success" ? h.notification({type:"SUCCESS"}) : h.impact({style: kind==="heavy"?"HEAVY":"LIGHT"}); }catch(e){} },
  async share(o){ const s=P("Share"); if(!s) return false; try{ await s.share(o); return true; }catch(e){ return true; } },
  async open(url){ const b=P("Browser"); if(!b) return false; try{ await b.open({url}); return true; }catch(e){ return false; } },
  /* Native "new event" sheet, pre-filled. Returns true when handled natively. */
  async addToCalendar(ev){
    const cal=P("CapacitorCalendar"); if(!cal) return false;
    try{
      await cal.createEventWithPrompt({ title: ev.title, startDate: ev.start, endDate: ev.end, isAllDay: !!ev.allDay, location: ev.location||undefined, description: ev.notes||undefined, url: ev.url||undefined, alerts: ev.allDay ? [-1440] : [-1440, -120] });
      return true;
    }catch(e){ console.warn("calendar", e); return false; }
  }
};
if(!native) return;
document.documentElement.classList.add("native");
try{ const sb=P("StatusBar"); sb && sb.setStyle({style:"DEFAULT"}); }catch(e){}
/* external links open in the in-app browser instead of replacing the app */
document.addEventListener("click", ev => {
  const a = ev.target.closest && ev.target.closest("a[href]"); if(!a) return;
  const h = a.getAttribute("href")||""; if(!/^https?:\/\//i.test(h)) return;
  ev.preventDefault(); N.open(h);
}, true);
})();
