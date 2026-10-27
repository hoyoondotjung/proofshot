(function(){
'use strict';
var $=function(s){return document.querySelector(s);},t=PS.t;
var REC=null,otsBytes=null,checking=false,fileSequence=0;
var state={s1:null,s2:null,s3:null};
var loading=$('#loadingCard'),verified=$('#verifiedCard'),error=$('#errorCard');
var btnRecheck=$('#btnRecheck'),btnOtsDl=$('#btnOtsDl'),btnExplorer=$('#btnExplorer');
var text={
brandSub:t('File verification','파일 검증'),navAbout:t('About ProofShot','ProofShot 소개'),loadingT:t('Loading record…','기록 불러오는 중…'),
mCaptured:t('Reported time (unverified)','보고된 시각 (미인증)'),s1t:t('Does the file match the fingerprint?','파일과 지문이 일치하나요?'),s2t:t('Does the timestamp reference this fingerprint?','타임스탬프가 이 지문을 참조하나요?'),s3t:t('Is the timestamp verified against Bitcoin?','Bitcoin 기록과 대조됐나요?'),
btnRecheck:t('Re-check','다시 확인'),btnExplorer:t('View Bitcoin block →','Bitcoin 블록 보기 →'),dropT:t('Check an original photo file','사진 원본 파일 확인'),dropP:t('Choose or drop the exact original. Messaging apps may recompress photos and change their file fingerprint.','원본 파일을 선택하거나 끌어다 놓으세요. 메신저가 사진을 압축하면 파일 지문이 바뀔 수 있습니다.'),
exSum:t('File and timestamp details','파일·타임스탬프 상세'),exK1:t('File fingerprint · SHA-256','파일 지문 · SHA-256'),exK2:t('Reported time (unverified)','보고된 시각 (미인증)'),btnOtsDl:t('Download .ots proof','.ots 증명 다운로드'),
exNote:t('Your browser checks the file hash, timestamp structure and Bitcoin merkle root using public explorers. A confirmed .ots download includes the upgraded proof. Explorer results are third-party data; use your own Bitcoin node for independent chain validation.','브라우저가 파일 지문·증명 구조·Bitcoin 머클루트를 공개 탐색기로 확인합니다. 확정 후 다운로드하는 .ots에는 갱신된 증명이 포함됩니다. 탐색기 응답은 외부 데이터이며 독립적인 체인 검증에는 직접 운영하는 Bitcoin 노드가 필요합니다.'),
proofLimits:t('This verifies a file fingerprint and, when confirmed, a timestamp. It does not authenticate the physical item, ownership, camera source or reported capture time.','파일 지문과 확정된 타임스탬프를 검증합니다. 실물 진위·소유권·카메라 출처·보고된 촬영 시각을 보증하지 않습니다.'),
ctaMake:t('Try the web demo →','웹 데모 체험하기 →'),errT:t('Cannot open this record','기록을 열 수 없습니다'),errMsg:t('Open the complete verification link shared with you.','공유받은 검증 링크 전체로 접속하세요.'),errCta:t('Open ProofShot →','ProofShot 열기 →')};
Object.keys(text).forEach(function(id){$('#'+id).textContent=text[id];});$('#vYear').textContent=new Date().getFullYear();
document.title=t('File verification | ProofShot','파일 검증 | ProofShot');$('#vPhoto').alt=t('Shared photo','공유된 사진');
window.addEventListener('hashchange',function(){location.reload();});
function setStep(id,status,message){state[id]=status;$('#'+id).className='step '+status;$('#'+id+'ic').textContent=status==='ok'?'✓':status==='bad'?'×':status==='busy'?'…':'!';$('#'+id+'p').textContent=message;paintVerdict();}
function paintVerdict(){
  var kind=PS.verdict(state),title,detail,cls='warn',icon='!';
  if(kind==='checking'){title=t('Checking…','확인 중…');detail=t('Comparing the file, proof and public record.','파일·증명·공개 기록을 대조하고 있습니다.');cls='';icon='…';}
  else if(kind==='invalid'){title=t('Verification failed','검증 실패');detail=t('A file or timestamp check failed. Do not treat this record as verified.','파일 또는 타임스탬프 검증에 실패했습니다. 검증 완료 기록으로 취급하지 마세요.');cls='bad';icon='×';}
  else if(kind==='confirmed'){title=t('File timestamp verified','파일 타임스탬프 확인 완료');detail=t('The file matches a fingerprint verified against a Bitcoin block. This does not authenticate the item.','파일 지문이 Bitcoin 블록 기록과 일치합니다. 실물 진위를 인증하는 것은 아닙니다.');cls='ok';icon='✓';}
  else if(kind==='preview'){title=t('Timestamp verified · photo unchecked','타임스탬프 확인 · 사진 미확인');detail=t('This link contains only a preview. Check the original file below to connect it to the timestamp.','이 링크에는 미리보기만 있습니다. 아래에서 원본 파일을 검사해야 타임스탬프와 연결할 수 있습니다.');}
  else{title=t('Not verified yet','아직 검증되지 않음');detail=t('A matching hash or pending timestamp is not a confirmed public record. Retry later.','해시 일치나 미확정 증명은 공개 기록 확인 완료가 아닙니다. 나중에 다시 확인하세요.');}
  $('#verdict').className='verdict '+cls;$('#verdictIc').textContent=icon;$('#verdictT').textContent=title;$('#verdictS').textContent=detail;
}
function fail(message){loading.hidden=true;verified.hidden=true;error.hidden=false;if(message)$('#errMsg').textContent=message;}
async function start(rec){
  try{PS.validRecord(rec);}catch(e){fail(t('The link contains invalid or incomplete record data.','링크의 기록 정보가 올바르지 않거나 불완전합니다.'));return;}
  REC=rec;loading.hidden=true;verified.hidden=false;
  if(rec.img)$('#vPhoto').src=rec.img;else $('#vPhoto').parentNode.hidden=true;
  $('#vTime').textContent=rec.iso?new Date(rec.iso).toLocaleString(PS.lang==='ko'?'ko-KR':'en-US'):'-';
  $('#vDevice').textContent=(typeof rec.d==='string'?rec.d.slice(0,100):'-')+t(' (unverified)',' (미인증)');
  $('#vHash').textContent=rec.h.match(/.{1,8}/g).join(' ');$('#vIso').textContent=rec.iso||'-';
  if(rec.mode==='store'&&rec.img){
    setStep('s1','busy',t('Computing the photo fingerprint…','사진 지문 계산 중…'));
    PSOTS.sha256(PS.dataBytes(rec.img)).then(function(digest){setStep('s1',PSOTS.hex(digest)===rec.h.toLowerCase()?'ok':'bad',PSOTS.hex(digest)===rec.h.toLowerCase()?t('The displayed image file matches the recorded fingerprint.','화면 이미지 파일과 기록된 지문이 일치합니다.'):t('The displayed file does not match the recorded fingerprint.','화면 파일과 기록된 지문이 일치하지 않습니다.'));}).catch(function(){setStep('s1','warn',t('Could not hash the photo. Try the original file below.','사진 지문을 계산하지 못했습니다. 아래에서 원본 파일을 확인하세요.'));});
  }else{setStep('s1','warn',t('Preview only. Select the original file below to check its fingerprint.','미리보기 전용입니다. 아래에서 원본 파일을 선택해 지문을 확인하세요.'));document.querySelector('details.expert').open=true;}
  if(!rec.ots){setStep('s2','warn',t('No timestamp is attached.','첨부된 타임스탬프가 없습니다.'));setStep('s3','warn',t('A timestamp is required before a public record can be checked.','공개 기록을 확인하려면 타임스탬프가 필요합니다.'));btnRecheck.hidden=false;return;}
  setStep('s2','busy',t('Reading timestamp…','타임스탬프 읽는 중…'));
  try{
    otsBytes=PSOTS.bytesB64url(rec.ots);var info=await PSOTS.info(otsBytes);
    if(info.digest!==rec.h.toLowerCase())throw new Error('Fingerprint mismatch');
    setStep('s2','ok',t('The timestamp references this file fingerprint. This alone does not prove when or how the photo was taken.','타임스탬프가 이 파일 지문을 참조합니다. 이것만으로 촬영 시각이나 촬영 방식을 입증하지는 못합니다.'));btnOtsDl.hidden=false;await checkAnchor();
  }catch(e){otsBytes=null;setStep('s2','bad',t('The timestamp is invalid or references another file.','증명이 올바르지 않거나 다른 파일을 참조합니다.'));setStep('s3','warn',t('Public-record verification cannot proceed.','공개 기록 대조를 진행할 수 없습니다.'));}
}
async function checkAnchor(){
  if(!otsBytes||checking)return;checking=true;btnRecheck.hidden=false;btnRecheck.disabled=true;btnExplorer.hidden=true;
  setStep('s3','busy',t('Checking the Bitcoin record…','Bitcoin 기록 확인 중…'));
  try{
    var result=await PSOTS.checkUpgrade(otsBytes);
    if(result.status==='confirmed'&&result.merkleOk===true){
      otsBytes=result.ots||otsBytes;setStep('s3','ok',t('Fingerprint verified against Bitcoin block #','Bitcoin 블록에서 지문 확인: #')+result.height+t('. Block time: ','. 블록 시각: ')+new Date(result.blockTime).toLocaleString(PS.lang==='ko'?'ko-KR':'en-US'));if(result.explorer){btnExplorer.href=result.explorer;btnExplorer.hidden=false;}
    }else if(result.status==='invalid'){setStep('s3','bad',t('The timestamp could not be validated against Bitcoin.','타임스탬프가 Bitcoin 기록과 일치하지 않거나 올바르지 않습니다.'));}
    else{setStep('s3','warn',result.status==='pending'?t('No confirmed Bitcoin record found. Retry later; a pending proof does not establish registration or capture time.','확정된 Bitcoin 기록을 찾지 못했습니다. 미확정 증명은 접수 여부나 촬영 시각을 입증하지 않습니다. 나중에 재시도하세요.'):t('Verification servers are unavailable or this calendar is unsupported. This is not a confirmed result.','검증 서버에 연결할 수 없거나 지원하지 않는 캘린더입니다. 검증 완료 상태가 아닙니다.'));}
  }catch(e){setStep('s3','warn',t('Could not complete the check. Retry later.','확인을 마치지 못했습니다. 나중에 다시 시도하세요.'));}
  finally{checking=false;btnRecheck.disabled=false;}
}
btnRecheck.addEventListener('click',function(){if(otsBytes)checkAnchor();else location.reload();});
var drop=$('#drop'),input=$('#dropInput'),result=$('#dropRes');
$('#btnChooseFile').addEventListener('click',function(){input.click();});
['dragover','dragenter'].forEach(function(event){drop.addEventListener(event,function(e){e.preventDefault();drop.classList.add('over');});});
['dragleave','drop'].forEach(function(event){drop.addEventListener(event,function(e){e.preventDefault();drop.classList.remove('over');});});
drop.addEventListener('drop',function(e){if(e.dataTransfer.files[0])checkFile(e.dataTransfer.files[0]);});
input.addEventListener('change',function(){if(input.files[0])checkFile(input.files[0]);input.value='';});
async function checkFile(file){
  if(!REC)return;var sequence=++fileSequence;result.hidden=false;result.className='res';result.textContent=t('Checking file…','파일 확인 중…');
  try{
    if(file.size>12*1024*1024)throw new Error('File too large');
    var digest=PSOTS.hex(await PSOTS.sha256(new Uint8Array(await file.arrayBuffer())));if(sequence!==fileSequence)return;
    var matched=digest===REC.h.toLowerCase();result.className='res '+(matched?'ok':'bad');
    result.textContent=matched?t('The selected file matches the recorded fingerprint.','선택한 파일과 기록된 지문이 일치합니다.'):t('This file differs. Ask for the exact original, sent as a file without recompression.','파일이 다릅니다. 재압축되지 않은 원본을 파일로 전달받으세요.');
    if(REC.mode==='legacy'){
      setStep('s1',matched?'ok':'bad',result.textContent);
      if(matched){var url=URL.createObjectURL(file);$('#vPhoto').src=url;$('#vPhoto').parentNode.hidden=false;$('#vPhoto').onload=function(){URL.revokeObjectURL(url);};}
    }
  }catch(e){if(sequence===fileSequence){result.className='res bad';result.textContent=t('Cannot read this file. Choose an image up to 12 MB.','파일을 읽을 수 없습니다. 12MB 이하 이미지 파일을 선택하세요.');}}
}
btnOtsDl.addEventListener('click',function(){if(otsBytes)PS.download(new Blob([otsBytes],{type:'application/vnd.opentimestamps.v1'}),'proofshot-'+REC.h.slice(0,8)+'.ots');});
(async function load(){
  try{
    var query=new URLSearchParams(location.search),pid=query.get('p')||((location.hash||'').match(/^#p=([a-zA-Z0-9_-]{12,80})$/)||[])[1];
    if(pid){PS.shortLink(pid);var rec=await PS.request('/p/'+encodeURIComponent(pid));rec.mode='store';await start(rec);}
    else if(location.hash){var raw=location.hash.slice(1);if(raw.length>1500000)throw new Error('Link too large');var bytes=PSOTS.bytesB64url(raw),legacy=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));legacy.mode='legacy';await start(legacy);}
    else fail();
  }catch(e){fail(t('The record is unavailable or the link is invalid. Check your connection and open the complete link again.','기록을 불러올 수 없거나 링크가 올바르지 않습니다. 연결을 확인하고 전체 링크로 다시 접속하세요.'));}
})();
})();
