const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function load(overrides={}){const listeners={};const context={URL,Response,location:{origin:'http://localhost:8081'},self:{registration:{scope:'http://localhost:8081/'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>listeners[name]=fn},...overrides};vm.createContext(context);vm.runInContext(fs.readFileSync('sw.js','utf8'),context);return listeners;}
test('proof API reads are never intercepted or served from a shell cache',()=>{const handlers=load();let intercepted=false;handlers.fetch({request:{method:'GET',url:'http://localhost:8081/p/123456789abc'},respondWith(){intercepted=true}});assert.equal(intercepted,false);});
test('offline shell preserves the target page, including its language query',async()=>{let key;const handlers=load({fetch:async()=>{throw Error('offline')},caches:{match:async value=>{key=value;return new Response('verify page')}}});let response;handlers.fetch({request:{method:'GET',url:'http://localhost:8081/verify.html?lang=ko'},respondWith(p){response=p}});assert.equal(await(await response).text(),'verify page');assert.equal(key,'http://localhost:8081/verify.html');});
test('activation cleans only old ProofShot caches',async()=>{
 const removed=[];let current,work;
 const handlers=load({caches:{
  open:async name=>{current=name;return {addAll:async()=>{}}},
  keys:async()=>['other-app','proofshot-app-obsolete',current],
  delete:async name=>removed.push(name)
 }});
 handlers.install({waitUntil(p){work=p}});await work;
 handlers.activate({waitUntil(p){work=p}});await work;
 assert.deepEqual(removed,['proofshot-app-obsolete']);
});
