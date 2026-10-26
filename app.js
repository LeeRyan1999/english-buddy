'use strict';
const $=s=>document.querySelector(s), LS=localStorage;
const DEFAULT_URL='https://english-buddy-api-0cz1.onrender.com';
const cfg=()=>({url:(LS.eb_url||DEFAULT_URL).replace(/\/+$/,''),code:LS.eb_code||'',mock:LS.eb_mock==='1'||(LS.eb_mock!=='0'&&!LS.eb_code)});
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let DICT=null; const loadDict=async()=>DICT||(DICT=await (await fetch('dict.json')).json());
const vocab=()=>JSON.parse(LS.eb_vocab||'[]'), setVocab=v=>{LS.eb_vocab=JSON.stringify(v);renderCount()};
const queue=()=>JSON.parse(LS.eb_queue||'[]'), setQueue=q=>{LS.eb_queue=JSON.stringify(q);renderCount()};

// ---------- status ----------
function renderStatus(){const s=$('#status'),c=cfg();
  if(!navigator.onLine){s.className='pill off';s.textContent='● 離線';}
  else if(c.mock){s.className='pill mock';s.textContent='● 示範模式';}
  else{s.className='pill';s.textContent='● 已連線';}
  document.querySelectorAll('#tGo,#cGo,#chGo,#vStart').forEach(b=>b.disabled=!navigator.onLine&&!c.mock);}
addEventListener('online',()=>{renderStatus();flushQueue()});addEventListener('offline',renderStatus);

// ---------- tabs ----------
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('#tabs button,.tab').forEach(x=>x.classList.remove('on'));b.classList.add('on');$('#'+b.dataset.tab).classList.add('on');});
const showTab=t=>document.querySelector(`#tabs [data-tab=${t}]`).click();

// ---------- API ----------
async function api(path,body,method){const c=cfg();
  if(c.mock)return mock(path,body,method);
  if(!navigator.onLine)throw new Error('目前離線，這個功能需要網路');
  if(!c.url)throw new Error('請先到「設定」填後台網址');
  const r=await fetch(c.url+path,{method:method||(body?'POST':'GET'),headers:{'Content-Type':'application/json','X-Access-Code':c.code},body:body&&JSON.stringify(body)});
  const j=await r.json().catch(()=>({error:'後台回應錯誤 '+r.status}));if(!r.ok)throw new Error(j.error||r.status);return j;}
async function mock(path,b,method){await new Promise(r=>setTimeout(r,250));
  if(path==='/api/translate'){const m={'我明天想去看電影':'I want to go to the movies tomorrow.','你好':'Hello.','謝謝':'Thank you.'};
    return{english:m[b.text.trim()]||`[示範] English for: ${b.text}`,alt:'(casual) I wanna catch a movie tomorrow.',note:'示範模式回應，接上後台後會用 AI 翻譯。'};}
  if(path==='/api/correct'){let s=b.text;const fx=[[/\bI go\b/g,'I went'],[/\beat apple\b/g,'ate an apple'],[/\bhe go\b/gi,'he goes'],[/\bi\b/g,'I'],[/\bI wants\b/g,'I want'],[/\btwo coffee\b/g,'two coffees']];
    fx.forEach(([a,c])=>s=s.replace(a,c));return{corrected:s,isCorrect:s===b.text,explanation:s===b.text?'這句沒有問題！':(/Yesterday/.test(b.text)?'Yesterday 是過去時間，動詞要用過去式（go→went, eat→ate）；可數名詞 apple 單數前要加 an。':'主詞 I 的動詞不加 s（wants→want）；可數名詞複數要加 s（coffee→coffees）。')+'（示範模式）'};}
  if(path==='/api/explain'){await loadDict();const d=DICT[b.word.toLowerCase()];return{word:b.word,ipa:d?.[0]||'',pos:(d?.[1]||'').split(' ')[0],definition:d?.[2]||'(mock)',zh:d?.[1]||'（示範）',example:`This is an example with "${b.word}".`,exampleZh:'這是示範例句。'};}
  if(path==='/api/chat'){const last=[...b.messages].reverse().find(m=>m.role==='user');const Q={order:"Hi! Welcome to Sunny Cafe. What would you like to order today?",travel:"Good morning! May I see your passport, please? Where are you flying today?",interview:"Thanks for coming in. Could you tell me a little about yourself?",shopping:"Hi there! Are you looking for anything special today?",chat:"Hey! How was your day today?"};
    if(!last)return{reply:Q[b.scenario]||`Let's practice: ${b.scenario}. How would you like to start?`,correction:null};
    const c=await mock('/api/correct',{text:last.text});return{reply:"That sounds great! Can you tell me more about it?",correction:{corrected:c.corrected,isCorrect:c.isCorrect,note:c.isCorrect?'':c.explanation}};}
  if(path==='/api/quizcheck'){const ok=b.answer&&(b.meaning||'').split(/[,，；;\/ ]+/).some(x=>x.length>0&&(b.answer.includes(x.replace(/^[a-z]+\.\s*/,''))||x.includes(b.answer)));return{correct:!!ok,feedback:ok?'答對了！👏':`再想想～參考答案：${b.meaning}`};}
  if(path==='/api/vocab'&&method!=='POST'&&!b){const mv=JSON.parse(LS.eb_mockdb||'null')||[{word:'apple',meaning:'蘋果',example:'I eat an apple every day.'},{word:'brave',meaning:'勇敢的',example:'She is very brave.'},{word:'schedule',meaning:'行程；時間表',example:'My schedule is full today.'},{word:'improve',meaning:'改善；進步',example:'I want to improve my English.'}];return{words:mv};}
  if(path==='/api/vocab'){await loadDict();const d=DICT[b.word.toLowerCase()];const w={word:b.word,meaning:b.meaning||d?.[1]||'（待補）',example:b.example||'',added:b.added};
    const mv=(await mock('/api/vocab')).words;mv.push(w);LS.eb_mockdb=JSON.stringify(mv);return{ok:true,...w};}
  throw new Error('mock: unknown');}

// ---------- speech ----------
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
document.querySelectorAll('.mic').forEach(b=>{if(!SR){b.title='這個瀏覽器不支援語音輸入，請用打字';b.disabled=true;return;}
  b.onclick=()=>{const r=new SR();r.lang=b.dataset.lang;r.interimResults=true;const t=$('#'+b.dataset.target);b.classList.add('rec');
    r.onresult=e=>{t.value=[...e.results].map(x=>x[0].transcript).join('');};
    r.onerror=e=>{b.classList.remove('rec');if(e.error==='network')alert('語音辨識需要網路，請改用打字');};
    r.onend=()=>{b.classList.remove('rec');const id=b.dataset.target;if(id==='tIn')$('#tGo').click();if(id==='cIn')$('#cGo').click();if(id==='chIn')$('#chGo').click();};r.start();};});
function say(text,lang='en-US'){if(!window.speechSynthesis)return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang=lang;u.rate=.95;
  const v=speechSynthesis.getVoices().find(v=>v.lang===lang);if(v)u.voice=v;speechSynthesis.speak(u);}
const clickable=s=>esc(s).replace(/[A-Za-z][A-Za-z'-]*/g,w=>`<span class="w" data-w="${w}">${w}</span>`);
document.addEventListener('click',e=>{const w=e.target.closest('.w');if(w&&w.closest('#chLog')){chWord(w.dataset.w);return;}if(w&&w.closest('#vLog')){chWord(w.dataset.w,'#vWord');return;}if(w){$('#dIn').value=w.dataset.w;showTab('dict');lookup();}});
const busy=(el,msg='處理中…')=>{el.classList.remove('hidden');el.innerHTML=`<span class="small">${msg}</span>`};
const fail=(el,e)=>{el.classList.remove('hidden');el.innerHTML=`<span class="err">⚠️ ${esc(e.message)}</span>`};

// ---------- translate (+ Notion command) ----------
const CMD=/加入?(?:到|至)?\s*notion\s*(?:的)?\s*(?:英文)?\s*(?:單字|單詞)?\s*(?:頁面|頁|庫)?\s*[:：]?\s*([A-Za-z][A-Za-z' -]*)$/i;
$('#tGo').onclick=async()=>{const v=$('#tIn').value.trim(),o=$('#tOut');if(!v)return;
  const m=v.match(CMD);if(m){$('#addIn').value=m[1].trim();showTab('quiz');return addWord();}
  busy(o);try{const r=await api('/api/translate',{text:v});
    o.innerHTML=`<div class="en">${clickable(r.english)}</div>${r.alt?`<div class="small">其他說法：${clickable(r.alt)}</div>`:''}${r.note?`<p class="small">${esc(r.note)}</p>`:''}
    <div class="row"><button id="tSay">🔊 朗讀</button></div><div class="small">點英文單字可查意思</div>`;
    $('#tSay').onclick=()=>say(r.english);say(r.english);}catch(e){fail(o,e)}};

// ---------- correct ----------
function diff(a,b){const A=a.split(/\s+/),B=b.split(/\s+/),n=A.length,m=B.length,L=[...Array(n+1)].map(()=>Array(m+1).fill(0));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)L[i][j]=A[i]===B[j]?L[i+1][j+1]+1:Math.max(L[i+1][j],L[i][j+1]);
  let i=0,j=0,out=[];while(i<n&&j<m){if(A[i]===B[j]){out.push(esc(A[i]));i++;j++}else if(L[i+1][j]>=L[i][j+1])out.push(`<del>${esc(A[i++])}</del>`);else out.push(`<ins>${esc(B[j++])}</ins>`);}
  while(i<n)out.push(`<del>${esc(A[i++])}</del>`);while(j<m)out.push(`<ins>${esc(B[j++])}</ins>`);return out.join(' ');}
$('#cGo').onclick=async()=>{const v=$('#cIn').value.trim(),o=$('#cOut');if(!v)return;busy(o);
  try{const r=await api('/api/correct',{text:v});
    o.innerHTML=r.isCorrect?`<div class="good">✅ 文法正確！</div><div class="en">${clickable(r.corrected)}</div>`:
      `<div class="small">修改標示：</div><div>${diff(v,r.corrected)}</div><div class="small" style="margin-top:8px">正確句子：</div><div class="en">${clickable(r.corrected)}</div>`;
    o.innerHTML+=`<p>${esc(r.explanation)}</p><button id="cSay">🔊 朗讀正確句子</button>`;$('#cSay').onclick=()=>say(r.corrected);}catch(e){fail(o,e)}};

// ---------- dictionary ----------
async function lookup(){const w=$('#dIn').value.trim().toLowerCase(),o=$('#dOut');if(!w)return;busy(o,'查詢中…');await loadDict();
  const d=DICT[w];let html=d?`<div class="big">${esc(w)} <button id="dSay">🔊</button></div><div class="small">/${esc(d[0])}/ · 內建字典</div><p>${esc(d[1])}</p><p class="small">${esc(d[2])}</p>`:`<div class="big">${esc(w)}</div><p class="small">內建字典沒有這個字。</p>`;
  o.innerHTML=html+`<div id="dMore"></div><div class="row"><button id="dAdd">＋加入 Notion 單字庫</button></div>`;
  $('#dAdd').onclick=()=>{$('#addIn').value=w;showTab('quiz');addWord(d?.[1]);};
  const ds=$('#dSay');if(ds)ds.onclick=()=>say(w);
  if(navigator.onLine&&(cfg().url||cfg().mock)){try{const r=await api('/api/explain',{word:w});
    $('#dMore').innerHTML=`<div class="card"><b>${esc(r.word)}</b> ${r.ipa?`<span class="small">${esc(r.ipa)}</span>`:''} <i class="small">${esc(r.pos)}</i>${d?'':' <button id="dSay2">🔊</button>'}
      <p>${esc(r.zh)}</p><p class="small">${esc(r.definition)}</p><p>💬 ${esc(r.example)}<br><span class="small">${esc(r.exampleZh)}</span></p></div>`;
    const s2=$('#dSay2');if(s2)s2.onclick=()=>say(w);}catch(e){$('#dMore').innerHTML=`<p class="small">詳細解釋需連網：${esc(e.message)}</p>`}}
  else $('#dMore').innerHTML='<p class="small">離線中：只顯示內建字典。</p>';}
$('#dGo').onclick=lookup;$('#dIn').onkeydown=e=>{if(e.key==='Enter')lookup()};

// ---------- vocab / quiz ----------
function renderCount(){$('#qCount').textContent=`已快取 ${vocab().length} 個單字`;const q=queue();$('#queueInfo').textContent=q.length?`⏳ ${q.length} 個單字等待上傳到 Notion（連網後自動同步）：${q.map(x=>x.word).join(', ')}`:'';}
async function sync(){const b=$('#qSync');b.disabled=true;try{await flushQueue();const r=await api('/api/vocab');setVocab(r.words);$('#qFb').innerHTML=`<span class="good">已同步 ${r.words.length} 個單字</span>`}catch(e){$('#qFb').innerHTML=`<span class="err">⚠️ ${esc(e.message)}（使用快取單字）</span>`}b.disabled=false;}
async function flushQueue(){const q=queue();if(!q.length||!navigator.onLine)return;const left=[];
  for(const it of q){try{await api('/api/vocab',it,'POST')}catch{left.push(it)}}setQueue(left);}
async function addWord(meaning){const w=$('#addIn').value.trim();if(!w)return;const it={word:w,meaning:meaning||'',added:new Date().toISOString().slice(0,10)};
  if(!navigator.onLine){setQueue([...queue(),it]);setVocab([...vocab(),{...it}]);$('#qFb').innerHTML=`<span class="good">離線中，「${esc(w)}」已排隊，連網後上傳</span>`;$('#addIn').value='';return;}
  $('#qFb').textContent='加入中…';try{const r=await api('/api/vocab',it,'POST');if(r.skipped){$('#qFb').innerHTML=`<span class="good">「${esc(r.word)}」已經在 Notion 單字頁了</span>`;$('#addIn').value='';return;}setVocab([...vocab(),{word:r.word,meaning:r.meaning,example:r.example,added:it.added}]);
    $('#qFb').innerHTML=`<span class="good">✅ 已加入 Notion：${esc(r.word)}${r.meaning?' — '+esc(r.meaning):''}</span>`;$('#addIn').value='';}
  catch(e){setQueue([...queue(),it]);$('#qFb').innerHTML=`<span class="err">⚠️ ${esc(e.message)}，已先排隊稍後重試</span>`}}
$('#qSync').onclick=sync;$('#addGo').onclick=()=>addWord();
let cur=null;
$('#qNext').onclick=()=>{const v=vocab();if(!v.length){$('#qFb').textContent='還沒有單字，先按「同步單字」或新增';return;}
  cur=v[Math.floor(Math.random()*v.length)];$('#qWord').textContent=cur.word;$('#qAns').value='';$('#qFb').textContent='What does it mean? 用中文或英文回答';say(cur.word);};
$('#qSay').onclick=()=>cur&&say(cur.word);
$('#qCheck').onclick=async()=>{if(!cur)return $('#qNext').click();const a=$('#qAns').value.trim();if(!a)return;
  const local=()=>{const keys=(cur.meaning||'').replace(/[a-z]+\.\s*/g,'').split(/[,，；;、\/\s]+/).filter(x=>x.length);const ok=keys.some(k=>a.includes(k)||k.includes(a));
    return{correct:ok,feedback:ok?'答對了！👏':'不太對喔'}};
  let r;if(navigator.onLine&&(cfg().url||cfg().mock)){try{r=await api('/api/quizcheck',{word:cur.word,meaning:cur.meaning,answer:a})}catch{r=local()}}else r=local();
  $('#qFb').innerHTML=`<div class="${r.correct?'good':'bad'}">${r.correct?'✅':'❌'} ${esc(r.feedback)}</div><p class="small">參考：${esc(cur.meaning)}${cur.example?'<br>💬 '+esc(cur.example):''}</p>`;};
$('#qAns').onkeydown=e=>{if(e.key==='Enter')$('#qCheck').click()};

// ---------- chat ----------
const chHist=()=>JSON.parse(LS.eb_chat||'[]'),setHist=h=>{LS.eb_chat=JSON.stringify(h);renderChat()};
['chScen','chLvl'].forEach(id=>{const k='eb_'+id;if(LS[k])$('#'+id).value=LS[k];$('#'+id).onchange=()=>{LS[k]=$('#'+id).value;$('#chCustom').classList.toggle('hidden',$('#chScen').value!=='custom');}});
$('#chCustom').value=LS.eb_chCustom||'';$('#chCustom').oninput=()=>LS.eb_chCustom=$('#chCustom').value;$('#chCustom').classList.toggle('hidden',$('#chScen').value!=='custom');
function renderChat(){const h=chHist(),L=$('#chLog');
  L.innerHTML=h.length?h.map((m,i)=>m.role==='ai'?`<div class="msg ai">${clickable(m.text)}<button class="say" data-i="${i}">🔊</button></div>`:
    `<div class="msg me">${esc(m.text)}</div>${m.fix&&!m.fix.isCorrect&&m.fix.corrected?`<div class="fix">✏️ ${diff(m.text,m.fix.corrected)}<br><b>${esc(m.fix.corrected)}</b>${m.fix.note?`<br>${esc(m.fix.note)}`:''}</div>`:m.fix?.isCorrect?'<div class="fix">✅ 文法正確</div>':''}`).join(''):'<p class="small">選好情境和程度，按「送出」或直接說話開始。</p>';
  L.querySelectorAll('.say').forEach(b=>b.onclick=()=>say(h[b.dataset.i].text));L.scrollTop=L.scrollHeight;}
async function chatSend(){const v=$('#chIn').value.trim(),h=chHist();if(!v&&h.length)return;
  if(v)h.push({role:'user',text:v});$('#chIn').value='';setHist(h);$('#chGo').disabled=true;$('#chLog').insertAdjacentHTML('beforeend','<p class="small" id="chWait">AI 思考中…</p>');
  const sc=$('#chScen').value;try{const r=await api('/api/chat',{messages:h.map(m=>({role:m.role,text:m.text})),scenario:sc==='custom'?($('#chCustom').value||'casual talk'):sc,level:$('#chLvl').value});
    if(v&&r.correction)h[h.length-1].fix=r.correction;h.push({role:'ai',text:r.reply});setHist(h);say(r.reply);}
  catch(e){$('#chWait')?.remove();$('#chLog').insertAdjacentHTML('beforeend',`<p class="err">⚠️ ${esc(e.message)}</p>`)}$('#chGo').disabled=!navigator.onLine&&!cfg().mock;}
$('#chGo').onclick=chatSend;$('#chIn').onkeydown=e=>{if(e.key==='Enter')chatSend()};
$('#chNew').onclick=()=>{if(!chHist().length||confirm('清除這次對話紀錄？')){setHist([]);$('#chWord').classList.add('hidden')}};
async function chWord(w,box='#chWord'){const o=$(box);busy(o,'查詢中…');await loadDict();const d=DICT[w.toLowerCase()];let r=null;
  try{r=await api('/api/explain',{word:w})}catch{}
  o.innerHTML=`<div class="row" style="margin:0"><b class="en">${esc(w)}</b><button id="cwSay">🔊</button><button id="cwAdd">＋加入 Notion</button><button id="cwX">✕</button></div>
   ${r?`<div class="small">${esc(r.ipa)} ${esc(r.pos)}</div><p>${esc(r.zh)}</p><p class="small">${esc(r.definition)}<br>💬 ${esc(r.example)}</p>`:d?`<div class="small">/${esc(d[0])}/</div><p>${esc(d[1])}</p>`:'<p class="small">查不到</p>'}<div id="cwFb" class="small"></div>`;
  $('#cwSay').onclick=()=>say(w);$('#cwX').onclick=()=>o.classList.add('hidden');
  $('#cwAdd').onclick=async()=>{const it={word:w.toLowerCase(),meaning:r?.zh||d?.[1]||'',example:r?.example||'',added:new Date().toISOString().slice(0,10)};
    if(!navigator.onLine){setQueue([...queue(),it]);$('#cwFb').textContent='離線中，已排隊';return;}
    try{const x=await api('/api/vocab',it,'POST');if(!x.skipped)setVocab([...vocab(),it]);$('#cwFb').innerHTML=`<span class="good">${x.skipped?'已經在單字頁了':'✅ 已加入 Notion'}</span>`}
    catch(e){setQueue([...queue(),it]);$('#cwFb').innerHTML=`<span class="err">⚠️ ${esc(e.message)}，已排隊</span>`}};}
renderChat();

// ---------- realtime voice (Gemini Live) ----------
const V={ws:null,ctx:null,stream:null,node:null,src:null,an:null,playAt:0,sources:[],inT:'',outT:'',raf:0,mockT:[],state:'off'};
const vHist=()=>JSON.parse(LS.eb_voice||'[]'),setVH=h=>{LS.eb_voice=JSON.stringify(h.slice(-60));renderVoice()};
['vScen','vLvl'].forEach(id=>{const k='eb_'+id;if(LS[k])$('#'+id).value=LS[k];$('#'+id).onchange=()=>LS[k]=$('#'+id).value;});
function renderVoice(){const h=vHist(),L=$('#vLog');
  L.innerHTML=h.map((m,i)=>m.role==='ai'?`<div class="msg ai">${clickable(m.text)}</div>`:`<div class="msg me">${esc(m.text)}</div>${m.fix?(m.fix.isCorrect?'<div class="fix">✅ 文法正確</div>':`<div class="fix">✏️ ${diff(m.text,m.fix.corrected)}<br><b>${esc(m.fix.corrected)}</b><br>${esc(m.fix.explanation||'')}</div>`):''}`).join('');
  if(V.inT)L.insertAdjacentHTML('beforeend',`<div class="msg me" style="opacity:.6">${esc(V.inT)}</div>`);
  if(V.outT)L.insertAdjacentHTML('beforeend',`<div class="msg ai" style="opacity:.75">${esc(V.outT)}</div>`);L.scrollTop=L.scrollHeight;}
function vSet(st,msg){V.state=st;const o=$('#orb');o.className={off:'idle',connecting:'connecting',listen:'listen',ai:'ai'}[st]||'idle';$('#vState').textContent=msg;
  $('#vStart').classList.toggle('hidden',st!=='off');$('#vEnd').classList.toggle('hidden',st==='off');}
function commitUser(){const t=V.inT.trim();V.inT='';if(!t)return;const h=vHist();h.push({role:'user',text:t});setVH(h);const idx=h.length-1;
  api('/api/correct',{text:t}).then(r=>{const h2=vHist();if(h2[idx]&&h2[idx].text===t){h2[idx].fix=r;setVH(h2)}}).catch(()=>{});}
function commitAI(){const t=V.outT.trim();V.outT='';if(!t)return;const h=vHist();h.push({role:'ai',text:t});setVH(h);}
function stopPlayback(){V.sources.forEach(s=>{try{s.stop()}catch{}});V.sources=[];V.playAt=0;}
function playPCM(b64){const bin=atob(b64),n=bin.length>>1,buf=V.ctx.createBuffer(1,n,24000),ch=buf.getChannelData(0);
  for(let i=0;i<n;i++){let v=bin.charCodeAt(2*i)|(bin.charCodeAt(2*i+1)<<8);if(v>32767)v-=65536;ch[i]=v/32768;}
  const s=V.ctx.createBufferSource();s.buffer=buf;s.connect(V.outAn);const t=Math.max(V.ctx.currentTime+.03,V.playAt);s.start(t);V.playAt=t+buf.duration;
  V.sources.push(s);s.onended=()=>{V.sources=V.sources.filter(x=>x!==s);if(!V.sources.length&&V.state==='ai')vSet('listen','聆聽中…請說英文');};}
const WORKLET=`class P extends AudioWorkletProcessor{constructor(){super();this.r=sampleRate/16000;this.acc=[];this.pos=0}
process(i){const x=i[0][0];if(!x)return true;for(;this.pos<x.length;this.pos+=this.r)this.acc.push(x[Math.floor(this.pos)]);this.pos-=x.length;
if(this.acc.length>=1600){const a=new Int16Array(this.acc.length);for(let k=0;k<a.length;k++){const s=Math.max(-1,Math.min(1,this.acc[k]));a[k]=s<0?s*32768:s*32767}this.port.postMessage(a.buffer,[a.buffer]);this.acc=[]}return true}}registerProcessor('pcm16k',P)`;
function orbLoop(){const o=$('#orb'),d=new Uint8Array(256);const f=()=>{let lv=0;const an=V.state==='ai'?V.outAn:V.an;
  if(an){an.getByteTimeDomainData(d);let s=0;for(const v of d)s+=(v-128)**2;lv=Math.sqrt(s/d.length)/40;}
  if(V.state==='listen'||V.state==='ai')o.style.transform=`scale(${1+Math.min(lv*.5,.22)})`;else o.style.transform='';V.raf=requestAnimationFrame(f)};f();}
async function vStart(){if(V.state!=='off')return;const c=cfg();vSet('connecting','連線中…');
  try{V.ctx=new (window.AudioContext||window.webkitAudioContext)();await V.ctx.resume();V.outAn=V.ctx.createAnalyser();V.outAn.connect(V.ctx.destination);orbLoop();
    if(c.mock)return vMock();
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('這個瀏覽器不支援麥克風串流');
    const [tok,stream]=await Promise.all([api('/api/live-token',{scenario:$('#vScen').value,level:$('#vLvl').value}),navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}})]);
    V.stream=stream;await V.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET],{type:'application/javascript'})));
    V.src=V.ctx.createMediaStreamSource(stream);V.an=V.ctx.createAnalyser();V.src.connect(V.an);V.node=new AudioWorkletNode(V.ctx,'pcm16k');V.src.connect(V.node);
    const ws=V.ws=new WebSocket('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token='+encodeURIComponent(tok.token));
    ws.onopen=()=>ws.send(JSON.stringify({setup:{model:'models/'+tok.model}}));
    ws.onmessage=async e=>{const m=JSON.parse(typeof e.data==='string'?e.data:await e.data.text());
      if(m.setupComplete){vSet('listen','聆聽中…請說英文');ws.send(JSON.stringify({realtimeInput:{text:'(Lee just joined the call. Greet Lee in character and ask your first question.)'}}));
        V.node.port.onmessage=ev=>{if(ws.readyState===1){const u=new Uint8Array(ev.data);let b='';for(let i=0;i<u.length;i+=8192)b+=String.fromCharCode.apply(null,u.subarray(i,i+8192));ws.send(JSON.stringify({realtimeInput:{audio:{data:btoa(b),mimeType:'audio/pcm;rate=16000'}}}))}};}
      const sc=m.serverContent;if(!sc)return;
      if(sc.inputTranscription?.text){V.inT+=sc.inputTranscription.text;renderVoice();}
      if(sc.interrupted){stopPlayback();commitAI();vSet('listen','聆聽中…');}
      if(sc.modelTurn?.parts)for(const p of sc.modelTurn.parts)if(p.inlineData?.data){if(V.inT)commitUser();if(V.state!=='ai')vSet('ai','AI 說話中…（可直接插話）');playPCM(p.inlineData.data);}
      if(sc.outputTranscription?.text){if(V.inT)commitUser();V.outT+=sc.outputTranscription.text;renderVoice();}
      if(sc.turnComplete){commitUser();commitAI();}};
    ws.onclose=e=>{if(V.state!=='off'){vEnd();$('#vState').textContent=e.code===1000?'已結束':`連線中斷（${e.code}${e.reason?'：'+e.reason.slice(0,80):''}）`;}};
    ws.onerror=()=>{};
  }catch(e){vEnd();$('#vState').textContent='⚠️ '+e.message;}}
function vEnd(){const ws=V.ws;V.ws=null;if(ws&&ws.readyState<2)ws.close(1000);V.mockT.forEach(clearTimeout);V.mockT=[];stopPlayback();commitUser();commitAI();
  V.stream?.getTracks().forEach(t=>t.stop());V.stream=null;cancelAnimationFrame(V.raf);V.ctx?.close().catch(()=>{});V.ctx=null;V.an=null;vSet('off','點一下開始');}
function vMock(){vSet('listen','（示範模式）聆聽中…');const T=(ms,f)=>V.mockT.push(setTimeout(f,ms));
  const tone=()=>{const o=V.ctx.createOscillator(),g=V.ctx.createGain();o.frequency.value=220;g.gain.value=.04;o.connect(g).connect(V.outAn);o.start();o.stop(V.ctx.currentTime+1.6);};
  const ai=(t,ms)=>{T(ms,()=>{vSet('ai','AI 說話中…（示範）');tone();V.outT=t;renderVoice();});T(ms+1800,()=>{commitAI();vSet('listen','（示範模式）聆聽中…');});};
  ai('Hi Lee! Welcome to Sunny Cafe. What would you like to order today?',600);
  T(3200,()=>{V.inT='I wants a hamburger and two coffee.';renderVoice();});T(4400,()=>commitUser());
  ai('Great choice! Would you like fries with your hamburger?',4700);}
$('#vStart').onclick=vStart;$('#orb').onclick=()=>V.state==='off'&&vStart();$('#vEnd').onclick=vEnd;
$('#vClear').onclick=()=>{if(confirm('清除語音對話紀錄？'))setVH([])};renderVoice();vSet('off','點一下開始');

// ---------- settings ----------
$('#sUrl').value=LS.eb_url||DEFAULT_URL;$('#sCode').value=LS.eb_code||'';$('#sMock').checked=cfg().mock;
$('#sSave').onclick=()=>{LS.eb_url=$('#sUrl').value.trim();LS.eb_code=$('#sCode').value.trim();const nc=$('#sCode').value.trim();if(nc&&LS.eb_url&&$('#sMock').checked&&!LS.eb_codeSaved){$('#sMock').checked=false;}LS.eb_codeSaved=nc?'1':'';LS.eb_mock=$('#sMock').checked?'1':'0';renderStatus();$('#sOut').textContent='已儲存';};
$('#sTest').onclick=async()=>{$('#sSave').click();const c=cfg();if(c.mock)return $('#sOut').textContent='示範模式不需要連線';
  try{const h=await (await fetch(c.url+'/health')).json();await api('/api/vocab');$('#sOut').innerHTML=`<span class="good">✅ 連線成功（AI：${esc(h.ai||'未設定')}，Notion：${h.notion?'已設定':'未設定'}）</span>`}
  catch(e){$('#sOut').innerHTML=`<span class="err">⚠️ ${esc(e.message)}（免費後台閒置後第一次要等約 1 分鐘喚醒）</span>`}};

renderStatus();renderCount();if(!LS.eb_vocab&&cfg().mock)sync();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');
