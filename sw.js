/* Cache only the public app shell. Proof-store reads always go to the network. */
var CACHE='proofshot-app-v7';
var SHELL=['app.html','app.js','index.html','demo.js','verify.html','verify.js','proof.js','config.js','ots.js','manifest.webmanifest','assets/vt-mark.png','icons/icon-192.png','icons/icon-512.png','icons/icon-maskable-512.png','icons/apple-touch-icon-180.png','icons/favicon-vt.png'];
self.addEventListener('install',function(event){event.waitUntil(caches.open(CACHE).then(function(cache){return cache.addAll(SHELL);}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(event){event.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(key){return key.indexOf('proofshot-app-')===0&&key!==CACHE;}).map(function(key){return caches.delete(key);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(event){
  var url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==location.origin||/^\/p(?:\/|$)/.test(url.pathname))return;
  var relative=url.pathname.slice(new URL(self.registration.scope).pathname.length)||'index.html';
  if(SHELL.indexOf(relative)<0)return;
  var key=new URL(relative,self.registration.scope).href;
  event.respondWith((async function(){
    try{var response=await fetch(event.request);if(response.ok){var copy=response.clone();event.waitUntil(caches.open(CACHE).then(function(cache){return cache.put(key,copy);}));}return response;}
    catch(error){var hit=await caches.match(key);return hit||Response.error();}
  })());
});
