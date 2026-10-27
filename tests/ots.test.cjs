const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto,createHash}=require('node:crypto');
const MAGIC=Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294','hex');
const digest=Buffer.alloc(32,7),uri='https://alice.btc.calendar.opentimestamps.org';
const vi=n=>{const a=[];do{let b=n&127;n=Math.floor(n/128);a.push(n?b|128:b);}while(n);return Buffer.from(a);};
const pending=(url=uri)=>{const u=Buffer.from(url),payload=Buffer.concat([vi(u.length),u]);return Buffer.concat([Buffer.from('0083dfe30d2ef90c8e','hex'),vi(payload.length),payload]);};
const bitcoin=(height=123)=>{const h=vi(height);return Buffer.concat([Buffer.from('000588960d73d71901','hex'),vi(h.length),h]);};
const file=tree=>new Uint8Array(Buffer.concat([MAGIC,Buffer.from([1,8]),digest,tree]));
const sha=x=>createHash('sha256').update(x).digest();
function load(fetch){const ctx={Uint8Array,TextDecoder,URL,AbortController,setTimeout,clearTimeout,atob,btoa,crypto:webcrypto,fetch};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('ots.js','utf8'),ctx);return ctx.PSOTS;}
const binary=bytes=>({ok:true,status:200,arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
function explorer(root){return async url=>url.includes('/block-height/')?{ok:true,text:async()=> 'a'.repeat(64)}:{ok:true,json:async()=>({height:123,timestamp:1700000000,merkle_root:Buffer.from(root).reverse().toString('hex')})};}
test('base64 timestamp encoding round-trips actual byte arrays',()=>{const o=load();assert.deepEqual(o.bytesB64url(o.b64urlBytes(digest)),new Uint8Array(digest));});
test('explorer outage never produces confirmed status',async()=>{const o=load(async()=>{throw Error('offline')});const r=await o.checkUpgrade(file(bitcoin()));assert.equal(r.status,'unavailable');assert.notEqual(r.merkleOk,true);});
test('a fabricated pending attestation does not establish registration',async()=>{const o=load(async()=>({ok:false,status:404}));const r=await o.checkUpgrade(file(pending()));assert.equal(r.status,'pending');});
test('unapproved pending URI is never fetched',async()=>{let requests=0;const o=load(async()=>{requests++;throw Error()});const r=await o.checkUpgrade(file(pending('http://localhost:8081/private')));assert.equal(requests,0);assert.equal(r.status,'unavailable');});
test('Bitcoin root mismatch fails verification',async()=>{const o=load(explorer(Buffer.alloc(32,1)));assert.equal((await o.checkUpgrade(file(bitcoin()))).status,'invalid');});
test('malformed/trailing proof bytes fail safely',async()=>{const o=load();assert.equal((await o.checkUpgrade(new Uint8Array([1]))).status,'invalid');assert.equal((await o.checkUpgrade(new Uint8Array([...file(bitcoin()),0]))).status,'invalid');});
test('upgrade preserves nonce path and yields a downloadable proof independent of calendars',async()=>{
 const nonce=Buffer.from([1,2,3]),prefix=Buffer.concat([Buffer.from([0xf0,3]),nonce,Buffer.from([8])]);
 const calendarMessage=sha(Buffer.concat([digest,nonce])),suffix=Buffer.from([0xf0,1,9,8]);
 const blockRoot=sha(Buffer.concat([calendarMessage,Buffer.from([9])]));
 const publicFetch=explorer(blockRoot);let calendarReads=0;
 const o=load(async url=>{if(url.includes('/timestamp/')){calendarReads++;assert.ok(url.endsWith(calendarMessage.toString('hex')));return binary(Buffer.concat([suffix,bitcoin()]));}return publicFetch(url);});
 const r=await o.checkUpgrade(file(Buffer.concat([prefix,pending()])));
 assert.equal(r.status,'confirmed');assert.equal(r.merkleOk,true);assert.ok(r.ots.length>0);
 const info=await o.info(r.ots);assert.equal(info.digest,digest.toString('hex'));assert.deepEqual(Array.from(info.bitcoin),[123]);
 const offlineCalendars=load(async url=>{assert.ok(!url.includes('/timestamp/'));return publicFetch(url);});
 assert.equal((await offlineCalendars.checkUpgrade(r.ots)).status,'confirmed');assert.equal(calendarReads,1);
});
test('stamp merges shared calendar branches into a canonical valid tree',async()=>{
 const branch=Buffer.concat([Buffer.from([0xff,0xf0,1,1,8]),pending(),Buffer.from([0xf0,1,2,8]),pending()]);
 const o=load(async()=>binary(branch));const r=await o.stamp(new Uint8Array(digest));const info=await o.info(r.ots);
 assert.equal(info.digest,digest.toString('hex'));assert.equal(info.pending.length,2);assert.equal(r.calendars.length,4);
});
