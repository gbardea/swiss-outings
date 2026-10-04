const V="so-v5";
const SHELL=["/","/index.html","/styles.css","/core.js","/app.js","/config.js","/native.js","/install.js","/manifest.webmanifest","/icons/icon-192.png"];
self.addEventListener("install",e=>{ e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())); });
self.addEventListener("activate",e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=="GET" || u.origin!==location.origin || u.pathname.startsWith("/api/") || u.pathname==="/seed.json" || u.pathname==="/pending.json") return;
  // network first, fall back to cache (keeps the app fresh, works offline)
  e.respondWith(fetch(e.request).then(r=>{ const c=r.clone(); caches.open(V).then(x=>x.put(e.request,c)); return r; }).catch(()=>caches.match(e.request).then(r=>r||caches.match("/index.html"))));
});
