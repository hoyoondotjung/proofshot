/* Shared file-record, proof-store and language helpers. No capture authenticity claim. */
(function (global) {
  'use strict';
  var savedLang;
  try { savedLang = localStorage.getItem('psLanguage'); } catch (_) {}
  var requested = new URLSearchParams(location.search).get('lang');
  var lang = /^(en|ko)$/.test(requested || '') ? requested : /^(en|ko)$/.test(savedLang || '') ? savedLang : /^ko/i.test(navigator.language || '') ? 'ko' : 'en';
  document.documentElement.lang = lang;
  if(requested===lang){try{localStorage.setItem('psLanguage',lang);}catch(_){}}
  function t(en, ko) { return lang === 'ko' ? ko : en; }
  function localize() {
    document.querySelectorAll('[data-ko]').forEach(function (el) {
      if (lang === 'ko') el.innerHTML = el.dataset.ko;
    });
    document.querySelectorAll('[data-ko-label]').forEach(function (el) {
      if (lang === 'ko') el.setAttribute('aria-label', el.dataset.koLabel);
    });
    document.querySelectorAll('a[href]').forEach(function(link){
      var href=link.getAttribute('href');
      if(!href||href[0]==='#')return;
      try{var url=new URL(href,location.href);if(url.origin===location.origin&&/\.html$/.test(url.pathname)){url.searchParams.set('lang',lang);link.href=url.href;}}catch(_){}
    });
    document.querySelectorAll('[data-language]').forEach(function (button) {
      button.textContent = lang === 'ko' ? 'English' : '한국어';
      button.setAttribute('aria-label', t('Switch to Korean', '영어로 변경'));
      button.addEventListener('click', function () {
        var next = lang === 'ko' ? 'en' : 'ko';
        try { localStorage.setItem('psLanguage', next); } catch (_) {}
        var url = new URL(location.href); url.searchParams.set('lang', next); location.href = url.href;
      });
    });
  }
  function dataBytes(url) {
    if (typeof url !== 'string' || url.length > 16 * 1024 * 1024 + 128 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) throw new Error('Invalid image data');
    var bin = atob(url.split(',')[1]);
    return Uint8Array.from(bin, function (ch) { return ch.charCodeAt(0); });
  }
  function blobData(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader(); reader.onload = function () { resolve(reader.result); }; reader.onerror = function () { reject(reader.error); }; reader.readAsDataURL(blob);
    });
  }
  function originalBlob(url) { return new Blob([dataBytes(url)], {type: url.slice(5, url.indexOf(';'))}); }
  function validRecord(rec) {
    if (!rec || !/^[a-f0-9]{64}$/i.test(rec.h || '')) throw new Error('Invalid file fingerprint');
    if (rec.img) dataBytes(rec.img);
    if (rec.ots && (typeof rec.ots !== 'string' || rec.ots.length > 140000 || !/^[\w-]+$/.test(rec.ots))) throw new Error('Invalid timestamp proof');
    if (rec.iso && !Number.isFinite(Date.parse(rec.iso))) throw new Error('Invalid reported time');
    return rec;
  }
  async function request(path, options) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 15000);
    try {
      var response = await fetch((global.PS_API || '') + path, Object.assign({cache: 'no-store'}, options, {signal: controller.signal}));
      if (!response.ok) throw new Error('Proof store: HTTP ' + response.status);
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function shortLink(id) {
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(id || '')) throw new Error('Invalid proof ID');
    var url = new URL('verify.html', location.href); url.searchParams.set('p', id); url.searchParams.set('lang', lang); return url.href;
  }
  async function attach(rec) {
    if (!rec.pid || !rec.ots) return;
    var headers = {'Content-Type': 'application/json'};
    if (rec.editToken) headers.Authorization = 'Bearer ' + rec.editToken;
    return request('/p/' + encodeURIComponent(rec.pid) + '/ots', {method:'PUT',headers:headers,body:JSON.stringify({ots:PSOTS.b64urlBytes(rec.ots)})});
  }
  async function upload(rec) {
    if (!rec.original) throw new Error('Original image unavailable');
    var body = {v:3,iso:rec.iso,d:rec.device,h:rec.hash,img:await blobData(rec.original)};
    if (rec.ots) body.ots = PSOTS.b64urlBytes(rec.ots);
    var response = await request('/p', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    rec.link = shortLink(response.id); rec.pid = response.id; rec.editToken = response.editToken || null;
    return rec;
  }
  function verdict(state) {
    if ([state.s1,state.s2,state.s3].indexOf('bad') !== -1) return 'invalid';
    if ([state.s1,state.s2,state.s3].some(function (v) { return v === null || v === 'busy'; })) return 'checking';
    if (state.s1 === 'ok' && state.s2 === 'ok' && state.s3 === 'ok') return 'confirmed';
    if (state.s2 === 'ok' && state.s3 === 'ok') return 'preview';
    return 'unverified';
  }
  function normalizeRecord(rec) {
    var copy = Object.assign({},rec); delete copy._uploading;
    // Old versions persisted "confirmed" even when no explorer check succeeded.
    if (copy.status === 'confirmed' && copy.verificationVersion !== 2) copy.status = copy.ots ? 'pending' : 'none';
    return copy;
  }
  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }
  async function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) { try { await navigator.clipboard.writeText(text); return true; } catch (_) {} }
    var area = document.createElement('textarea'); area.value = text; area.style.position='fixed'; area.style.opacity='0'; document.body.appendChild(area); area.select();
    var ok=false; try { ok=document.execCommand('copy'); } catch (_) {} area.remove(); return ok;
  }
  global.PS = {lang:lang,t:t,localize:localize,dataBytes:dataBytes,blobData:blobData,originalBlob:originalBlob,validRecord:validRecord,request:request,shortLink:shortLink,attach:attach,upload:upload,verdict:verdict,normalizeRecord:normalizeRecord,download:download,copy:copy};
  localize();
})(window);
