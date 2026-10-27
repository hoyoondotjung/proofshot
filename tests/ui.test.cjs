const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {webcrypto,createHash}=require('node:crypto');
const {JSDOM,VirtualConsole}=require('jsdom'),{IDBFactory}=require('fake-indexeddb');
const img=fs.readFileSync('assets/items/dior-wallet.jpg'),image='data:image/jpeg;base64,'+img.toString('base64'),hash=createHash('sha256').update(img).digest('hex');
const MAGIC=Buffer.from('004f70656e54696d657374616d7073000050726f6f6600bf89e2e884e89294','hex');
const uri=Buffer.from('https://alice.btc.calendar.opentimestamps.org');
const pending=Buffer.concat([MAGIC,Buffer.from([1,8]),Buffer.from(hash,'hex'),Buffer.from('0083dfe30d2ef90c8e','hex'),Buffer.from([uri.length+1,uri.length]),uri]);
const record={v:3,img:image,h:hash,iso:'2026-10-27T12:00:00.000Z',d:'Synthetic test',ots:pending.toString('base64url')};
const tick=()=>new Promise(setImmediate);
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}assert.ok(fn(),'Expected UI state did not arrive');}
function setup(file,url='http://localhost:8081/'+file,idb=new IDBFactory()){
 const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!e.message.includes('navigation'))errors.push(e);});
 const dom=new JSDOM(fs.readFileSync(file,'utf8'),{url,runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc}),w=dom.window;
 Object.defineProperty(w,'crypto',{value:webcrypto});w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;w.AbortController=AbortController;w.indexedDB=idb;w.Blob=Blob;
 w.scrollTo=()=>{};w.matchMedia=()=>({matches:false});w.confirm=()=>true;w.alert=()=>{};w.URL.createObjectURL=()=> 'blob:http://localhost/test';w.URL.revokeObjectURL=()=>{};
 w.FileReader=class{async readAsDataURL(blob){try{this.result='data:'+blob.type+';base64,'+Buffer.from(await blob.arrayBuffer()).toString('base64');this.onload();}catch(error){this.error=error;this.onerror();}}};
 w.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){}});w.HTMLCanvasElement.prototype.toDataURL=()=>image;
 w.HTMLMediaElement.prototype.play=async()=>{};w.navigator.mediaDevices={getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})};
 const video=w.document.querySelector('video');if(video){Object.defineProperty(video,'videoWidth',{value:640});Object.defineProperty(video,'videoHeight',{value:480});}
 w.fetch=async()=>{throw Error('offline')};
 function run(name){w.eval(fs.readFileSync(name,'utf8'));}
 run('config.js');run('ots.js');run('proof.js');
 return {dom,w,idb,errors,run,close:()=>w.close()};
}
async function stored(idb){return new Promise((resolve,reject)=>{const req=idb.open('proofshot',1);req.onsuccess=()=>{const db=req.result;const get=db.transaction('proofs').objectStore('proofs').getAll();get.onsuccess=()=>{resolve(get.result);db.close();};get.onerror=reject;};req.onerror=reject;});}
async function capture(env){env.w.document.querySelector('#btnNew').click();await until(()=>!env.w.document.querySelector('#btnShutter').disabled);env.w.document.querySelector('#btnShutter').click();await until(()=>env.w.document.querySelector('#viewDet').classList.contains('active'));await until(()=>!env.w.document.querySelector('#btnRecheckA').disabled);await tick();}
test('all persisted old completion and transient upload flags are invalidated',()=>{const e=setup('app.html');try{const r=e.w.PS.normalizeRecord({status:'confirmed',ots:[1],_uploading:true});assert.equal(r.status,'pending');assert.ok(!('_uploading' in r));}finally{e.close();}});
test('pending or unavailable timestamps never produce a verified verdict',()=>{const e=setup('verify.html');try{for(const s3 of ['warn','busy',null])assert.notEqual(e.w.PS.verdict({s1:'ok',s2:'ok',s3}),'confirmed');assert.equal(e.w.PS.verdict({s1:'ok',s2:'ok',s3:'ok'}),'confirmed');}finally{e.close();}});
test('unregistered pending proof is not presented as a capture seal',async()=>{const e=setup('verify.html','http://localhost:8081/verify.html?p=123456789abc&lang=ko');try{e.w.fetch=async url=>String(url).includes('/p/')?{ok:true,json:async()=>record}:{ok:false,status:404};e.run('verify.js');await until(()=>e.w.document.querySelector('#s3').classList.contains('warn'));await until(()=>e.w.document.querySelector('#verdictT').textContent!=='확인 중…');assert.equal(e.w.document.querySelector('#verdictT').textContent,'아직 검증되지 않음');assert.ok(!e.w.document.querySelector('#verdict').classList.contains('ok'));assert.match(e.w.document.querySelector('#s2p').textContent,/입증하지는 못합니다/);}finally{e.close();}});
test('legacy link file selection reads and verifies the original',async()=>{const legacy={...record,v:2},url='http://localhost:8081/verify.html?lang=ko#'+Buffer.from(JSON.stringify(legacy)).toString('base64url');const e=setup('verify.html',url);try{e.w.fetch=async()=>({ok:false,status:404});e.run('verify.js');await until(()=>e.w.document.querySelector('#s3').classList.contains('warn'));const input=e.w.document.querySelector('#dropInput');let read=false;Object.defineProperty(input,'files',{value:[{size:img.length,arrayBuffer:async()=>{read=true;return Uint8Array.from(img).buffer;}}]});input.dispatchEvent(new e.w.Event('change'));await until(()=>e.w.document.querySelector('#dropRes').classList.contains('ok'));assert.equal(read,true);assert.equal(e.w.document.querySelector('#s1').classList.contains('ok'),true);assert.equal(e.w.document.querySelector('#verdict').classList.contains('ok'),false);}finally{e.close();}});
test('capture survives reload with original Blob; offline publish can be retried',async()=>{
 const e=setup('app.html','http://localhost:8081/app.html?lang=ko');let saved;
 try{e.w.PSOTS.stamp=async()=>{throw Error('offline')};e.run('app.js');await capture(e);await until(()=>e.w.document.querySelector('#detAnchor').textContent.includes('연결'));saved=await stored(e.idb);assert.equal(saved.length,1);assert.ok(saved[0].original instanceof Blob);assert.equal(await saved[0].original.text(),await new Blob([img]).text());assert.ok(!('_uploading' in saved[0]));e.w.document.querySelector('#btnShare').click();await until(()=>!e.w.document.querySelector('#btnShare').disabled);assert.ok(!e.w.document.querySelector('#btnSavePhoto').hidden);}finally{e.close();}
 const reloaded=setup('app.html','http://localhost:8081/app.html?lang=ko',e.idb);
 try{reloaded.run('app.js');await until(()=>reloaded.w.document.querySelector('.pcard'));reloaded.w.document.querySelector('.pcard').click();assert.equal(reloaded.w.document.querySelector('#btnSavePhoto').hidden,false);assert.equal(reloaded.w.document.querySelector('#btnShare').disabled,false);}finally{reloaded.close();}
});
test('camera cancelled before permission settles never starts a hidden stream',async()=>{const e=setup('app.html');try{let resolve,stopped=false;e.w.navigator.mediaDevices.getUserMedia=()=>new Promise(r=>{resolve=r});e.run('app.js');e.w.document.querySelector('#btnNew').click();e.w.document.querySelector('#btnCapClose').click();resolve({getTracks:()=>[{stop(){stopped=true;}}]});await tick();assert.equal(stopped,true);assert.equal(e.w.document.querySelector('#viewCap').classList.contains('active'),false);}finally{e.close();}});
test('proof attachment encodes bytes and rejects HTTP failure',async()=>{const e=setup('app.html');try{let body;e.w.fetch=async(url,options)=>{body=JSON.parse(options.body);return {ok:false,status:503}};await assert.rejects(e.w.PS.attach({pid:'123456789abc',ots:new e.w.Uint8Array(pending)}));assert.equal(body.ots,pending.toString('base64url'));}finally{e.close();}});
test('demo publishes the exact JPEG it hashed; no thumbnail-only fallback on failure',async()=>{const e=setup('index.html','http://localhost:8081/?lang=ko');try{
 e.w.PSOTS.stamp=async()=>({ots:new e.w.Uint8Array(pending)});let posted;
 e.w.fetch=async(url,options)=>{posted=JSON.parse(options.body);return {ok:false,status:503}};
 e.run('demo.js');e.w.document.querySelector('#btnCamera').click();await until(()=>!e.w.document.querySelector('#btnShoot').disabled);e.w.document.querySelector('#btnShoot').click();await until(()=>e.w.document.querySelector('#resultCard').classList.contains('show'));e.w.document.querySelector('#btnMakeLink').click();await until(()=>!e.w.document.querySelector('#btnMakeLink').disabled);assert.equal(posted.img,image);assert.equal(posted.h,hash);assert.equal(e.w.document.querySelector('#btnOpen').hidden,true);assert.match(e.w.document.querySelector('#demoError').textContent,/업로드 실패/);
 }finally{e.close();}});
test('app persists upgraded timestamp bytes for future downloads',async()=>{const e=setup('app.html');try{
 e.w.PSOTS.stamp=async()=>({ots:new e.w.Uint8Array(pending)});e.run('app.js');await capture(e);await until(()=>!e.w.document.querySelector('#btnSaveOts').disabled&&!e.w.document.querySelector('#btnRecheckA').disabled);
 const upgraded=new e.w.Uint8Array([...pending,1,2,3]);e.w.PSOTS.checkUpgrade=async()=>({status:'confirmed',merkleOk:true,height:123,blockTime:1700000000000,explorer:'https://blockstream.info/block/'+'a'.repeat(64),ots:upgraded});
 e.w.document.querySelector('#btnRecheckA').click();await until(()=>e.w.document.querySelector('#detAnchor').textContent.includes('#123'));
 const [rec]=await stored(e.idb);assert.deepEqual(Array.from(rec.ots),Array.from(upgraded));assert.equal(rec.verificationVersion,2);assert.equal(rec.status,'confirmed');
 }finally{e.close();}});
test('explicit language persists and verification navigation preserves it',()=>{const e=setup('verify.html','http://localhost:8081/verify.html?lang=ko');try{assert.equal(e.w.localStorage.getItem('psLanguage'),'ko');assert.match(e.w.document.querySelector('#ctaMake').href,/index\.html\?lang=ko#demo$/);assert.equal(e.w.document.documentElement.lang,'ko');}finally{e.close();}});
test('verification file chooser is a keyboard reachable native button',()=>{const e=setup('verify.html');try{const button=e.w.document.querySelector('#btnChooseFile');assert.equal(button.tagName,'BUTTON');assert.equal(button.disabled,false);assert.equal(button.tabIndex,0);}finally{e.close();}});
test('storage failure retains original download and allows a later save retry',async()=>{const e=setup('app.html');try{
 const real=e.idb;e.w.indexedDB={open(){throw new Error('Storage temporarily blocked')}};
 e.w.PSOTS.stamp=async()=>{throw Error('offline')};e.run('app.js');await capture(e);
 assert.equal(e.w.document.querySelector('#btnSavePhoto').hidden,false);assert.equal(e.w.document.querySelector('#btnRetrySave').hidden,false);
 e.w.indexedDB=real;e.w.document.querySelector('#btnRetrySave').click();await until(()=>e.w.document.querySelector('#btnRetrySave').hidden);
 const [saved]=await stored(real);assert.ok(saved.original instanceof Blob);
 }finally{e.close();}});
