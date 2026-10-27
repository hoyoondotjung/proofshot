(function(){
'use strict';
var $=function(s){return document.querySelector(s);},t=PS.t;
var video=$('#video'),canvas=$('#canvas'),stage=$('#stage'),current=null,stream=null,session=0,sequence=0,stampPromise=null,publishing=false,checking=false;
var btnCamera=$('#btnCamera'),btnShoot=$('#btnShoot'),btnRetake=$('#btnRetake'),btnUpload=$('#btnUpload'),input=$('#fileInput'),make=$('#btnMakeLink');
function message(en,ko){$('#demoError').textContent=t(en,ko);$('#demoError').hidden=false;}
function stop(){session++;if(stream)stream.getTracks().forEach(function(track){track.stop();});stream=null;video.srcObject=null;btnShoot.disabled=true;}
window.addEventListener('pagehide',stop);
btnCamera.addEventListener('click',async function(){
  stop();var token=session;btnCamera.disabled=true;
  try{var acquired=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});if(token!==session){acquired.getTracks().forEach(function(track){track.stop();});return;}stream=acquired;video.srcObject=stream;await video.play();stage.classList.add('is-live');stage.classList.remove('is-shot');$('#stagePlaceholder').hidden=true;btnCamera.hidden=true;btnShoot.hidden=false;btnRetake.hidden=true;btnShoot.disabled=!video.videoWidth;}
  catch(error){alert(t('Camera unavailable. Check permission or load an image instead.','카메라를 사용할 수 없습니다. 권한을 확인하거나 이미지를 선택하세요.'));}finally{btnCamera.disabled=false;}
});
video.addEventListener('loadeddata',function(){if(stream)btnShoot.disabled=false;});
btnShoot.addEventListener('click',function(){if(!stream||!video.videoWidth)return;canvas.width=video.videoWidth;canvas.height=video.videoHeight;canvas.getContext('2d').drawImage(video,0,0);stop();processCanvas();});
btnRetake.addEventListener('click',function(){if(publishing||checking)return;sequence++;current=null;$('#resultCard').classList.remove('show');$('#resultEmpty').style.display='';stage.classList.remove('is-shot');btnCamera.click();});
btnUpload.addEventListener('click',function(){if(!publishing&&!checking)input.click();});
input.addEventListener('change',async function(){
  var file=input.files[0];input.value='';if(!file)return;
  if(file.size>12*1024*1024){alert(t('Choose an image up to 12 MB.','12MB 이하 이미지를 선택하세요.'));return;}
  stop();var token=++sequence,img=new Image(),url=URL.createObjectURL(file);
  img.onload=function(){URL.revokeObjectURL(url);if(token!==sequence)return;if(img.naturalWidth*img.naturalHeight>32000000){alert(t('Image is too large. Use a smaller image.','이미지 해상도가 너무 큽니다. 더 작은 이미지를 사용하세요.'));return;}canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;canvas.getContext('2d').drawImage(img,0,0);processCanvas();};
  img.onerror=function(){URL.revokeObjectURL(url);alert(t('Cannot read this image. Choose JPEG, PNG or WebP.','이미지를 읽을 수 없습니다. JPEG·PNG·WebP 파일을 선택하세요.'));};img.src=url;
});
async function processCanvas(){
  var token=++sequence;
  try{
    var fullUrl=canvas.toDataURL('image/jpeg',.92),digest=await PSOTS.sha256(PS.dataBytes(fullUrl));if(token!==sequence)return;
    var thumb=document.createElement('canvas'),scale=Math.min(1,460/canvas.width);thumb.width=Math.round(canvas.width*scale);thumb.height=Math.round(canvas.height*scale);thumb.getContext('2d').drawImage(canvas,0,0,thumb.width,thumb.height);
    var rec={fullUrl:fullUrl,original:PS.originalBlob(fullUrl),hash:PSOTS.hex(digest),iso:new Date().toISOString(),device:/Mac/.test(navigator.userAgent)?'Mac':/Android/.test(navigator.userAgent)?'Android':'Browser',ots:null};current=rec;
    var still=stage.querySelector('img.shot');if(!still){still=document.createElement('img');still.className='shot';still.alt=t('Recorded image','기록한 이미지');stage.appendChild(still);}still.src=thumb.toDataURL('image/jpeg',.65);
    stage.classList.remove('is-live');stage.classList.add('is-shot');$('#stagePlaceholder').hidden=true;btnShoot.hidden=true;btnCamera.hidden=true;btnRetake.hidden=false;
    $('#rcPhoto').src=still.src;$('#rcTime').textContent=new Date(rec.iso).toLocaleString(PS.lang==='ko'?'ko-KR':'en-US');$('#rcDevice').textContent=rec.device;$('#rcHash').textContent=rec.hash;
    $('#resultEmpty').style.display='none';$('#resultCard').classList.add('show');$('#rcLink').classList.remove('show');$('#rcLink').textContent='';$('#demoError').hidden=true;
    $('#btnCopy').hidden=true;$('#btnOpen').hidden=true;$('#btnOts').hidden=true;make.hidden=false;make.disabled=false;make.textContent=t('Upload photo & create link →','사진 업로드 후 링크 만들기 →');
    $('#rcAnchor').textContent=t('Requesting timestamp…','타임스탬프 요청 중…');$('#rcAnchor').style.color='var(--dim)';$('#btnDemoCheck').disabled=true;
    stampPromise=PSOTS.stamp(digest).then(function(result){rec.ots=result.ots;if(current!==rec)return;$('#btnOts').hidden=false;$('#rcAnchor').textContent=t('Request sent. Bitcoin timestamp is not yet confirmed.','요청을 보냈습니다. Bitcoin 타임스탬프는 아직 미확정입니다.');}).catch(function(){if(current===rec)$('#rcAnchor').textContent=t('Timestamp unavailable. Keep the original and retry.','타임스탬프 요청 실패. 원본을 보관하고 다시 시도하세요.');}).finally(function(){if(current===rec)$('#btnDemoCheck').disabled=false;});
  }catch(error){alert(t('Cannot securely hash this photo. Use a supported browser on HTTPS or localhost.','파일 지문을 안전하게 계산할 수 없습니다. HTTPS 또는 localhost에서 지원 브라우저를 사용하세요.'));}
}
make.addEventListener('click',async function(){
  var rec=current;if(!rec||publishing)return;publishing=true;make.disabled=true;btnRetake.disabled=true;btnUpload.disabled=true;make.textContent=t('Creating link…','링크 생성 중…');
  try{await stampPromise;await PS.upload(rec);if(current!==rec)return;$('#rcLink').textContent=rec.link;$('#rcLink').classList.add('show');$('#btnOpen').href=rec.link;$('#btnOpen').hidden=false;$('#btnCopy').hidden=false;make.hidden=true;$('#demoError').hidden=true;}
  catch(error){message('Upload failed. Save the original and .ots file, then retry. No verified sharing link was created.','업로드 실패. 원본과 .ots 파일을 저장한 뒤 다시 시도하세요. 검증 가능한 공유 링크를 만들지 못했습니다.');}
  finally{publishing=false;make.disabled=false;btnRetake.disabled=false;btnUpload.disabled=false;make.textContent=t('Upload photo & create link →','사진 업로드 후 링크 만들기 →');}
});
$('#btnDemoCheck').addEventListener('click',async function(){
  var rec=current;if(!rec||checking)return;checking=true;$('#btnDemoCheck').disabled=true;btnRetake.disabled=true;btnUpload.disabled=true;
  try{if(!rec.ots){rec.ots=(await PSOTS.stamp(PSOTS.unhex(rec.hash))).ots;$('#btnOts').hidden=false;}
    var result=await PSOTS.checkUpgrade(rec.ots);if(current!==rec)return;
    if(result.status==='confirmed'&&result.merkleOk===true){rec.ots=result.ots;$('#rcAnchor').textContent=t('File timestamp verified in Bitcoin block #','파일 타임스탬프 확인: Bitcoin 블록 #')+result.height;$('#rcAnchor').style.color='var(--accent)';}
    else{$('#rcAnchor').textContent=result.status==='invalid'?t('Timestamp verification failed.','타임스탬프 검증 실패.'):t('Not verified yet. Re-check later.','아직 검증되지 않았습니다. 나중에 다시 확인하세요.');$('#rcAnchor').style.color='var(--dim)';}
    if(rec.pid)await PS.attach(rec);
  }catch(error){message('Timestamp check or server update failed. Retry later.','타임스탬프 확인 또는 서버 갱신에 실패했습니다. 나중에 다시 시도하세요.');}
  finally{checking=false;$('#btnDemoCheck').disabled=false;btnRetake.disabled=publishing;btnUpload.disabled=publishing;}
});
$('#btnSaveOriginal').addEventListener('click',function(){if(current)PS.download(current.original,'proofshot-'+current.hash.slice(0,8)+'.jpg');});
$('#btnOts').addEventListener('click',function(){if(current&&current.ots)PS.download(new Blob([current.ots],{type:'application/vnd.opentimestamps.v1'}),'proofshot-'+current.hash.slice(0,8)+'.ots');});
$('#btnCopy').addEventListener('click',async function(){if(!current||!current.link)return;var copied=await PS.copy(current.link);message(copied?'Link copied.':'Copy failed. Select and copy the link below.',copied?'링크를 복사했습니다.':'복사하지 못했습니다. 아래 링크를 선택해 복사하세요.');});
})();
