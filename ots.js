/* ====================== PSOTS ======================
   Minimal OpenTimestamps client for ProofShot.
   Stamps a SHA-256 digest onto the Bitcoin blockchain via public
   OpenTimestamps calendar servers, builds a standard detached .ots
   proof file, and verifies anchored proofs against Bitcoin block
   headers fetched from public explorers, all inside the browser.
   Only a blinded 32-byte commitment ever leaves the device. */
(function(global){
"use strict";

var MAGIC=new Uint8Array([0x00,0x4f,0x70,0x65,0x6e,0x54,0x69,0x6d,0x65,0x73,0x74,0x61,0x6d,0x70,0x73,0x00,0x00,0x50,0x72,0x6f,0x6f,0x66,0x00,0xbf,0x89,0xe2,0xe8,0x84,0xe8,0x92,0x94]);
var CALENDARS=[
  "https://alice.btc.calendar.opentimestamps.org",
  "https://bob.btc.calendar.opentimestamps.org",
  "https://finney.calendar.eternitywall.com",
  "https://ots.btc.catallaxy.com"
];
var EXPLORERS=[
  {height:"https://blockstream.info/api/block-height/",block:"https://blockstream.info/api/block/",web:"https://blockstream.info/block/"},
  {height:"https://mempool.space/api/block-height/",block:"https://mempool.space/api/block/",web:"https://mempool.space/block/"}
];
var TAG_PENDING="83dfe30d2ef90c8e", TAG_BITCOIN="0588960d73d71901";
var OP_SHA1=0x02, OP_RIPEMD=0x03, OP_SHA256=0x08, OP_KECCAK=0x67, OP_APPEND=0xf0, OP_PREPEND=0xf1;
var MAX_MSG=4096, MAX_NODES=600, MAX_FILE=100000;

/* ---------- byte helpers ---------- */
function concat(){
  var len=0,i;for(i=0;i<arguments.length;i++)len+=arguments[i].length;
  var out=new Uint8Array(len),pos=0;
  for(i=0;i<arguments.length;i++){out.set(arguments[i],pos);pos+=arguments[i].length;}
  return out;
}
function hex(bytes){var s="";for(var i=0;i<bytes.length;i++)s+=bytes[i].toString(16).padStart(2,"0");return s;}
function unhex(str){
  var out=new Uint8Array(str.length/2);
  for(var i=0;i<out.length;i++)out[i]=parseInt(str.substr(i*2,2),16);
  return out;
}
function reverseHex(h){return hex(unhex(h).reverse());}
function sha256(bytes){
  return crypto.subtle.digest("SHA-256",bytes).then(function(buf){return new Uint8Array(buf);});
}
function sha1(bytes){
  return crypto.subtle.digest("SHA-1",bytes).then(function(buf){return new Uint8Array(buf);});
}
/* RIPEMD-160: needed to verify pre-2016 OpenTimestamps proofs. */
var ripemd160=(function(){
  var RL=[[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],
          [7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8],
          [3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12],
          [1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2],
          [4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13]];
  var RR=[[5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12],
          [6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2],
          [15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13],
          [8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14],
          [12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11]];
  var SL=[[11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8],
          [7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12],
          [11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5],
          [11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12],
          [9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6]];
  var SR=[[8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6],
          [9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11],
          [9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5],
          [15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8],
          [8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11]];
  var KL=[0x00000000,0x5a827999,0x6ed9eba1,0x8f1bbcdc,0xa953fd4e];
  var KR=[0x50a28be6,0x5c4dd124,0x6d703ef3,0x7a6d76e9,0x00000000];
  function rol(x,n){return ((x<<n)|(x>>>(32-n)))>>>0;}
  function f(j,x,y,z){
    if(j===0)return (x^y^z)>>>0;
    if(j===1)return ((x&y)|(~x&z))>>>0;
    if(j===2)return ((x|~y)^z)>>>0;
    if(j===3)return ((x&z)|(y&~z))>>>0;
    return (x^(y|~z))>>>0;
  }
  return function(bytes){
    var len=bytes.length,blocks=((len+8)>>6)+1,padded=new Uint8Array(blocks*64);
    padded.set(bytes);padded[len]=0x80;
    var bitLen=len*8;
    for(var i=0;i<8;i++)padded[blocks*64-8+i]=Math.floor(bitLen/Math.pow(2,8*i))&0xff;
    var h=[0x67452301,0xefcdab89,0x98badcfe,0x10325476,0xc3d2e1f0];
    var X=new Array(16);
    for(var b=0;b<blocks;b++){
      for(var w=0;w<16;w++){
        var o=b*64+w*4;
        X[w]=(padded[o]|(padded[o+1]<<8)|(padded[o+2]<<16)|(padded[o+3]<<24))>>>0;
      }
      var al=h[0],bl=h[1],cl=h[2],dl=h[3],el=h[4];
      var ar=h[0],br=h[1],cr=h[2],dr=h[3],er=h[4];
      for(var rnd=0;rnd<5;rnd++){
        for(var j=0;j<16;j++){
          var t=(al+f(rnd,bl,cl,dl)+X[RL[rnd][j]]+KL[rnd])>>>0;
          t=(rol(t,SL[rnd][j])+el)>>>0;
          al=el;el=dl;dl=rol(cl,10);cl=bl;bl=t;
          t=(ar+f(4-rnd,br,cr,dr)+X[RR[rnd][j]]+KR[rnd])>>>0;
          t=(rol(t,SR[rnd][j])+er)>>>0;
          ar=er;er=dr;dr=rol(cr,10);cr=br;br=t;
        }
      }
      var t2=(h[1]+cl+dr)>>>0;
      h[1]=(h[2]+dl+er)>>>0;
      h[2]=(h[3]+el+ar)>>>0;
      h[3]=(h[4]+al+br)>>>0;
      h[4]=(h[0]+bl+cr)>>>0;
      h[0]=t2;
    }
    var out=new Uint8Array(20);
    for(var k=0;k<5;k++){out[k*4]=h[k]&0xff;out[k*4+1]=(h[k]>>>8)&0xff;out[k*4+2]=(h[k]>>>16)&0xff;out[k*4+3]=(h[k]>>>24)&0xff;}
    return out;
  };
})();
function varint(n){
  if(n===0)return new Uint8Array([0]);
  var out=[];
  while(n>0){var b=n&0x7f;n=Math.floor(n/128);if(n>0)b|=0x80;out.push(b);}
  return new Uint8Array(out);
}
function varbytes(bytes){return concat(varint(bytes.length),bytes);}
function b64urlBytes(bytes){
  var s="";for(var i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function bytesB64url(str){
  str=str.replace(/-/g,"+").replace(/_/g,"/");
  while(str.length%4)str+="=";
  var bin=atob(str),out=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}

/* ---------- reader ---------- */
function Reader(bytes){this.buf=bytes;this.pos=0;}
Reader.prototype.byte=function(){
  if(this.pos>=this.buf.length)throw new Error("ots: truncated");
  return this.buf[this.pos++];
};
Reader.prototype.bytes=function(n){
  if(this.pos+n>this.buf.length)throw new Error("ots: truncated");
  var out=this.buf.subarray(this.pos,this.pos+n);this.pos+=n;return out;
};
Reader.prototype.varint=function(){
  var n=0,shift=1,b;
  do{b=this.byte();n+=(b&0x7f)*shift;shift*=128;if(shift>Math.pow(2,53))throw new Error("ots: varint too large");}while(b&0x80);
  return n;
};
Reader.prototype.varbytes=function(max){
  var n=this.varint();
  if(n>max)throw new Error("ots: value too large");
  return this.bytes(n);
};

/* ---------- timestamp tree parsing / op execution ----------
   Walks a serialized timestamp starting from `msg`, executing each
   commitment op, and collects every attestation with the message of
   the node it attests to. */
function parseTimestamp(r,msg,out,state){
  async function step(m,path){
    if(path.length>256)throw new Error("ots: tree too deep");
    var tag;
    do {
      tag=r.byte();
      await child(tag===0xff?r.byte():tag,m,path);
    } while(tag===0xff);
  }
  async function child(tag,m,path){
    if(++state.nodes>MAX_NODES)throw new Error("ots: tree too large");
    var start=r.pos-1;
    if(tag===0x00){
      var attTag=hex(r.bytes(8)),payload=r.varbytes(MAX_MSG),pr=new Reader(payload);
      var att={type:"unknown",tag:attTag,msg:m,path:path,raw:r.buf.slice(start,r.pos)};
      if(attTag===TAG_PENDING){att.type="pending";att.uri=new TextDecoder().decode(pr.varbytes(1000));}
      else if(attTag===TAG_BITCOIN){att.type="bitcoin";att.height=pr.varint();}
      if(att.type!=="unknown"&&pr.pos!==payload.length)throw new Error("ots: trailing attestation data");
      out.push(att);return;
    }
    var arg,next;
    if(tag===OP_APPEND){arg=r.varbytes(MAX_MSG);next=concat(m,arg);}
    else if(tag===OP_PREPEND){arg=r.varbytes(MAX_MSG);next=concat(arg,m);}
    else if(tag===OP_SHA256){next=await sha256(m);}
    else if(tag===OP_SHA1){next=await sha1(m);}
    else if(tag===OP_RIPEMD){next=ripemd160(m);}
    else{throw new Error("ots: unsupported op 0x"+tag.toString(16));}
    if(next.length>MAX_MSG)throw new Error("ots: message too large");
    await step(next,path.concat([r.buf.slice(start,r.pos)]));
  }
  return step(msg,[]);
}

/* Rebuild a canonical tree, merging shared operation paths across calendars.
   Retaining the paths also lets us save upgraded proofs, not just their status. */
function serializeTree(atts){
  function node(){return {atts:new Map(),ops:new Map()};}
  var root=node();
  atts.forEach(function(att){
    var cursor=root;
    att.path.forEach(function(op){var key=hex(op);if(!cursor.ops.has(key))cursor.ops.set(key,{bytes:op,child:node()});cursor=cursor.ops.get(key).child;});
    cursor.atts.set(hex(att.raw),att.raw);
  });
  function encode(n){
    var parts=Array.from(n.atts.keys()).sort().map(function(k){return n.atts.get(k);});
    Array.from(n.ops.keys()).sort().forEach(function(k){var op=n.ops.get(k);parts.push(concat(op.bytes,encode(op.child)));});
    if(!parts.length)throw new Error("ots: empty tree");
    return concat.apply(null,parts.map(function(p,i){return i<parts.length-1?concat(new Uint8Array([0xff]),p):p;}));
  }
  return encode(root);
}
function serializeFile(digest,atts){return concat(MAGIC,varint(1),new Uint8Array([OP_SHA256]),digest,serializeTree(atts));}

/* Parse a serialized timestamp (no file header) from `msg`.
   Resolves to a list of attestations. */
function parseTree(bytes,msg){
  if(bytes.length>MAX_FILE)throw new Error("ots: file too large");
  var out=[],r=new Reader(bytes);
  return parseTimestamp(r,msg,out,{nodes:0}).then(function(){if(r.pos!==bytes.length)throw new Error("ots: trailing data");return out;});
}

/* Parse a detached .ots file. Resolves to
   {digest:Uint8Array, attestations:[...]} */
function parseFile(otsBytes){
  if(!(otsBytes instanceof Uint8Array)||otsBytes.length>MAX_FILE)throw new Error("ots: invalid size");
  var r=new Reader(otsBytes);
  var head=r.bytes(MAGIC.length);
  if(hex(head)!==hex(MAGIC))throw new Error("ots: bad header");
  var version=r.varint();
  if(version!==1)throw new Error("ots: unsupported version "+version);
  var hashOp=r.byte();
  if(hashOp!==OP_SHA256)throw new Error("ots: unsupported file hash op");
  var digest=r.bytes(32);
  var out=[];
  return parseTimestamp(r,digest,out,{nodes:0}).then(function(){
    if(r.pos!==otsBytes.length)throw new Error("ots: trailing data");
    return {digest:digest,attestations:out};
  });
}

/* ---------- network ---------- */
function fetchTimeout(url,opts,ms){
  var ctrl=("AbortController" in global)?new AbortController():null;
  if(ctrl)opts.signal=ctrl.signal;
  var timer=ctrl?setTimeout(function(){ctrl.abort();},ms):null;
  return fetch(url,opts).finally(function(){if(timer)clearTimeout(timer);});
}

/* ---------- stamping ----------
   digest: Uint8Array(32), SHA-256 of the original file.
   Resolves to {ots:Uint8Array, calendars:[uri], commitment:hex}. */
function stamp(digest){
  if(!(digest instanceof Uint8Array)||digest.length!==32)return Promise.reject(new Error("digest must be 32 bytes"));
  var nonce=crypto.getRandomValues(new Uint8Array(16));
  return sha256(concat(digest,nonce)).then(function(commitment){
    var posts=CALENDARS.map(function(cal){
      return fetchTimeout(cal+"/digest",{
        method:"POST",
        headers:{"Accept":"application/vnd.opentimestamps.v1","Content-Type":"application/x-www-form-urlencoded"},
        body:commitment
      },12000).then(function(res){
        if(!res.ok)throw new Error("calendar "+res.status);
        return res.arrayBuffer();
      }).then(function(buf){
        var bytes=new Uint8Array(buf);
        if(bytes.length<10||bytes.length>10000)throw new Error("calendar: bad response");
        /* sanity: must parse and contain at least one attestation */
        return parseTree(bytes,commitment).then(function(atts){
          if(!atts.length)throw new Error("calendar: no attestation");
          return {cal:cal,bytes:bytes,atts:atts};
        });
      });
    });
    return Promise.allSettled(posts).then(function(results){
      var ok=results.filter(function(x){return x.status==="fulfilled";}).map(function(x){return x.value;});
      if(!ok.length)throw new Error("No calendar server reachable");
      var prefix=[concat(new Uint8Array([OP_APPEND]),varbytes(nonce)),new Uint8Array([OP_SHA256])];
      var atts=[];
      ok.forEach(function(result){result.atts.forEach(function(att){atts.push(Object.assign({},att,{path:prefix.concat(att.path)}));});});
      return {
        ots:serializeFile(digest,atts),
        calendars:ok.map(function(x){return x.cal;}),
        commitment:hex(commitment)
      };
    });
  });
}

/* ---------- verification ----------
   Resolves to one of:
   {status:"confirmed", height, blockHash, blockTime, merkleOk, explorer}
   {status:"pending", uris:[...]}
   {status:"invalid", reason} */
function calendarURL(uri){
  try {
    var url=new URL(uri);
    var hosts=CALENDARS.map(function(c){return new URL(c).hostname;}).concat(["a.pool.opentimestamps.org","b.pool.opentimestamps.org","a.pool.eternitywall.com","btc.calendar.catallaxy.com"]);
    if(hosts.indexOf(url.hostname)<0||url.username||url.password||url.port||url.search||url.hash||!/^https?:$/.test(url.protocol))return null;
    url.protocol="https:";return url.href.replace(/\/$/,"");
  }catch(e){return null;}
}
async function checkUpgrade(otsBytes){
  try {
    var parsed=await parseFile(otsBytes),all=parsed.attestations.slice();
    var bitcoin=all.filter(function(a){return a.type==="bitcoin";});
    var pending=all.filter(function(a){return a.type==="pending";});
    var reached=false;
    if(!bitcoin.length){
      var updates=await Promise.all(pending.map(async function(att){
        var uri=calendarURL(att.uri);if(!uri)return [];
        try{
          var response=await fetchTimeout(uri+"/timestamp/"+hex(att.msg),{headers:{"Accept":"application/vnd.opentimestamps.v1"},credentials:"omit",redirect:"error"},12000);
          if(response.status===404){reached=true;return [];}
          if(!response.ok)return [];
          var atts=await parseTree(new Uint8Array(await response.arrayBuffer()),att.msg);reached=true;
          return atts.map(function(a){return Object.assign({},a,{path:att.path.concat(a.path)});});
        }catch(e){return [];}
      }));
      updates.forEach(function(atts){all=all.concat(atts);});
      bitcoin=all.filter(function(a){return a.type==="bitcoin";});
    }
    var failure=null;
    for(var i=0;i<bitcoin.length;i++){
      var result=await verifyBitcoin(bitcoin[i]);
      if(result.status==="confirmed"&&result.merkleOk===true){result.ots=serializeFile(parsed.digest,all);return result;}
      if(!failure||result.status==="unavailable")failure=result;
    }
    if(failure)return failure;
    if(!pending.length)return {status:"invalid",reason:"no Bitcoin or calendar attestations"};
    return {status:reached?"pending":"unavailable",reason:reached?"not confirmed":"calendar unavailable or unsupported"};
  }catch(e){return {status:"invalid",reason:e.message||String(e)};}
}

/* Compare the attested message against the Bitcoin block's merkle root. */
function verifyBitcoin(att){
  function tryExplorer(idx){
    if(idx>=EXPLORERS.length)return Promise.resolve({status:"unavailable",height:att.height,merkleOk:null,reason:"explorer unreachable"});
    var ex=EXPLORERS[idx];
    return fetchTimeout(ex.height+att.height,{},10000)
      .then(function(res){if(!res.ok)throw 0;return res.text();})
      .then(function(blockHash){
        if(!/^[0-9a-f]{64}$/.test(blockHash.trim()))throw new Error("bad block hash");
        return fetchTimeout(ex.block+blockHash.trim(),{},10000)
          .then(function(res){if(!res.ok)throw 0;return res.json();})
          .then(function(block){
            if(block.height!==att.height||!Number.isFinite(block.timestamp)||!/^([0-9a-f]{64})$/.test(block.merkle_root||""))throw new Error("bad block data");
            var matched=reverseHex(hex(att.msg))===block.merkle_root;
            return {
              status:matched?"confirmed":"invalid",
              reason:matched?null:"Bitcoin merkle root mismatch",
              height:att.height,
              blockHash:blockHash.trim(),
              blockTime:block.timestamp*1000,
              merkleOk:matched,
              explorer:ex.web+blockHash.trim()
            };
          });
      })
      .catch(function(){return tryExplorer(idx+1);});
  }
  return tryExplorer(0);
}

/* ---------- info (no network) ---------- */
function info(otsBytes){
  return Promise.resolve().then(function(){return parseFile(otsBytes);}).then(function(parsed){
    return {
      digest:hex(parsed.digest),
      pending:parsed.attestations.filter(function(a){return a.type==="pending";}).map(function(a){return a.uri;}),
      bitcoin:parsed.attestations.filter(function(a){return a.type==="bitcoin";}).map(function(a){return a.height;})
    };
  });
}

global.PSOTS={
  stamp:stamp,
  checkUpgrade:checkUpgrade,
  info:info,
  parseFile:parseFile,
  sha256:sha256,
  hex:hex,
  unhex:unhex,
  b64urlBytes:b64urlBytes,
  bytesB64url:bytesB64url,
  CALENDARS:CALENDARS
};
})(window);
