(function () {
'use strict';
var $=function(s){return document.querySelector(s);},t=PS.t;
document.title=t('ProofShot | Photo records','ProofShot | 사진 기록');
var current=null,records=new Map(),uploads=new Map(),stamps=new Map(),checks=new Map(),saveErrors=new Set();
var database=null,stream=null,cameraSession=0,captureBusy=false;
var video=$('#capVideo'),canvas=$('#capCanvas');
function toast(message){var el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(function(){el.classList.remove('show');},4500);}
function showView(id){document.querySelectorAll('.view').forEach(function(el){el.classList.toggle('active',el.id===id);});window.scrollTo(0,0);var heading=$('#'+id+' h1')||$('#'+id+' .brand');if(heading){heading.tabIndex=-1;heading.focus();}}
function idb(){
  if(!database)database=new Promise(function(resolve,reject){
    var req=indexedDB.open('proofshot',1);
    req.onupgradeneeded=function(){req.result.createObjectStore('proofs',{keyPath:'id'});};
    req.onsuccess=function(){var db=req.result;db.onversionchange=function(){db.close();database=null;};resolve(db);};
    req.onerror=function(){database=null;reject(req.error);};req.onblocked=function(){database=null;reject(new Error('Database blocked'));};
  }).catch(function(error){database=null;throw error;});
  return database;
}
async function dbPut(rec){
  var db=await idb(),copy=PS.normalizeRecord(rec);
  try {await new Promise(function(resolve,reject){var tx=db.transaction('proofs','readwrite');tx.objectStore('proofs').put(copy);tx.oncomplete=resolve;tx.onerror=tx.onabort=function(){reject(tx.error||new Error('Storage failed'));};});saveErrors.delete(rec.id);}
  catch(error){saveErrors.add(rec.id);throw error;}
}
async function persist(rec){
  try{await dbPut(rec);return true;}catch(error){toast(t('Could not save. Download the original now, or retry saving.','저장하지 못했습니다. 원본을 다운로드하거나 저장을 다시 시도하세요.'));return false;}
  finally{if(current===rec)paintStorage(rec);}
}
async function dbAll(){var db=await idb();return new Promise(function(resolve,reject){var req=db.transaction('proofs').objectStore('proofs').getAll();req.onsuccess=function(){resolve(req.result.map(PS.normalizeRecord));};req.onerror=function(){reject(req.error);};});}
async function dbDel(id){var db=await idb();return new Promise(function(resolve,reject){var tx=db.transaction('proofs','readwrite');tx.objectStore('proofs').delete(id);tx.oncomplete=resolve;tx.onerror=tx.onabort=function(){reject(tx.error);};});}
function fmtTime(iso){return new Date(iso).toLocaleString(PS.lang==='ko'?'ko-KR':'en-US');}
function renderHome(){
  var list=$('#plist');list.replaceChildren();
  var all=Array.from(records.values()).sort(function(a,b){return b.iso.localeCompare(a.iso);});$('#emptyState').hidden=all.length>0;
  all.forEach(function(rec){
    var button=document.createElement('button');button.className='pcard';
    var img=document.createElement('img');img.src=rec.thumb;img.alt='';
    var body=document.createElement('span'),date=document.createElement('span'),hash=document.createElement('span'),chip=document.createElement('span');
    date.className='t';date.textContent=fmtTime(rec.iso);hash.className='h mono';hash.textContent=rec.hash.slice(0,12)+'…';body.append(date,hash);
    chip.className='chip '+(rec.status==='confirmed'?'ok':rec.ots?'wait':'none');
    chip.textContent=rec.status==='confirmed'?t('TIMESTAMP VERIFIED','타임스탬프 확인'):rec.ots?t('UNCONFIRMED','미확정'):t('LOCAL RECORD','기기 저장');
    button.append(img,body,chip);button.addEventListener('click',function(){openDetail(rec);});list.appendChild(button);
  });
}
async function loadHome(){
  try{(await dbAll()).forEach(function(rec){if(!records.has(rec.id))records.set(rec.id,rec);});$('#homeError').hidden=true;$('#btnLoadRetry').hidden=true;renderHome();}
  catch(error){$('#homeError').textContent=t('Saved records could not be loaded. Check browser storage access and retry.','저장 기록을 불러오지 못했습니다. 브라우저 저장소 접근을 확인하고 다시 시도하세요.');$('#homeError').hidden=false;$('#btnLoadRetry').hidden=false;}
}
$('#btnLoadRetry').addEventListener('click',loadHome);
function stopStream(){if(stream)stream.getTracks().forEach(function(track){track.stop();});stream=null;video.srcObject=null;$('#btnShutter').disabled=true;}
function closeCamera(){cameraSession++;stopStream();$('#viewCap').classList.remove('active');document.querySelector('.view.active').inert=false;$('#btnNew').focus();}
function cameraError(message){$('#capErrMsg').textContent=message;$('#capErr').hidden=false;}
async function openCamera(){
  stopStream();var session=++cameraSession;$('#capErr').hidden=true;$('#viewCap').classList.add('active');document.querySelector('.view.active').inert=true;$('#btnCapClose').focus();
  try{
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw new Error('Unsupported');
    var acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1920}},audio:false});
    if(session!==cameraSession){acquired.getTracks().forEach(function(track){track.stop();});return;}
    stream=acquired;video.srcObject=acquired;await video.play();
    if(session===cameraSession&&video.videoWidth&&video.videoHeight)$('#btnShutter').disabled=false;
  }catch(error){if(session!==cameraSession)return;stopStream();cameraError(error.name==='NotAllowedError'?t('Camera permission is required. Allow it in the browser, then retry.','카메라 권한이 필요합니다. 브라우저에서 허용한 뒤 다시 시도하세요.'):t('Camera unavailable. Check that a camera is connected and not in use.','카메라를 사용할 수 없습니다. 연결 상태와 다른 앱 사용 여부를 확인하세요.'));}
}
video.addEventListener('loadeddata',function(){if(stream&&video.videoWidth)$('#btnShutter').disabled=false;});
$('#btnNew').addEventListener('click',openCamera);$('#btnCapRetry').addEventListener('click',openCamera);
$('#btnCapClose').addEventListener('click',closeCamera);$('#btnCapErrClose').addEventListener('click',closeCamera);
document.addEventListener('keydown',function(e){if(!$('#viewCap').classList.contains('active'))return;if(e.key==='Escape')closeCamera();if(e.key==='Tab'){var controls=Array.from($('#viewCap').querySelectorAll('button')).filter(function(el){return !el.disabled&&el.getClientRects().length;});var first=controls[0],last=controls[controls.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}});
window.addEventListener('pagehide',stopStream);
function thumb(){var c=document.createElement('canvas'),ratio=Math.min(1,340/canvas.width);c.width=Math.round(canvas.width*ratio);c.height=Math.round(canvas.height*ratio);c.getContext('2d').drawImage(canvas,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.65);}
function device(){return /Android/.test(navigator.userAgent)?'Android':/iPhone|iPad/.test(navigator.userAgent)?'iOS':/Mac/.test(navigator.userAgent)?'Mac':/Windows/.test(navigator.userAgent)?'Windows':'Browser';}
$('#btnShutter').addEventListener('click',async function(){
  if(!stream||!video.videoWidth||captureBusy)return;captureBusy=true;$('#btnShutter').disabled=true;
  try{
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);var full=canvas.toDataURL('image/jpeg',.92),preview=thumb();closeCamera();
    var digest=await PSOTS.sha256(PS.dataBytes(full)),now=new Date();
    var rec={id:PSOTS.hex(digest).slice(0,12)+'-'+now.getTime(),iso:now.toISOString(),device:device(),hash:PSOTS.hex(digest),thumb:preview,original:PS.originalBlob(full),ots:null,status:'none',verificationVersion:2};
    records.set(rec.id,rec);saveErrors.add(rec.id);openDetail(rec);if(await persist(rec))stamp(rec);renderHome();
  }catch(error){toast(t('Could not create the record. Please retry.','기록을 만들지 못했습니다. 다시 시도하세요.'));}finally{captureBusy=false;}
});
function paintStorage(rec){
  $('#btnSavePhoto').hidden=!rec.original;$('#btnRetrySave').hidden=!saveErrors.has(rec.id);
  $('#storageNotice').textContent=saveErrors.has(rec.id)?t('Storage failed. Keep this page open and save the original.','기기 저장 실패. 이 페이지를 유지하고 원본을 다운로드하세요.'):rec.original?t('Original saved in this browser. Download a backup before clearing browser data.','원본은 이 브라우저에 저장됩니다. 브라우저 데이터를 지우기 전에 백업을 다운로드하세요.'):t('This older record has no local original. Recovery is possible only if a server copy is available.','이전 기록에는 기기 원본이 없습니다. 서버 사본이 있는 경우에만 복구할 수 있습니다.');
}
function paintShare(rec){
  if(current!==rec)return;var busy=uploads.has(rec.id),hasLink=!!rec.pid;
  $('#btnShare').disabled=busy||(!hasLink&&!rec.original);$('#btnCopyLink').disabled=busy||!hasLink;
  $('#btnShare').textContent=busy?t('Creating link…','링크 생성 중…'):hasLink?t('Share verify link','검증 링크 공유'):t('Upload photo & create link','사진 업로드 후 링크 만들기');
  $('#btnCopyLink').textContent=t('Copy link','링크 복사');
  $('#linkBox').classList.toggle('show',hasLink);$('#linkBox').textContent=hasLink?rec.link:'';
  $('#shareStatus').textContent=busy?t('Uploading the original. Keep this page open.','원본을 업로드하고 있습니다. 페이지를 유지하세요.'):hasLink?(rec.syncError?t('Link ready, but the timestamp update failed. Re-check to retry.','링크는 준비됐지만 증명 갱신에 실패했습니다. 다시 확인을 눌러 재시도하세요.'):t('Anyone with this link can view the original photo.','링크를 가진 사람은 원본 사진을 볼 수 있습니다.')):t('Creating a link uploads the original photo and reported metadata. If unavailable, keep the original and .ots file and retry later.','링크 생성 시 원본 사진과 보고된 정보가 업로드됩니다. 실패하면 원본과 .ots 파일을 보관하고 나중에 재시도하세요.');
}
function paintAnchor(rec){
  if(current!==rec)return;
  var busy=stamps.has(rec.id)||checks.has(rec.id),confirmed=rec.status==='confirmed'&&rec.verificationVersion===2;
  $('#btnDelete').disabled=busy||uploads.has(rec.id)||saveErrors.has(rec.id)||captureBusy;$('#btnRecheckA').disabled=busy;$('#btnSaveOts').disabled=!rec.ots;$('#btnBlock').hidden=!confirmed||!rec.explorer;
  $('#detAnchorD').hidden=!confirmed;
  $('#sealIcon').textContent=confirmed?'✓':busy?'…':'!';
  $('#detAnchor').style.color=confirmed?'var(--ok)':'var(--warn)';
  $('#detAnchor').textContent=busy?t('Checking timestamp…','타임스탬프 확인 중…'):confirmed?t('Bitcoin timestamp verified: #','Bitcoin 타임스탬프 확인: #')+rec.height:rec.status==='invalid'?t('Timestamp verification failed','타임스탬프 검증 실패'):rec.status==='unavailable'?t('Cannot reach verification servers','검증 서버에 연결할 수 없음'):rec.ots?t('Timestamp not yet confirmed','타임스탬프 미확정'):t('No timestamp attached','첨부된 타임스탬프 없음');
  $('#sealText').textContent=confirmed?t('The file fingerprint matches a Bitcoin record. Item authenticity and capture time are not verified.','파일 지문이 Bitcoin 기록과 일치합니다. 실물 진위와 실제 촬영 시각은 검증되지 않았습니다.'):t('File record only. A pending or unavailable timestamp is not a verified proof.','파일 기록입니다. 미확정 상태나 조회 실패는 검증 완료가 아닙니다.');
  if(confirmed){$('#detAnchorD').textContent=t('Block time: ','블록 시각: ')+fmtTime(rec.blockTime);$('#btnBlock').href=rec.explorer;}
}
async function sync(rec){if(!rec.pid||!rec.ots)return;try{await PS.attach(rec);rec.syncError=false;}catch(error){rec.syncError=true;}await persist(rec);paintShare(rec);}
function stamp(rec){
  if(stamps.has(rec.id))return stamps.get(rec.id);
  var job=Promise.resolve().then(async function(){try{var result=await PSOTS.stamp(PSOTS.unhex(rec.hash));rec.ots=result.ots;rec.status='pending';await persist(rec);await sync(rec);}catch(error){rec.status='unavailable';await persist(rec);}finally{stamps.delete(rec.id);paintAnchor(rec);renderHome();}});
  stamps.set(rec.id,job);paintAnchor(rec);return job;
}
async function recoverOriginal(rec){
  if(rec.original||!rec.pid)return;
  try{var remote=await PS.request('/p/'+encodeURIComponent(rec.pid));PS.validRecord(remote);var bytes=PS.dataBytes(remote.img);if(PSOTS.hex(await PSOTS.sha256(bytes))!==rec.hash)throw new Error('Hash mismatch');if(records.get(rec.id)!==rec)return;rec.original=PS.originalBlob(remote.img);await persist(rec);if(current===rec){paintStorage(rec);paintShare(rec);}}catch(error){/* Existing records remain readable; do not replace the original with a thumbnail. */}
}
function openDetail(rec){current=rec;$('#detPhoto').src=rec.thumb;$('#detTime').textContent=fmtTime(rec.iso);$('#detDevice').textContent=rec.device;$('#detHash').textContent=rec.hash.match(/.{1,8}/g).join(' ');paintStorage(rec);paintShare(rec);paintAnchor(rec);showView('viewDet');recoverOriginal(rec);}
$('#btnBack').addEventListener('click',function(){current=null;renderHome();showView('viewHome');});
$('#btnRetrySave').addEventListener('click',async function(){if(!current)return;var rec=current;if(await persist(rec)){toast(t('Saved on this device.','이 기기에 저장했습니다.'));paintAnchor(rec);if(!rec.ots)stamp(rec);}});
async function recheck(rec){
  if(!rec)return;if(!rec.ots)return stamp(rec);if(checks.has(rec.id))return checks.get(rec.id);
  var job=Promise.resolve().then(async function(){try{var result=await PSOTS.checkUpgrade(rec.ots);rec.status=result.status==='confirmed'&&result.merkleOk===true?'confirmed':result.status==='invalid'?'invalid':result.status==='pending'?'pending':'unavailable';if(rec.status==='confirmed'){rec.height=result.height;rec.blockTime=result.blockTime;rec.explorer=result.explorer;rec.verificationVersion=2;rec.ots=result.ots;}await persist(rec);await sync(rec);}catch(error){rec.status='unavailable';await persist(rec);}finally{checks.delete(rec.id);paintAnchor(rec);renderHome();}});
  checks.set(rec.id,job);paintAnchor(rec);return job;
}
$('#btnRecheckA').addEventListener('click',function(){recheck(current);});
async function publish(rec){
  if(uploads.has(rec.id))return uploads.get(rec.id);
  var job=Promise.resolve().then(async function(){
    try{if(stamps.has(rec.id))await stamps.get(rec.id);await PS.upload(rec);await persist(rec);await sync(rec);toast(t('Link ready. You can now share or copy it.','링크가 준비됐습니다. 공유하거나 복사하세요.'));}
    catch(error){toast(t('Upload failed. The original stays on this device. Retry creating the link.','업로드에 실패했습니다. 원본은 기기에 남아 있습니다. 링크 생성을 다시 시도하세요.'));}
    finally{uploads.delete(rec.id);paintShare(rec);}
  });uploads.set(rec.id,job);paintShare(rec);return job;
}
$('#btnShare').addEventListener('click',async function(){
  if(!current)return;var rec=current;if(!rec.pid){await publish(rec);return;}
  try{if(navigator.share){await navigator.share({url:rec.link});return;}}catch(error){if(error.name==='AbortError')return;}
  toast(await PS.copy(rec.link)?t('Link copied.','링크를 복사했습니다.'):t('Copy failed. Select the link below and copy it.','복사하지 못했습니다. 아래 링크를 선택해 복사하세요.'));
});
$('#btnCopyLink').addEventListener('click',async function(){if(current&&current.pid)toast(await PS.copy(current.link)?t('Link copied.','링크를 복사했습니다.'):t('Copy failed. Select the link below.','복사하지 못했습니다. 아래 링크를 선택하세요.'));});
$('#btnSavePhoto').addEventListener('click',function(){if(current&&current.original)PS.download(current.original,'proofshot-'+current.hash.slice(0,8)+'.jpg');});
$('#btnSaveOts').addEventListener('click',function(){if(current&&current.ots)PS.download(new Blob([current.ots],{type:'application/vnd.opentimestamps.v1'}),'proofshot-'+current.hash.slice(0,8)+'.ots');});
$('#btnDelete').addEventListener('click',async function(){
  var rec=current;if(!rec)return;
  if(captureBusy||saveErrors.has(rec.id)||uploads.has(rec.id)||stamps.has(rec.id)||checks.has(rec.id)){toast(t('Wait for the current operation to finish before deleting.','진행 중인 작업이 끝난 뒤 삭제하세요.'));return;}
  if(!confirm(t('Delete this device’s record and original? Download a backup first. Server copies and shared links will remain.','이 기기의 기록과 원본을 삭제할까요? 먼저 백업하세요. 서버 사본과 공유 링크는 유지됩니다.')))return;
  try{await dbDel(rec.id);records.delete(rec.id);current=null;renderHome();showView('viewHome');}catch(error){toast(t('Delete failed. Please retry.','삭제하지 못했습니다. 다시 시도하세요.'));}
});
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(function(){});
var install=null;window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();install=e;$('#btnInstall').hidden=false;});
$('#btnInstall').addEventListener('click',async function(){if(!install)return;await install.prompt();await install.userChoice;install=null;$('#btnInstall').hidden=true;});
var ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1),standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
try{if(ios&&!standalone&&localStorage.getItem('psIosHintDone')!=='1')$('#iosHint').hidden=false;}catch(_){}
$('#iosHintClose').addEventListener('click',function(){try{localStorage.setItem('psIosHintDone','1');}catch(_){}$('#iosHint').hidden=true;});
loadHome();
})();
