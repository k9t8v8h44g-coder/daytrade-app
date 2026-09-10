const CACHE='daytrade-v423';
const STATIC=['./manifest.json'];

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  const url=new URL(req.url);

  // Do not cache Cloudflare Worker API requests.
  if(url.hostname.endsWith('workers.dev') || url.pathname.startsWith('/api/')){
    e.respondWith(fetch(req));
    return;
  }

  // Always prefer the newest HTML/navigation.
  if(req.mode==='navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/daytrade-app/')){
    e.respondWith(
      fetch(req,{cache:'no-store'})
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(c=>c.put(req,copy));
          return res;
        })
        .catch(()=>caches.match(req))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached=>cached || fetch(req).then(res=>{
      if(req.method==='GET' && res.ok){
        const copy=res.clone();
        caches.open(CACHE).then(c=>c.put(req,copy));
      }
      return res;
    }))
  );
});
