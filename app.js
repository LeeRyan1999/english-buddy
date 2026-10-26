'use strict';
const $=s=>document.querySelector(s), LS=localStorage;
const DEFAULT_URL='https://english-buddy-api-0cz1.onrender.com';
const WSS='wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=';
const cfg=()=>({url:(LS.eb_url||DEFAULT_URL).replace(/\/+$/,''),code:LS.eb_code||'',mock:LS.eb_mock==='1'||(LS.eb_mock!=='0'&&!LS.eb_code)});
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SCEN={order:'🍔 點餐',travel:'✈️ 旅遊/機場',interview:'💼 面試',shopping:'🛍️ 購物',chat:'☕ 閒聊'},LVL={beginner:'初級',intermediate:'中級',advanced:'高級'};
const VOICES={Puck:'Puck（活潑・男）',Charon:'Charon（沉穩・男）',Kore:'Kore（堅定・女）',Fenrir:'Fenrir（興奮・男）',Aoede:'Aoede（輕快・女）',Leda:'Leda（年輕・女）',Orus:'Orus（穩重・男）',Zephyr:'Zephyr（明亮・女）'};
// migrate: history used to live in eb_voice, colliding with the voice preference
(()=>{try{const v=LS.eb_voice;if(v&&/^\s*[\[{]/.test(v)){if(!LS.eb_vhist)LS.eb_vhist=v;LS.removeItem('eb_voice');}}catch(e){}})();
const PREF_OK={scen:Object.keys(SCEN),lvl:['beginner','intermediate','advanced'],voice:['Puck','Charon','Kore','Fenrir','Aoede','Leda','Orus','Zephyr'],speed:['normal','slow']};
const PREF_DEF={scen:'chat',lvl:'intermediate',voice:'Puck',speed:'normal'};
const pref=k=>{const v=LS['eb_'+k];if(!v||v.length>40||/[\[{]/.test(v)||(PREF_OK[k]&&!PREF_OK[k].includes(v)))return PREF_DEF[k];return v;};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ---------- status / warm-up ----------
const W={state:'idle',tok:null,tokAt:0,tokKey:''};
function renderStatus(){const s=$('#status'),c=cfg();
  if(!navigator.onLine){s.className='pill off';s.textContent='● 離線';}
  else if(c.mock){s.className='pill mock';s.textContent='● 示範模式';}
  else if(W.state==='waking'){s.className='pill wake';s.textContent='◌ 喚醒伺服器…';}
  else if(W.state==='down'){s.className='pill off';s.textContent='● 伺服器無回應';}
  else{s.className='pill';s.textContent='● 已連線';}}
async function warm(){const c=cfg();if(c.mock||!navigator.onLine||W.state==='ready'||W.state==='waking')return W.state==='ready';
  W.state='waking';renderStatus();const t0=Date.now();
  while(Date.now()-t0<90e3){try{const ac=new AbortController(),to=setTimeout(()=>ac.abort(),15e3);const r=await fetch(c.url+'/health',{signal:ac.signal});clearTimeout(to);if(r.ok){W.state='ready';renderStatus();prefetchToken();return true}}catch{}await sleep(2500);}
  W.state='down';renderStatus();return false;}
addEventListener('online',()=>{renderStatus();warm();flushQueue()});addEventListener('offline',renderStatus);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){warm();if(V.on)lockWake();}});

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#tabs button,.tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.tab).classList.add('on');});

// ---------- API ----------
async function api(path,body,method){const c=cfg();
  if(c.mock)return mock(path,body);
  if(!navigator.onLine)throw new Error('目前離線');
  const r=await fetch(c.url+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','X-Access-Code':c.code},body:body&&JSON.stringify(body)});
  const j=await r.json().catch(()=>({error:'後台回應錯誤 '+r.status}));if(!r.ok){const e=new Error(r.status===401?'存取碼錯誤，請到「設定」確認':j.error||r.status);e.status=r.status;throw e}return j;}
async function mock(path,b){await sleep(250);
  if(path==='/api/correct'){let s=b.text;[[/\bI wants\b/g,'I want'],[/\btwo coffee\b/g,'two coffees'],[/\bI go\b/g,'I went']].forEach(([a,c])=>s=s.replace(a,c));
    return{corrected:s,isCorrect:s===b.text,zh:b.zh?'我想要一個漢堡和兩杯咖啡。（示範）':undefined,explanation:s===b.text?'這句沒有問題！':'主詞 I 的動詞不加 s（wants→want）；可數名詞複數要加 s（coffee→coffees）。（示範模式）'};}
  if(path==='/api/explain')return{word:b.word,ipa:'',pos:'',definition:'(demo definition)',zh:'（示範模式解釋）',example:`This is an example with "${b.word}".`};
  if(path==='/api/zh')return{zh:'（示範翻譯）'+b.text.slice(0,20)};
  if(path==='/api/vocab')return{ok:true,word:b.word};throw new Error('mock');}

// ---------- Notion queue ----------
const queue=()=>JSON.parse(LS.eb_queue||'[]'),setQueue=q=>LS.eb_queue=JSON.stringify(q);
async function flushQueue(){const q=queue();if(!q.length||!navigator.onLine)return;const left=[];for(const it of q){try{await api('/api/vocab',it,'POST')}catch{left.push(it)}}setQueue(left);}

// ---------- sheet ----------
const sheet=html=>{$('#sheetIn').innerHTML=html;$('#sheet').classList.remove('hidden')},closeSheet=()=>$('#sheet').classList.add('hidden');
$('#sheet').onclick=e=>{if(e.target.id==='sheet')closeSheet()};
function say(t){if(!window.speechSynthesis)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(t);u.lang='en-US';u.rate=.9;speechSynthesis.speak(u)}
async function wordSheet(w){sheet(`<b style="font-size:22px">${esc(w)}</b><p class="dim">查詢中…</p>`);let r=null,err='';
  try{r=await api('/api/explain',{word:w})}catch(e){err=e.message}
  sheet(`<div class="row" style="align-items:center;margin:0"><b style="font-size:22px;flex:1">${esc(r?.word||w)}</b><button id="wSay">🔊</button><button id="wX">✕</button></div>
   ${r?`<div class="small dim">${esc(r.ipa)} ${esc(r.pos)}</div><p style="font-size:18px">${esc(r.zh)}</p><p class="small">${esc(r.definition)}<br>💬 ${esc(r.example)}</p>`:`<p class="err small">⚠️ ${esc(err)}</p>`}
   <button class="pri" id="wAdd" style="width:100%">＋ 加入 Notion 單字頁</button><div id="wFb" class="small" style="margin-top:8px"></div>`);
  $('#wSay').onclick=()=>say(r?.word||w);$('#wX').onclick=closeSheet;
  $('#wAdd').onclick=async()=>{const ww=(r?.word&&/[A-Za-z]/.test(r.word)?r.word:w).toLowerCase();if(!/[A-Za-z]/.test(ww)){$('#wFb').textContent='請先查到英文單字';return}const it={word:ww,pron:(r?.ipa||'').replace(/^\/|\/$/g,''),meaning:r?.zh||'',example:r?.example||'',added:new Date().toISOString().slice(0,10)};$('#wAdd').disabled=true;
    if(!navigator.onLine){setQueue([...queue(),it]);$('#wFb').textContent='離線中，已排隊，連網後上傳';return;}
    try{const x=await api('/api/vocab',it,'POST');$('#wFb').innerHTML=`<span class="good">${x.skipped?'已經在單字頁了':'✅ 已加入 Notion'}</span>`}
    catch(e){setQueue([...queue(),it]);$('#wFb').innerHTML=`<span class="err">⚠️ ${esc(e.message)}，已排隊</span>`}};}
function scenSheet(){const opt=(k,o)=>Object.entries(o).map(([v,l])=>`<button data-k="${k}" data-v="${v}" class="${pref(k)===v?'on':''}">${l}</button>`).join('');
  sheet(`<h3>情境</h3><div class="opts">${opt('scen',SCEN)}</div><h3>程度</h3><div class="opts">${opt('lvl',LVL)}</div><h3>速度</h3><div class="opts">${opt('speed',{normal:'正常',slow:'慢一點'})}</div>
   <p class="small dim">${V.on?'變更會在下次開始對話時生效。':''}</p><button class="pri" style="width:100%" id="scOk">完成</button>`);
  $('#sheetIn').querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{LS['eb_'+b.dataset.k]=b.dataset.v;W.tok=null;scenSheet();syncPrefs()});$('#scOk').onclick=closeSheet;}
$('#scenBtn').onclick=scenSheet;
function syncPrefs(){$('#scenBtn').textContent=`${pref('voice')} · ${SCEN[pref('scen')]} · ${LVL[pref('lvl')]}${pref('speed')==='slow'?' · 慢速':''}`;
  $('#sScen').value=pref('scen');$('#sLvl').value=pref('lvl');$('#sVoice').value=pref('voice');$('#sSpeed').value=pref('speed');}

// ---------- transcript ----------
const clickable=s=>esc(s).replace(/[A-Za-z][A-Za-z'-]*/g,w=>`<span class="w" data-w="${w}">${w}</span>`);
function diff(a,b){const A=a.split(/\s+/),B=b.split(/\s+/),n=A.length,m=B.length,L=[...Array(n+1)].map(()=>Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  let i=0,j=0,o=[];while(i<n||j<m){if(i<n&&j<m&&A[i]===B[j]){o.push(esc(A[i]));i++;j++}else if(j<m&&(i>=n||L[i][j+1]>=L[i+1][j])){o.push(`<ins>${esc(B[j])}</ins>`);j++}else{o.push(`<del>${esc(A[i])}</del>`);i++}}return o.join(' ');}
const vHist=()=>{try{const h=JSON.parse(LS.eb_vhist||'[]');return Array.isArray(h)?h.filter(m=>m&&typeof m.text==='string'):[]}catch(e){return[]}},setVH=h=>{LS.eb_vhist=JSON.stringify(h.slice(-60));renderLog()};
function renderLog(){const L=$('#vLog'),h=vHist().slice(-4);
  L.innerHTML=h.map(m=>`<div class="msg ${m.role==='ai'?'ai':'me'}">${clickable(m.text)}${m.zh&&(m.role==='ai'?trAI():trMe())?`<div class="zh">${esc(m.zh)}</div>`:''}</div>`).join('')
   +(V.inT?`<div class="msg me live">${esc(V.inT)}</div>`:'')+(V.outT?`<div class="msg ai live">${clickable(V.outT)}</div>`:'');}
let fixT=0;function showFix(t,r){const el=$('#fixToast');
  el.innerHTML=r.isCorrect?'✅ 文法正確':`<span class="dim small">✏️ ${diff(t,r.corrected)}</span><br><b>${esc(r.corrected)}</b><br><span class="small">${esc(r.explanation||'')}</span>`;
  el.classList.remove('hidden');$('#vLog').classList.add('dim2');clearTimeout(fixT);fixT=setTimeout(()=>{el.classList.add('hidden');$('#vLog').classList.remove('dim2')},r.isCorrect?2500:8000);}
$('#fixToast').onclick=()=>{$('#fixToast').classList.add('hidden');$('#vLog').classList.remove('dim2')};
$('#vLog').onclick=e=>{const w=e.target.closest('.w');if(w)wordSheet(w.dataset.w)};
const trMe=()=>LS.eb_trMe!=='0',trAI=()=>LS.eb_trAI!=='0';
function patchH(idx,t,f){const h2=vHist();if(h2[idx]?.text===t){f(h2[idx]);LS.eb_vhist=JSON.stringify(h2.slice(-60));renderLog();}}
function commitUser(){const t=V.inT.trim();V.inT='';if(!t)return;const h=vHist();h.push({role:'user',text:t});setVH(h);const idx=h.length-1;
  api('/api/correct',{text:t,zh:trMe()}).then(r=>{patchH(idx,t,m=>{m.fix=r;if(r&&typeof r.zh==='string')m.zh=r.zh.slice(0,300)});showFix(t,r)}).catch(e=>console.log('[eb] correct failed',e.message));}
function commitAI(){const t=V.outT.trim();V.outT='';if(!t)return;const h=vHist();h.push({role:'ai',text:t});setVH(h);const idx=h.length-1;
  if(trAI())api('/api/zh',{text:t}).then(r=>{if(r&&typeof r.zh==='string')patchH(idx,t,m=>m.zh=r.zh.slice(0,300))}).catch(()=>{});}
const capOn=()=>LS.eb_cap!=='0';function renderCap(){$('#vLog').classList.toggle('hide',!capOn());$('#vCap').classList.toggle('on',capOn())}
$('#vCap').onclick=()=>{LS.eb_cap=capOn()?'0':'1';renderCap()};

// ---------- realtime voice engine ----------
const V={on:false,ws:null,ctx:null,stream:null,node:null,src:null,an:null,outAn:null,outGain:null,playAt:0,sources:new Set(),inT:'',outT:'',raf:0,mockT:[],
  state:'off',muted:false,handle:null,retries:0,greeted:false,wake:null,thinkT:0,gen:0};
const MSG={off:'點一下開始',connecting:'Connecting…',listen:'Listening…',think:'Thinking…',ai:'Speaking…',reconnect:'重新連線中…（對話會接續）'};
function vSet(st,msg){V.state=st;$('#vState').textContent=msg||(V.muted&&st==='listen'?'Muted':MSG[st]);
  const m=$('#vMain');m.classList.toggle('end',st!=='off');m.setAttribute('aria-label',st==='off'?'開始':'結束');
  $('#vMute').classList.toggle('muted',V.muted);document.body.classList.toggle('idle',st==='off');}
async function lockWake(){try{if('wakeLock'in navigator&&!document.hidden&&!V.wake){V.wake=await navigator.wakeLock.request('screen');V.wake.addEventListener('release',()=>V.wake=null)}}catch{}}
const WORKLET=`class P extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.acc=[];this.pos=0}
process(i){const x=i[0][0];if(!x)return true;for(;this.pos<x.length;this.pos+=this.r)this.acc.push(x[Math.floor(this.pos)]);this.pos-=x.length;
if(this.acc.length>=1600){const a=new Int16Array(this.acc.length);for(let k=0;k<a.length;k++){const s=Math.max(-1,Math.min(1,this.acc[k]));a[k]=s<0?s*32768:s*32767}this.port.postMessage(a.buffer,[a.buffer]);this.acc=[]}return true}}registerProcessor('pcm16k',P)`;
async function ensureAudio(){if(!V.ctx){V.ctx=new (window.AudioContext||window.webkitAudioContext)();V.outGain=V.ctx.createGain();V.outAn=V.ctx.createAnalyser();V.outAn.fftSize=512;V.outGain.connect(V.outAn);V.outAn.connect(V.ctx.destination);V.workletP=null;}
  await V.ctx.resume();}
async function ensureMic(){if(V.stream&&V.stream.getAudioTracks().some(t=>t.readyState==='live'))return;
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('這個瀏覽器不支援麥克風（iPhone/iPad 請用 Safari 並確認是 https 網址）');
  try{V.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}})}
  catch(e){throw new Error(e.name==='NotAllowedError'?'麥克風權限被拒絕。請到 設定 → Safari → 麥克風（或網址列左邊「大小」→ 網站設定）改成「允許」，再重新整理。':e.name==='NotFoundError'?'找不到麥克風':'麥克風無法開啟：'+e.message)}
  V.workletP=V.workletP||V.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET],{type:'application/javascript'})));await V.workletP;
  V.src?.disconnect();V.src=V.ctx.createMediaStreamSource(V.stream);V.an=V.ctx.createAnalyser();V.an.fftSize=512;V.src.connect(V.an);
  V.node=new AudioWorkletNode(V.ctx,'pcm16k');V.src.connect(V.node);V.node.port.onmessage=ev=>sendAudio(ev.data);}
function sendAudio(buf){const ws=V.ws;if(!ws||ws.readyState!==1||!V.ready||V.muted)return;const u=new Uint8Array(buf);let b='';for(let i=0;i<u.length;i+=8192)b+=String.fromCharCode.apply(null,u.subarray(i,i+8192));
  ws.send(JSON.stringify({realtimeInput:{audio:{data:btoa(b),mimeType:'audio/pcm;rate=16000'}}}));}
function flushPlayback(){V.sources.forEach(s=>{try{s.onended=null;s.stop()}catch{}});V.sources.clear();V.playAt=0;
  if(V.outGain){V.outGain.gain.cancelScheduledValues(0);V.outGain.gain.value=1;}}
function playPCM(b64){const bin=atob(b64),n=bin.length>>1,buf=V.ctx.createBuffer(1,n,24000),ch=buf.getChannelData(0);
  for(let i=0;i<n;i++){let v=bin.charCodeAt(2*i)|(bin.charCodeAt(2*i+1)<<8);if(v>32767)v-=65536;ch[i]=v/32768;}
  const s=V.ctx.createBufferSource();s.buffer=buf;s.connect(V.outGain);const now=V.ctx.currentTime;
  const t=V.playAt<now+.02?now+.04:V.playAt; // small jitter buffer at start, then gapless back-to-back
  s.start(t);V.playAt=t+buf.duration;V.sources.add(s);
  s.onended=()=>{V.sources.delete(s);if(!V.sources.size&&V.state==='ai')vSet('listen');};}
// ---- canvas orb: soft glowing fluid sphere ----
const ORB={lv:0,e:0,t:0,last:0};
function orbLoop(){cancelAnimationFrame(V.raf);const cv=$('#orb'),g=cv.getContext('2d'),d=new Uint8Array(512);
  const f=now=>{const dt=Math.min(.05,(now-(ORB.last||now))/1000);ORB.last=now;const dpr=Math.min(2,devicePixelRatio||1),W=cv.clientWidth,H=cv.clientHeight;
    if(cv.width!==Math.round(W*dpr)||cv.height!==Math.round(H*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr)}
    let lv=0;const st=V.state,an=st==='ai'?V.outAn:(st==='listen'&&!V.muted?V.an:null);
    if(an){an.getByteTimeDomainData(d);let q=0;for(const v of d)q+=(v-128)**2;lv=Math.min(1,Math.sqrt(q/d.length)/(st==='ai'?22:30));}
    ORB.lv+=(lv-ORB.lv)*(lv>ORB.lv?.35:.08);
    const base={off:.0,connecting:.15,reconnect:.15,listen:.12,think:.3,ai:.35}[st]??0;ORB.e+=(base+ORB.lv*(st==='ai'?1.4:1)-ORB.e)*.08;
    ORB.t+=dt*(0.35+ORB.e*2.2);const t=ORB.t,e=ORB.e;
    g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);
    const cx=W/2,cy=H/2,R0=Math.min(W*.24,H*.19)*(1+(st==='off'?Math.sin(now/1300)*.025:0)+ORB.lv*.12)*(st==='connecting'||st==='reconnect'?1+Math.sin(now/260)*.03:1);
    const glow=g.createRadialGradient(cx,cy,R0*.6,cx,cy,R0*2.4);glow.addColorStop(0,`rgba(200,205,215,${.14+e*.18})`);glow.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=glow;g.fillRect(0,0,W,H);
    const blob=(r,amp,ph,fill)=>{g.beginPath();const N=120;for(let i=0;i<=N;i++){const a=i/N*Math.PI*2;
      const k=1+amp*(Math.sin(3*a+t*1.3+ph)*.5+Math.sin(5*a-t*1.7+ph*2)*.3+Math.sin(2*a+t*.9-ph)*.6+Math.sin(7*a+t*2.3)*.15*e);
      const x=cx+Math.cos(a)*r*k,y=cy+Math.sin(a)*r*k;i?g.lineTo(x,y):g.moveTo(x,y)}g.closePath();g.fillStyle=fill;g.fill();};
    const amp=.012+Math.min(e,.9)*.045;
    const gr=(x,y,r,c0,c1,c2)=>{const q=g.createRadialGradient(x,y,0,cx,cy,r);q.addColorStop(0,c0);q.addColorStop(.55,c1);q.addColorStop(1,c2);return q};
    blob(R0*1.04,amp*1.3,1.7,gr(cx,cy,R0*1.1,'rgba(150,155,165,.0)','rgba(120,125,135,.18)','rgba(90,95,105,.05)'));
    blob(R0,amp,0,gr(cx-R0*.28,cy-R0*.32,R0*1.05,'#ffffff','#c9ccd2','#4a4d55'));
    g.globalCompositeOperation='lighter';
    blob(R0*.62,amp*1.8,3.1,gr(cx+Math.sin(t*.7)*R0*.2,cy+Math.cos(t*.6)*R0*.2,R0*.7,`rgba(255,255,255,${.22+e*.25})`,'rgba(220,225,235,.06)','rgba(0,0,0,0)'));
    g.globalCompositeOperation='source-over';
    V.raf=requestAnimationFrame(f)};V.raf=requestAnimationFrame(f);}
async function getToken(handle){const key=[pref('scen'),pref('lvl'),pref('voice'),pref('speed')].join('|');
  if(!handle&&W.tok&&W.tokKey===key&&Date.now()-W.tokAt<45e3){const t=W.tok;W.tok=null;return t}W.tok=null;
  return api('/api/live-token',{scenario:pref('scen'),level:pref('lvl'),voice:pref('voice'),speed:pref('speed'),...(V.plain?{plain:true}:{}),...(handle?{handle}:{})});}
async function prefetchToken(){const c=cfg();if(c.mock||V.on||!c.code||W.state!=='ready'||document.hidden)return;
  try{const key=[pref('scen'),pref('lvl'),pref('voice'),pref('speed')].join('|');const t=await getToken();W.tok=t;W.tokAt=Date.now();W.tokKey=key;}catch{}}
$('#vMain').addEventListener('pointerdown',()=>{if(V.state==='off'&&!W.tok)prefetchToken()});

async function vStart(){if(V.on)return;V.on=true;V.handle=null;V.retries=0;V.greeted=false;V.gotAudio=false;V.plain=Date.now()-(+LS.eb_plain||0)<7*864e5;V.muted=false;closeSheet();
  vSet('connecting');lockWake();
  try{await ensureAudio();orbLoop();if(cfg().mock)return vMock();
    if(!navigator.onLine)throw new Error('目前離線，語音對話需要網路');
    if(W.state!=='ready'){vSet('connecting','喚醒伺服器中…（免費主機閒置後約需 30–60 秒）');if(!(await warm()))throw new Error('伺服器沒有回應，請稍後再試');}
    vSet('connecting');await Promise.all([ensureMic(),connect()]);
  }catch(e){fail(e)}}
function fail(e){const msg='⚠️ '+(e.message||e);vEnd();$('#vState').textContent=msg;}
async function connect(){const gen=++V.gen;V.ready=false;let tok;
  tok=await getToken(V.handle);if(gen!==V.gen||!V.on)return;
  const ws=V.ws=new WebSocket(WSS+encodeURIComponent(tok.token));
  ws.onopen=()=>ws.send(JSON.stringify({setup:{model:'models/'+tok.model}}));
  ws.onmessage=async e=>{if(ws!==V.ws)return;const m=JSON.parse(typeof e.data==='string'?e.data:await e.data.text());
    if(m.setupComplete){V.ready=true;if(V.state!=='ai')vSet('listen');
      if(!V.greeted){V.greeted=true;ws.send(JSON.stringify({realtimeInput:{text:'(Lee just joined the call. Greet Lee in character and ask your first question.)'}}));}}
    if(m.sessionResumptionUpdate?.resumable&&m.sessionResumptionUpdate.newHandle)V.handle=m.sessionResumptionUpdate.newHandle;
    if(m.goAway){reconnect('goAway');return}
    const sc=m.serverContent;if(!sc)return;
    if(sc.inputTranscription?.text){V.inT+=sc.inputTranscription.text;renderLog();if(V.state==='listen'){clearTimeout(V.thinkT);V.thinkT=setTimeout(()=>{if(V.state==='listen'&&V.inT)vSet('think')},900)}}
    if(sc.interrupted){flushPlayback();commitAI();vSet('listen');}
    if(sc.modelTurn?.parts)for(const p of sc.modelTurn.parts)if(p.inlineData?.data){V.gotAudio=true;V.retries=0;clearTimeout(V.thinkT);if(V.inT)commitUser();if(V.state!=='ai')vSet('ai');playPCM(p.inlineData.data);}
    if(sc.outputTranscription?.text){if(V.inT)commitUser();V.outT+=sc.outputTranscription.text;renderLog();}
    if(sc.turnComplete){commitUser();commitAI();if(!V.sources.size&&V.state!=='listen')vSet('listen');}};
  ws.onclose=e=>{if(ws!==V.ws||!V.on)return;if(!V.plain&&!V.gotAudio&&(e.code===1007||/affective|proactiv|unknown|invalid/i.test(e.reason||''))){V.plain=true;LS.eb_plain=String(Date.now());V.handle=null;V.greeted=false;W.tok=null;}if(/not found|expired/i.test(e.reason||'')){V.handle=null;V.greeted=false;}reconnect('close '+e.code+(e.reason?' '+e.reason.slice(0,60):''));};
  ws.onerror=()=>{};}
async function reconnect(why){if(!V.on)return;const old=V.ws;V.ws=null;V.ready=false;try{old&&old.readyState<2&&old.close(1000)}catch{}
  console.log('[eb] reconnect:',why);flushPlayback();commitUser();commitAI();
  if(V.retries>=6)return fail(new Error('連線一直中斷，請檢查網路後再開始'));
  const wait=V.handle?Math.min(8000,1500*2**V.retries):V.retries?Math.min(8000,600*2**V.retries):0; // server needs ~1s to release a resumable session
  V.retries++;vSet('reconnect');
  if(!navigator.onLine){vSet('reconnect','網路斷線，恢復後會自動接續…');await new Promise(r=>addEventListener('online',r,{once:true}));if(!V.on)return;}
  await sleep(wait);if(!V.on)return;
  try{await connect()}catch(e){if(e.status===401)return fail(e);if(V.handle&&/handle|resum/i.test(e.message))V.handle=null;reconnect('token: '+e.message)}}
function vEnd(){V.on=false;V.gen++;const ws=V.ws;V.ws=null;V.ready=false;if(ws&&ws.readyState<2)ws.close(1000);V.mockT.forEach(clearTimeout);V.mockT=[];clearTimeout(V.thinkT);
  flushPlayback();commitUser();commitAI();V.stream?.getTracks().forEach(t=>t.stop());V.stream=null;V.src?.disconnect();V.node?.disconnect();V.src=V.node=V.an=null;
  V.ctx?.suspend().catch(()=>{});V.wake?.release().catch(()=>{});V.wake=null;vSet('off');setTimeout(prefetchToken,1000);}
function vMock(){vSet('listen','（示範模式）聆聽中…');const T=(ms,f)=>V.mockT.push(setTimeout(f,ms));
  const tone=()=>{const o=V.ctx.createOscillator(),g=V.ctx.createGain();o.frequency.value=220;g.gain.value=.05;o.connect(g).connect(V.outGain);o.start();o.stop(V.ctx.currentTime+1.6);};
  const ai=(t,ms)=>{T(ms,()=>{vSet('ai');tone();V.outT=t;renderLog();});T(ms+1800,()=>{commitAI();vSet('listen','（示範模式）聆聽中…');});};
  ai('Hi Lee! Welcome to Sunny Cafe. What would you like to order today?',600);
  T(3200,()=>{V.inT='I wants a hamburger and two coffee.';renderLog();vSet('think');});T(4300,()=>commitUser());
  ai('Great choice! Would you like fries with your hamburger?',4700);}
$('#vMain').onclick=()=>V.state==='off'?vStart():vEnd();$('#orb').onclick=()=>V.state==='off'&&vStart();
$('#vMute').onclick=()=>{if(V.state==='off')return;V.muted=!V.muted;
  if(V.muted&&V.ws?.readyState===1&&V.ready)V.ws.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));if(V.state==='listen')vSet('listen');};
window.__eb={V,forceDrop:()=>V.ws?.close(4000,'test drop'),goAway:()=>reconnect('test goAway')};

// ---------- settings ----------
$('#sVoice').innerHTML=Object.entries(VOICES).map(([v,l])=>`<option value="${v}">${l}</option>`).join('');
[['sScen','scen'],['sLvl','lvl'],['sVoice','voice'],['sSpeed','speed']].forEach(([id,k])=>$('#'+id).onchange=()=>{LS['eb_'+k]=$('#'+id).value;W.tok=null;syncPrefs()});
$('#vClear').onclick=()=>{if(confirm('清除語音對話紀錄？'))setVH([])};
$('#sUrl').value=LS.eb_url||DEFAULT_URL;$('#sCode').value=LS.eb_code||'';$('#sMock').checked=cfg().mock;
$('#sSave').onclick=()=>{LS.eb_url=$('#sUrl').value.trim();const nc=$('#sCode').value.trim();LS.eb_code=nc;if(nc&&$('#sMock').checked&&!LS.eb_codeSaved)$('#sMock').checked=false;LS.eb_codeSaved=nc?'1':'';
  LS.eb_mock=$('#sMock').checked?'1':'0';W.state='idle';W.tok=null;renderStatus();warm();$('#sOut').textContent='已儲存';};
$('#sTest').onclick=async()=>{$('#sSave').click();const c=cfg();if(c.mock)return $('#sOut').textContent='示範模式不需要連線';$('#sOut').textContent='測試中…（伺服器休眠時約需 1 分鐘）';
  try{if(!(await warm()))throw new Error('伺服器沒有回應');const h=await (await fetch(c.url+'/health')).json();await api('/api/correct',{text:'I am fine.'});$('#sOut').innerHTML=`<span class="good">✅ 連線成功（AI：${esc(h.ai||'未設定')}，Notion：${h.notion?'已設定':'未設定'}）</span>`}
  catch(e){$('#sOut').innerHTML=`<span class="err">⚠️ ${esc(e.message)}</span>`}};

const go=t=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x.id===t));$('#scenBtn').classList.toggle('hidden',t!=='voice')};
$('#vSet').onclick=()=>go('settings');$('#sBack').onclick=()=>go('voice');
$('#sTrMe').checked=trMe();$('#sTrAI').checked=trAI();$('#sTrMe').onchange=e=>{LS.eb_trMe=e.target.checked?'1':'0';renderLog()};$('#sTrAI').onchange=e=>{LS.eb_trAI=e.target.checked?'1':'0';renderLog()};
syncPrefs();renderCap();orbLoop();renderLog();vSet('off');renderStatus();warm();flushQueue();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

function lookupSheet(){sheet(`<div class="row" style="align-items:center;margin:0"><b style="flex:1">查單字</b><button id="lX">✕</button></div>
 <input id="lIn" placeholder="輸入英文或中文單字" autocomplete="off" autocapitalize="off" style="width:100%;margin:10px 0">
 <button class="pri" id="lGo" style="width:100%">翻譯</button>`);
 const go=()=>{const v=$('#lIn').value.trim().slice(0,80);if(v)wordSheet(v)};
 $('#lGo').onclick=go;$('#lIn').onkeydown=e=>{if(e.key==='Enter')go()};$('#lX').onclick=closeSheet;setTimeout(()=>$('#lIn').focus(),50);}
$('#vDict').onclick=lookupSheet;
